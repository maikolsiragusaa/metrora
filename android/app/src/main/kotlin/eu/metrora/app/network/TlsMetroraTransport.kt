package eu.metrora.app.network

import android.annotation.SuppressLint
import eu.metrora.app.security.ClientIdentity
import eu.metrora.app.security.DeviceIdentity
import eu.metrora.app.security.IdentityMaterial
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible

class TlsMetroraTransport(
    private val identity: ClientIdentity = DeviceIdentity(),
) : MetroraTransport {
    @SuppressLint("BadHostnameVerifier", "CustomX509TrustManager", "TrustAllX509TrustManager")
    override suspend fun request(
        host: String,
        port: Int,
        method: String,
        path: String,
        expectedFingerprint: String?,
        headers: Map<String, String>,
        body: String?,
        readTimeoutMs: Int,
    ): MetroraResponse = runInterruptible(Dispatchers.IO) {
        val identityMaterial = identity.material()
        val trustManager = FingerprintTrustManager(expectedFingerprint)
        val context = SSLContext.getInstance("TLS")
        context.init(arrayOf(SingleIdentityKeyManager(identityMaterial)), arrayOf(trustManager), null)
        val connection = (URL("https", urlHost(host), port, path).openConnection() as HttpsURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            this.readTimeout = readTimeoutMs
            sslSocketFactory = context.socketFactory
            hostnameVerifier = HostnameVerifier { _, _ -> true }
            useCaches = false
            doInput = true
            headers.forEach { (name, value) -> setRequestProperty(name, value) }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setFixedLengthStreamingMode(body.toByteArray(Charsets.UTF_8).size)
            }
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.use { input -> readBounded(input, MAX_RESPONSE_BYTES) }.orEmpty()
            val fingerprint = trustManager.observedFingerprint
                ?: throw CertificateException("The desktop did not present a certificate.")
            MetroraResponse(status, responseBody, fingerprint)
        } finally {
            connection.disconnect()
        }
    }

    private fun readBounded(input: InputStream, limit: Int): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            require(total <= limit) { "The desktop response was too large." }
            output.write(buffer, 0, read)
        }
        return output.toString(Charsets.UTF_8.name())
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 4_000
        const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024

        fun urlHost(host: String): String = if (host.contains(':') && !host.startsWith('[')) "[$host]" else host
    }
}

private class FingerprintTrustManager(expected: String?) : X509TrustManager {
    private val expectedFingerprint = expected?.let(MetroraProtocol::normalizeFingerprint)
    var observedFingerprint: String? = null
        private set

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val certificate = chain?.firstOrNull() ?: throw CertificateException("Missing server certificate.")
        certificate.checkValidity()
        val fingerprint = DeviceIdentity.certificateFingerprint(certificate)
        observedFingerprint = fingerprint
        expectedFingerprint?.let { expected ->
            if (!MessageDigest.isEqual(expected.toByteArray(), fingerprint.toByteArray())) {
                throw CertificateException("Server fingerprint mismatch.")
            }
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client trust validation is not supported here.")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

private class SingleIdentityKeyManager(
    private val identity: IdentityMaterial,
) : X509ExtendedKeyManager() {
    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?): Array<String> = arrayOf(identity.alias)
    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?): String = identity.alias
    override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?): String = identity.alias
    override fun getCertificateChain(alias: String?): Array<X509Certificate>? =
        if (alias == identity.alias) arrayOf(identity.certificate) else null
    override fun getPrivateKey(alias: String?): PrivateKey? = if (alias == identity.alias) identity.privateKey else null
    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null
    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null
    override fun chooseEngineServerAlias(keyType: String?, issuers: Array<out Principal>?, engine: SSLEngine?): String? = null
}
