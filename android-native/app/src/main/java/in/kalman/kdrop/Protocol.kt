package `in`.kalman.kdrop

import android.util.Base64
import org.json.JSONObject
import java.io.*
import java.net.*
import java.security.*
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.math.BigInteger
import java.util.Date
import javax.net.ssl.*
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.*
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider

object Protocol {
    const val CHUNK = 1048576
    const val LIMIT = 1099511627776L
    private const val FLAGS = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    fun encode(data: ByteArray): String = Base64.encodeToString(data, FLAGS)
    fun decode(data: String): ByteArray = Base64.decode(data, FLAGS)
    fun hash(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
    fun hex(data: ByteArray): String = data.joinToString("") { "%02x".format(it.toInt() and 255) }
    fun prefix(file: File, length: Long): String {
        require(length in 0..file.length())
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(CHUNK); var remaining = length
            while (remaining > 0) {
                val n = input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                if (n < 0) throw EOFException("Source changed while hashing")
                digest.update(buffer, 0, n); remaining -= n
            }
        }
        return hex(digest.digest())
    }
    fun local(address: InetAddress) = address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress
    fun ipv4(text: String): InetAddress {
        require(text.matches(Regex("[0-9]{1,3}(\\.[0-9]{1,3}){3}"))) { "Enter a LAN IPv4 address" }
        val parts = text.split('.').map { it.toInt().also { p -> require(p in 0..255) } }
        return InetAddress.getByAddress(parts.map { it.toByte() }.toByteArray()).also { require(local(it)) { "Only local addresses are supported" } }
    }
    fun read(input: DataInputStream): JSONObject {
        val n = input.readInt(); require(n in 1..16384) { "Invalid control frame" }
        return JSONObject(String(ByteArray(n).also { input.readFully(it) }, Charsets.UTF_8))
    }
    fun write(output: DataOutputStream, value: JSONObject) {
        val bytes = value.toString().toByteArray(Charsets.UTF_8); require(bytes.size in 1..16384)
        output.writeInt(bytes.size); output.write(bytes); output.flush()
    }
    data class Pairing(val host: String, val port: Int, val certificate: ByteArray, val token: String) {
        fun uri(): String = "kdrop://pair/" + encode(JSONObject().put("version",1).put("address","$host:$port")
            .put("certificate",encode(certificate)).put("token",token).toString().toByteArray(Charsets.UTF_8))
    }
    fun pairing(text: String): Pairing {
        require(text.length <= 16384 && text.startsWith("kdrop://pair/")) { "Invalid pairing code" }
        val obj = JSONObject(String(decode(text.removePrefix("kdrop://pair/")), Charsets.UTF_8))
        require(obj.getInt("version") == 1)
        val address = obj.getString("address").split(':'); require(address.size == 2) { "Android preview uses IPv4" }
        ipv4(address[0]); val port = address[1].toInt(); require(port in 1..65535)
        val token = obj.getString("token"); require(decode(token).size == 32)
        return Pairing(address[0],port,decode(obj.getString("certificate")),token)
    }
    fun client(pair: Pairing): SSLSocket {
        val pinned = CertificateFactory.getInstance("X.509").generateCertificate(pair.certificate.inputStream()) as X509Certificate
        val trust = object : X509TrustManager {
            override fun getAcceptedIssuers() = arrayOf(pinned)
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { throw java.security.cert.CertificateException("Client certificates not supported") }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (chain.isEmpty() || !MessageDigest.isEqual(chain[0].encoded, pinned.encoded)) throw java.security.cert.CertificateException("Pairing certificate does not match")
                chain[0].checkValidity()
            }
        }
        val context = SSLContext.getInstance("TLSv1.3"); context.init(null,arrayOf<TrustManager>(trust),SecureRandom())
        val socket = context.socketFactory.createSocket() as SSLSocket
        try {
            socket.enabledProtocols = arrayOf("TLSv1.3"); socket.soTimeout = 300000; socket.tcpNoDelay = true
            socket.connect(InetSocketAddress(ipv4(pair.host),pair.port),10000)
            return socket
        } catch(e: Exception) { socket.close(); throw e }
    }
    fun server(host: String): Pair<SSLServerSocket, Pairing> {
        val address = ipv4(host)
        val keys = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val name = X500Name("CN=kdrop.local")
        val certBuilder = JcaX509v3CertificateBuilder(name, BigInteger(128,SecureRandom()).abs().add(BigInteger.ONE),
            Date(System.currentTimeMillis()-60000),Date(System.currentTimeMillis()+86400000),name,keys.public)
        certBuilder.addExtension(Extension.subjectAlternativeName,false,GeneralNames(GeneralName(GeneralName.dNSName,"kdrop.local")))
        certBuilder.addExtension(Extension.basicConstraints,true,BasicConstraints(false))
        certBuilder.addExtension(Extension.keyUsage,true,KeyUsage(KeyUsage.digitalSignature))
        certBuilder.addExtension(Extension.extendedKeyUsage,false,ExtendedKeyUsage(KeyPurposeId.id_kp_serverAuth))
        val provider = BouncyCastleProvider()
        val cert = JcaX509CertificateConverter().setProvider(provider).getCertificate(certBuilder.build(
            JcaContentSignerBuilder("SHA256withECDSA").setProvider(provider).build(keys.private)))
        val store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null,null)
        val password = encode(ByteArray(32).also { SecureRandom().nextBytes(it) }).toCharArray()
        store.setKeyEntry("receiver",keys.private,password,arrayOf(cert))
        val km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(store,password)
        val context = SSLContext.getInstance("TLSv1.3"); context.init(km.keyManagers,null,SecureRandom())
        val socket = context.serverSocketFactory.createServerSocket(0,8,address) as SSLServerSocket
        socket.enabledProtocols = arrayOf("TLSv1.3")
        val token = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
        return socket to Pairing(host,socket.localPort,cert.encoded,token)
    }
    fun send(socket: SSLSocket, pair: Pairing, source: File, name: String, status: (String)->Unit) {
        val size = source.length(); require(size <= LIMIT)
        status("Hashing source file…"); val digest = prefix(source,size)
        val input = DataInputStream(BufferedInputStream(socket.inputStream,CHUNK))
        val output = DataOutputStream(BufferedOutputStream(socket.outputStream,CHUNK))
        write(output,JSONObject().put("type","offer").put("token",pair.token).put("file",JSONObject()
            .put("name",name).put("size",size).put("sha256",digest)))
        status("Waiting for receiver approval…")
        val ready = read(input); require(ready.optString("type") == "ready") { ready.optString("reason","Receiver did not accept") }
        var offset = ready.getLong("offset"); require(offset in 0..size)
        if(prefix(source,offset) != ready.getString("prefix_sha256")) offset=0
        write(output,JSONObject().put("type","start").put("offset",offset))
        RandomAccessFile(source,"r").use { file ->
            file.seek(offset); val buffer = ByteArray(CHUNK); var remaining = size-offset
            status("Sending over encrypted local connection. Receiver measures delivered speed.")
            while(remaining>0) {
                val n = minOf(remaining,CHUNK.toLong()).toInt(); file.readFully(buffer,0,n)
                output.writeInt(n); output.write(MessageDigest.getInstance("SHA-256").digest(buffer.copyOf(n))); output.write(buffer,0,n)
                remaining-=n
            }
        }
        output.flush(); status("Waiting for receiver verification and save…")
        val done = read(input); require(done.optString("type")=="done" && done.optString("sha256")==digest) { done.optString("reason","No verified delivery receipt") }
    }
    fun receive(socket: SSLSocket, token: String, directory: File,
        approve: (String,Long)->Boolean, progress: (Long,Long,Double,String)->Unit, publish: (File,String)->String): String {
        val input=DataInputStream(BufferedInputStream(socket.inputStream,CHUNK)); val output=DataOutputStream(BufferedOutputStream(socket.outputStream,CHUNK))
        val message=read(input)
        require(message.optString("type")=="offer" && MessageDigest.isEqual(hash(message.optString("token").toByteArray()),hash(token.toByteArray()))) { "Invalid pairing" }
        val file=message.getJSONObject("file"); val name=file.getString("name"); val size=file.getLong("size"); val digest=file.getString("sha256")
        require(name.isNotEmpty() && name.toByteArray(Charsets.UTF_8).size<=255 && size in 0..LIMIT && digest.matches(Regex("[a-f0-9]{64}"))) { "Invalid file offer" }
        if(!approve(name,size)) { write(output,JSONObject().put("type","reject").put("reason","Receiver declined")); error("Receiver declined") }
        directory.mkdirs(); val part=File(directory,"$digest.part")
        if(!part.exists()) part.createNewFile()
        if(part.length()>size) RandomAccessFile(part,"rw").use { it.setLength(0) }
        require(directory.usableSpace > size-part.length()+CHUNK) { "Not enough space for the receiving file" }
        val existing=part.length(); write(output,JSONObject().put("type","ready").put("offset",existing).put("prefix_sha256",prefix(part,existing)))
        val start=read(input); val offset=start.getLong("offset"); require(start.getString("type")=="start" && (offset==0L || offset==existing))
        RandomAccessFile(part,"rw").use { destination ->
            destination.setLength(offset); destination.seek(offset)
            var received=offset; var writeNanos=0L; val began=System.nanoTime(); var last=began; val buffer=ByteArray(CHUNK)
            while(received<size) {
                val n=input.readInt(); require(n in 1..CHUNK && n.toLong()<=size-received) { "Invalid chunk length" }
                val checksum=ByteArray(32); input.readFully(checksum); input.readFully(buffer,0,n)
                require(MessageDigest.isEqual(checksum,MessageDigest.getInstance("SHA-256").digest(buffer.copyOf(n)))) { "Chunk checksum mismatch" }
                val writing=System.nanoTime(); destination.write(buffer,0,n); writeNanos+=System.nanoTime()-writing; received+=n
                val now=System.nanoTime(); if(now-last>=500000000L || received==size) {
                    val elapsed=(now-began).coerceAtLeast(1).toDouble()
                    progress(received,size,(received-offset)*1e9/elapsed,if(writeNanos/elapsed>=0.7) "Measured storage writes occupy most receive time" else "Direct TLS connection. No cloud relay; maximum link capacity is not measured.")
                    last=now
                }
            }
            destination.fd.sync()
        }
        if(prefix(part,size)!=digest) { part.writeBytes(ByteArray(0)); error("File checksum mismatch; retry") }
        val saved=publish(part,name)
        write(output,JSONObject().put("type","done").put("sha256",digest).put("saved_as",saved))
        part.delete(); return saved
    }
}
