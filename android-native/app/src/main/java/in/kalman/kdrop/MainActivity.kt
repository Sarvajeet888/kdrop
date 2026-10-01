package `in`.kalman.kdrop

import android.Manifest
import android.app.Activity
import android.content.*
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.widget.*
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.google.zxing.integration.android.IntentIntegrator
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity: Activity() {
    private lateinit var status: TextView
    private lateinit var explanation: TextView
    private lateinit var host: EditText
    private lateinit var pairing: EditText
    private lateinit var code: TextView
    private lateinit var qr: ImageView
    private lateinit var progress: ProgressBar
    private lateinit var approval: LinearLayout
    private lateinit var offer: TextView
    private var file: Uri?=null
    private var folder: Uri?=null
    private val buttons=mutableListOf<Button>()
    private lateinit var layout: LinearLayout
    private var displayedPairing=""
    private fun text(value: String, size: Float=15f): TextView = TextView(this).apply {
        text=value; textSize=size; setTextColor(Color.rgb(32,35,33)); setPadding(0,14,0,14)
    }
    private fun button(label: String, busyDisabled: Boolean=true, action: ()->Unit): Button = Button(this).apply {
        text=label; setOnClickListener { runCatching(action).onFailure { status.text=it.message } }
        this@MainActivity.layout.addView(this); if(busyDisabled) buttons.add(this)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll=ScrollView(this);layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(32,32,32,40);setBackgroundColor(Color.rgb(243,240,233)) }
        scroll.addView(layout);setContentView(scroll)
        layout.addView(text("KDROP / NEARBY",18f));layout.addView(text("Share directly.\nKeep it yours.",32f))
        layout.addView(text("Connect both devices to the same Wi-Fi or hotspot. Preview build: one file at a time."))
        layout.addView(text("RECEIVE",20f))
        host=EditText(this).apply { hint="This phone’s LAN IPv4 address";setSingleLine();setText(localIp()) };layout.addView(host)
        button("Choose destination folder") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),102) }
        button("Start receiving") {
            val target=folder ?: error("Choose a destination folder first")
            Protocol.ipv4(host.text.toString().trim())
            launch("receive", "folder" to target.toString(),"host" to host.text.toString().trim())
        }
        qr=ImageView(this);qr.contentDescription="Private pairing QR";qr.visibility=View.GONE;layout.addView(qr,LinearLayout.LayoutParams(600,600).apply { gravity=android.view.Gravity.CENTER_HORIZONTAL })
        code=text("");code.setTextIsSelectable(true);code.visibility=View.GONE;layout.addView(code)
        button("Copy receiver pairing code",false) {
            check(TransferState.pairing.isNotEmpty()) { "Start receiving first" }
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Private KDrop pairing",TransferState.pairing))
            status.text="Pairing copied. Share only with the sending device."
        }
        layout.addView(text("SEND",20f))
        pairing=EditText(this).apply { hint="Scan or paste receiver’s pairing code";minLines=2;maxLines=4 };layout.addView(pairing)
        button("Scan receiver QR") { IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setBeepEnabled(false).setPrompt("Scan the receiver’s KDrop QR").initiateScan() }
        button("Choose a file") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),101) }
        button("Send securely") {
            val selected=file ?: error("Choose a file first");Protocol.pairing(pairing.text.toString().trim())
            launch("send","file" to selected.toString(),"pairing" to pairing.text.toString().trim())
        }
        layout.addView(text("TRANSFER",20f));status=text("Ready when you are");layout.addView(status)
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { max=1000 };layout.addView(progress)
        explanation=text("Speed is measured at the receiver. No maximum-speed estimate yet.");layout.addView(explanation)
        approval=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;visibility=View.GONE };offer=text("");approval.addView(offer)
        for((label,accepted) in listOf("Accept file" to true,"Decline" to false)) approval.addView(Button(this).apply {
            text=label;setOnClickListener { approval.visibility=View.GONE;startService(Intent(this@MainActivity,TransferService::class.java).setAction("approve").putExtra("accepted",accepted)) }
        });layout.addView(approval)
        button("Stop session",false) { if(TransferState.active) startService(Intent(this,TransferService::class.java).setAction("stop")) }
        savedInstanceState?.let { file=it.getString("file")?.let(Uri::parse);folder=it.getString("folder")?.let(Uri::parse) }
        if(Build.VERSION.SDK_INT>=33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),200)
    }
    private fun launch(action: String,vararg extras: Pair<String,String>) {
        check(!TransferState.active) { "Stop the current session first" }
        val intent=Intent(this,TransferService::class.java).setAction(action);extras.forEach { intent.putExtra(it.first,it.second) }
        startForegroundService(intent);buttons.forEach { it.isEnabled=false };status.text="Starting…"
    }
    override fun onStart() { super.onStart();TransferState.observer={ value -> runOnUiThread { render(value) } };render(TransferState.state) }
    override fun onStop() { TransferState.observer=null;super.onStop() }
    override fun onSaveInstanceState(out: Bundle) { out.putString("file",file?.toString());out.putString("folder",folder?.toString());super.onSaveInstanceState(out) }
    private fun render(value: JSONObject) {
        buttons.forEach { it.isEnabled=!TransferState.active }
        val pair=TransferState.pairing
        if(pair!=displayedPairing) {
            displayedPairing=pair;code.text=pair;code.visibility=if(pair.isEmpty()) View.GONE else View.VISIBLE;qr.visibility=code.visibility
            if(pair.isNotEmpty()) runCatching { qr.setImageBitmap(BarcodeEncoder().createBitmap(MultiFormatWriter().encode(pair,BarcodeFormat.QR_CODE,600,600))) }.onFailure { status.text="Pairing text ready; QR rendering failed" }
        }
        approval.visibility=if(value.optString("type")=="offer" && TransferState.active) View.VISIBLE else View.GONE
        when(value.optString("type")) {
            "pairing" -> status.text="Waiting for a sender. Share the QR privately."
            "offer" -> { offer.text="Receive ${value.getString("name")} (${value.getLong("size")} bytes)?";status.text="Approval required" }
            "progress" -> {
                val total=value.getLong("total");val received=value.getLong("received")
                progress.progress=if(total>0) (received.toDouble()/total*1000).toInt() else 1000
                status.text="%.1f MiB/s received · %d / %d bytes".format(value.getDouble("rate")/1048576,received,total)
                explanation.text=value.getString("note")
            }
            "status" -> status.text=value.getString("message")
        }
    }
    @Deprecated("Activity result bridge for the QR scanner and system pickers")
    override fun onActivityResult(request: Int,result: Int,data: Intent?) {
        val scan=IntentIntegrator.parseActivityResult(request,result,data)
        if(scan!=null) { scan.contents?.let { pairing.setText(it) };return }
        super.onActivityResult(request,result,data)
        if(result!=RESULT_OK) return
        val uri=data?.data ?: return
        val canRead = data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0
        val canWrite = data.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0
        runCatching {
            when {
                canRead && canWrite -> contentResolver.takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                canRead -> contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                canWrite -> contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
        }
        if(request==101) { file=uri;status.text="File selected. Ready to send." }
        if(request==102) { folder=uri;status.text="Destination selected. Ready to receive." }
    }
    private fun localIp(): String = runCatching {
        NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress ?: ""
    }.getOrDefault("")
}
