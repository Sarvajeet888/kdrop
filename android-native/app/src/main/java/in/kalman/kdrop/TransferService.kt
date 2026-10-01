package `in`.kalman.kdrop

import android.app.*
import android.content.*
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.*
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.*

/** In-process state only. Pairing capabilities never enter an exported broadcast. */
object TransferState {
    @Volatile var state = JSONObject().put("type","status").put("message","Ready when you are")
    @Volatile var pairing = ""
    @Volatile var active = false
    @Volatile var observer: ((JSONObject)->Unit)? = null
    fun emit(value: JSONObject) { state=value; observer?.invoke(value) }
}

class TransferService: Service() {
    @Volatile private var socket: SSLSocket? = null
    @Volatile private var server: SSLServerSocket? = null
    @Volatile private var cancelled = false
    private val decisions = LinkedBlockingQueue<Boolean>(1)
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null
    private fun message(text: String) = TransferState.emit(JSONObject().put("type","status").put("message",text))
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when(intent?.action) {
            "approve" -> { decisions.offer(intent.getBooleanExtra("accepted",false)); return START_NOT_STICKY }
            "stop" -> { shutdown(); stopSelf(); return START_NOT_STICKY }
        }
        if(intent==null || TransferState.active) return START_NOT_STICKY
        cancelled=false; TransferState.active=true
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("transfer","File transfers",NotificationManager.IMPORTANCE_LOW))
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop=PendingIntent.getService(this,1,Intent(this,TransferService::class.java).setAction("stop"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        startForeground(1,Notification.Builder(this,"transfer").setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("KDrop local transfer").setContentText("Tap to view progress or approve a file")
            .setContentIntent(open).addAction(Notification.Action.Builder(null,"Stop",stop).build()).setOngoing(true).build())
        wake=getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"KDrop:transfer").apply { acquire(6*60*60*1000L) }
        @Suppress("DEPRECATION")
        wifi=(applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF,"KDrop:transfer").apply { acquire() }
        Thread {
            try {
                when(intent.action) {
                    "receive" -> receive(Uri.parse(intent.getStringExtra("folder") ?: error("Choose a destination")),intent.getStringExtra("host") ?: error("Enter your LAN IP"))
                    "send" -> send(Uri.parse(intent.getStringExtra("file") ?: error("Choose a file")),intent.getStringExtra("pairing") ?: error("Scan the receiver code"))
                    else -> error("Unknown transfer action")
                }
            } catch(e: Exception) { message(if(cancelled) "Session stopped. Retry the same file to resume." else e.message ?: "Transfer failed") }
            finally {
                shutdown(); TransferState.active=false
                TransferState.observer?.invoke(TransferState.state)
                stopSelf(startId)
            }
        }.start()
        return START_NOT_STICKY
    }
    private fun send(uri: Uri, code: String) {
        val pair=Protocol.pairing(code)
        var name="file"
        contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { if(it.moveToFirst()) name=it.getString(0) ?: "file" }
        require(name.toByteArray(Charsets.UTF_8).size<=255) { "Filename is too long" }
        // SAF providers are not always seekable. Stage bounded chunks to local storage for verified resume.
        val staged=File.createTempFile("kdrop-send-",".tmp",cacheDir)
        try {
            message("Preparing selected file for reliable, resumable sending…")
            contentResolver.openInputStream(uri)!!.use { input -> staged.outputStream().use { output ->
                val buffer=ByteArray(Protocol.CHUNK); var total=0L
                while(true) {
                    check(!cancelled) { "Cancelled" }; val n=input.read(buffer); if(n<0) break
                    total+=n; require(total<=Protocol.LIMIT && cacheDir.usableSpace>n+Protocol.CHUNK) { "Not enough temporary space to prepare this file" }
                    output.write(buffer,0,n)
                }
            } }
            check(!cancelled)
            val connection=Protocol.client(pair); socket=connection
            check(!cancelled)
            connection.use { Protocol.send(it,pair,staged,name,::message) }
            message("Complete: receiver verified and saved the file.")
        } finally { staged.delete() }
    }
    private fun receive(folder: Uri, host: String) {
        val (listener,pairing)=Protocol.server(host); server=listener
        TransferState.pairing=pairing.uri(); TransferState.emit(JSONObject().put("type","pairing").put("code",TransferState.pairing))
        val partials=File(filesDir,"partials")
        while(!cancelled) {
            val connection=listener.accept() as SSLSocket
            if(!Protocol.local(connection.inetAddress)) { connection.close(); continue }
            socket=connection; connection.soTimeout=300000; connection.tcpNoDelay=true
            try {
                val saved=connection.use { Protocol.receive(it,pairing.token,partials,{ name,size ->
                    decisions.clear()
                    TransferState.emit(JSONObject().put("type","offer").put("name",name).put("size",size))
                    decisions.poll(120,TimeUnit.SECONDS)==true && !cancelled
                },{ received,total,rate,note ->
                    TransferState.emit(JSONObject().put("type","progress").put("received",received).put("total",total).put("rate",rate).put("note",note))
                },{ file,name -> publish(folder,file,name) }) }
                message("Verified and saved: $saved. Ready for another file.")
            } catch(e: Exception) { if(!cancelled) message("Transfer stopped: ${e.message}. You can retry.") }
            finally { socket=null }
        }
    }
    private fun publish(tree: Uri, part: File, remoteName: String): String {
        message("Verifying and saving to the selected folder…")
        val clean=remoteName.map { if(it.isISOControl() || it in "<>:\"/\\|?*") '_' else it }.joinToString("").take(80).trim('.',' ').ifEmpty { "file" }
        val name="kdrop-${System.currentTimeMillis()}-$clean"
        val parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree))
        val document=DocumentsContract.createDocument(contentResolver,parent,"application/octet-stream",name) ?: error("Cannot create destination file")
        try {
            contentResolver.openFileDescriptor(document,"w")!!.use { descriptor ->
                FileOutputStream(descriptor.fileDescriptor).use { output ->
                    part.inputStream().use { input ->
                        val buf=ByteArray(Protocol.CHUNK)
                        while(true) { check(!cancelled); val n=input.read(buf); if(n<0) break; output.write(buf,0,n) }
                    }
                    output.flush(); output.fd.sync()
                }
            }
            // Re-read the provider destination before acknowledging delivery.
            val digest=java.security.MessageDigest.getInstance("SHA-256")
            contentResolver.openInputStream(document)!!.use { input ->
                val buf=ByteArray(Protocol.CHUNK)
                while(true) { check(!cancelled); val n=input.read(buf); if(n<0) break; digest.update(buf,0,n) }
            }
            check(Protocol.hex(digest.digest())==part.name.removeSuffix(".part")) { "Saved file verification failed" }
            return name
        } catch(e: Exception) { runCatching { DocumentsContract.deleteDocument(contentResolver,document) }; throw e }
    }
    private fun shutdown() {
        cancelled=true; decisions.offer(false)
        runCatching { socket?.close() }; runCatching { server?.close() }; socket=null;server=null
        if(wake?.isHeld==true) wake?.release(); if(wifi?.isHeld==true) wifi?.release()
        TransferState.pairing=""
        TransferState.observer?.invoke(TransferState.state)
    }
    override fun onTimeout(startId: Int, fgsType: Int) { message("Android stopped this long-running session. Retry to resume."); shutdown();stopSelf() }
    override fun onDestroy() { shutdown(); super.onDestroy() }
}
