package eu.metrora.app.network

import android.annotation.SuppressLint
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.security.DeviceIdentity
import eu.metrora.app.security.IdentityMaterial
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class DiscoveredDesktop(
    val host: String,
    val port: Int,
    val name: String,
    val fingerprint: String,
)

class MetroraApiClient(
    private val deviceIdentity: DeviceIdentity = DeviceIdentity(),
) {
    suspend fun discover(host: String, port: Int): DiscoveredDesktop = withContext(Dispatchers.IO) {
        val normalizedHost = MetroraProtocol.normalizeHost(host)
        val normalizedPort = MetroraProtocol.validatePort(port)
        val response = call(
            host = normalizedHost,
            port = normalizedPort,
            method = "GET",
            path = MetroraProtocol.HELLO_PATH,
            expectedFingerprint = null,
        )
        require(response.status == 200) { "The desktop did not expose the Metrora companion API." }
        val json = JSONObject(response.body)
        require(json.optString("product") == "metrora") { "The target is not a Metrora desktop." }
        val apiVersion = json.optInt("apiVersion", -1)
        val supportsV1 = apiVersion == MetroraProtocol.API_VERSION ||
            (json.optJSONArray("apiVersions")?.let { versions ->
                (0 until versions.length()).any { index -> versions.optInt(index, -1) == MetroraProtocol.API_VERSION }
            } == true)
        require(supportsV1) { "The desktop does not support Metrora companion API v1." }
        val supportsApprovedPairing = json.optJSONArray("pairingMethods")?.let { methods ->
            (0 until methods.length()).any { index -> methods.optString(index) == "approve-sas" }
        } == true
        require(supportsApprovedPairing) { "Update Metrora Desktop before pairing this phone." }
        val advertisedFingerprint = MetroraProtocol.normalizeFingerprint(json.getString("fingerprint"))
        require(advertisedFingerprint == response.serverFingerprint) { "Desktop certificate identity mismatch." }
        DiscoveredDesktop(
            host = normalizedHost,
            port = normalizedPort,
            name = json.optString("name").ifBlank { normalizedHost },
            fingerprint = advertisedFingerprint,
        )
    }

    fun pairingCode(desktop: DiscoveredDesktop): String = MetroraProtocol.pairingCode(
        desktop.fingerprint,
        deviceIdentity.material().fingerprint,
    )

    suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials = withContext(Dispatchers.IO) {
        val identity = deviceIdentity.material()
        val localCode = MetroraProtocol.pairingCode(desktop.fingerprint, identity.fingerprint)
        require(localCode == expectedCode) { "The local pairing identity changed. Start again." }
        val body = JSONObject()
            .put("name", deviceName.trim().ifBlank { "Android" })
            .toString()
        val response = call(
            host = desktop.host,
            port = desktop.port,
            method = "POST",
            path = MetroraProtocol.PAIR_REQUEST_PATH,
            expectedFingerprint = desktop.fingerprint,
            body = body,
            readTimeoutMs = PAIRING_TIMEOUT_MS,
        )
        if (response.status != 200) {
            val error = runCatching { JSONObject(response.body).optString("error") }.getOrNull().orEmpty()
            error(error.ifBlank { "Pairing failed with HTTP ${response.status}." })
        }
        val json = JSONObject(response.body)
        val returnedFingerprint = MetroraProtocol.normalizeFingerprint(json.getString("fingerprint"))
        require(returnedFingerprint == desktop.fingerprint) { "Desktop identity changed during pairing." }
        require(json.getString("code") == expectedCode) { "The pairing confirmation code changed." }
        PairingCredentials(
            host = desktop.host,
            port = desktop.port,
            desktopName = json.optString("name").ifBlank { desktop.name },
            serverFingerprint = desktop.fingerprint,
            clientFingerprint = identity.fingerprint,
            token = json.getString("token"),
            pairedAtEpochMs = System.currentTimeMillis(),
        )
    }

    suspend fun fetchUsage(credentials: PairingCredentials, period: String = "month"): UsageSnapshot =
        withContext(Dispatchers.IO) {
            requireCurrentIdentity(credentials)
            val response = call(
                host = credentials.host,
                port = credentials.port,
                method = "GET",
                path = MetroraProtocol.usagePath(period),
                expectedFingerprint = credentials.serverFingerprint,
                headers = mapOf("Authorization" to "Bearer ${credentials.token}"),
            )
            if (response.status != 200) {
                val error = runCatching { JSONObject(response.body).optString("error") }.getOrNull().orEmpty()
                error(error.ifBlank { "Usage refresh failed with HTTP ${response.status}." })
            }
            CompanionUsageV1Parser.parse(response.body, credentials)
        }

    suspend fun revoke(credentials: PairingCredentials) = withContext(Dispatchers.IO) {
        requireCurrentIdentity(credentials)
        val response = call(
            host = credentials.host,
            port = credentials.port,
            method = "POST",
            path = MetroraProtocol.REVOKE_PATH,
            expectedFingerprint = credentials.serverFingerprint,
            headers = mapOf("Authorization" to "Bearer ${credentials.token}"),
        )
        if (response.status != 200) {
            val error = runCatching { JSONObject(response.body).optString("error") }.getOrNull().orEmpty()
            error(error.ifBlank { "Access revocation failed with HTTP ${response.status}." })
        }
        require(JSONObject(response.body).optBoolean("revoked", false)) {
            "The desktop did not confirm access revocation."
        }
    }

    private fun requireCurrentIdentity(credentials: PairingCredentials) {
        require(deviceIdentity.material().fingerprint == credentials.clientFingerprint) {
            "This phone's client identity changed. Pair the desktop again."
        }
    }

    @SuppressLint("BadHostnameVerifier", "CustomX509TrustManager", "TrustAllX509TrustManager")
    private fun call(
        host: String,
        port: Int,
        method: String,
        path: String,
        expectedFingerprint: String?,
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        readTimeoutMs: Int = READ_TIMEOUT_MS,
    ): ApiResponse {
        val identity = deviceIdentity.material()
        val trustManager = FingerprintTrustManager(expectedFingerprint)
        val context = SSLContext.getInstance("TLS")
        context.init(arrayOf(SingleIdentityKeyManager(identity)), arrayOf(trustManager), SecureRandom())
        val connection = (URL("https", host, port, path).openConnection() as HttpsURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = readTimeoutMs
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
        return try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.use { input -> readBounded(input, MAX_RESPONSE_BYTES) }.orEmpty()
            val fingerprint = trustManager.observedFingerprint
                ?: error("The desktop did not present a certificate.")
            ApiResponse(status, responseBody, fingerprint)
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
        const val READ_TIMEOUT_MS = 20_000
        const val PAIRING_TIMEOUT_MS = 70_000
        const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    }
}

private data class ApiResponse(
    val status: Int,
    val body: String,
    val serverFingerprint: String,
)

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
