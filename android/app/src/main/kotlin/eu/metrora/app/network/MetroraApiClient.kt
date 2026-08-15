package eu.metrora.app.network

import eu.metrora.app.MetroraException
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraOperation
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.security.ClientIdentity
import eu.metrora.app.security.DeviceIdentity
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.InvalidKeyException
import java.security.UnrecoverableKeyException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

data class DiscoveredDesktop(
    val host: String,
    val port: Int,
    val name: String,
    val fingerprint: String,
)

interface MetroraApi {
    suspend fun discover(host: String, port: Int): DiscoveredDesktop

    fun pairingCode(desktop: DiscoveredDesktop): String

    suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials

    suspend fun fetchUsage(credentials: PairingCredentials, period: String = "month"): UsageSnapshot

    suspend fun revoke(credentials: PairingCredentials)

    fun localIdentityMatches(credentials: PairingCredentials): Boolean
}

class MetroraApiClient(
    private val identity: ClientIdentity = DeviceIdentity(),
    private val transport: MetroraTransport = TlsMetroraTransport(identity),
) : MetroraApi {
    override suspend fun discover(host: String, port: Int): DiscoveredDesktop = mapped(MetroraOperation.DISCOVER) {
        val normalizedHost = try {
            MetroraProtocol.normalizeHost(host)
        } catch (error: IllegalArgumentException) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.INVALID_HOST,
                "Desktop address validation failed",
                error,
            )
        }
        val normalizedPort = try {
            MetroraProtocol.validatePort(port)
        } catch (error: IllegalArgumentException) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.INVALID_PORT,
                "Desktop port validation failed",
                error,
            )
        }
        val response = transport.request(
            host = normalizedHost,
            port = normalizedPort,
            method = "GET",
            path = MetroraProtocol.HELLO_PATH,
            expectedFingerprint = null,
        )
        ensureSuccess(MetroraOperation.DISCOVER, response)
        val json = parseJson(MetroraOperation.DISCOVER, response.body)
        if (json.optString("product") != "metrora") {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.DESKTOP_NOT_METRORA,
                "The endpoint identified a different product",
            )
        }
        if (!supportsApiV1(json)) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.PROTOCOL_VERSION_UNSUPPORTED,
                "The endpoint does not advertise companion API v1",
            )
        }
        val supportsApprovedPairing = json.optJSONArray("pairingMethods")?.let { methods ->
            (0 until methods.length()).any { index -> methods.optString(index) == "approve-sas" }
        } == true
        if (!supportsApprovedPairing) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.PAIRING_NOT_AVAILABLE,
                "The endpoint does not advertise approved pairing",
            )
        }
        val advertisedFingerprint = try {
            MetroraProtocol.normalizeFingerprint(json.getString("fingerprint"))
        } catch (error: Exception) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.MALFORMED_RESPONSE,
                MetroraFailureReason.MALFORMED_RESPONSE,
                "The endpoint returned an invalid identity",
                error,
            )
        }
        if (advertisedFingerprint != response.serverFingerprint) {
            throw failure(
                MetroraOperation.DISCOVER,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.CERTIFICATE_MISMATCH,
                "Advertised and presented desktop identities differ",
            )
        }
        DiscoveredDesktop(
            host = normalizedHost,
            port = normalizedPort,
            name = json.optString("name").trim().ifBlank { normalizedHost }.take(120),
            fingerprint = advertisedFingerprint,
        )
    }

    override fun pairingCode(desktop: DiscoveredDesktop): String = try {
        MetroraProtocol.pairingCode(desktop.fingerprint, identity.fingerprint())
    } catch (error: Exception) {
        throw failure(
            MetroraOperation.PAIR,
            MetroraFailureCategory.IDENTITY_SECURITY,
            MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
            "The phone identity is unavailable",
            error,
        )
    }

    override suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials = mapped(MetroraOperation.PAIR) {
        val clientFingerprint = try {
            identity.fingerprint()
        } catch (error: Exception) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
                "The phone identity is unavailable",
                error,
            )
        }
        val localCode = try {
            MetroraProtocol.pairingCode(desktop.fingerprint, clientFingerprint)
        } catch (error: Exception) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
                "The phone identity changed while pairing",
                error,
            )
        }
        if (localCode != expectedCode) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
                "The phone identity changed while pairing",
            )
        }
        val response = transport.request(
            host = desktop.host,
            port = desktop.port,
            method = "POST",
            path = MetroraProtocol.PAIR_REQUEST_PATH,
            expectedFingerprint = desktop.fingerprint,
            body = JSONObject()
                .put("name", deviceName.trim().ifBlank { "Android" }.take(80))
                .toString(),
            readTimeoutMs = PAIRING_TIMEOUT_MS,
        )
        ensureSuccess(MetroraOperation.PAIR, response)
        val json = parseJson(MetroraOperation.PAIR, response.body)
        val returnedFingerprint = try {
            MetroraProtocol.normalizeFingerprint(json.getString("fingerprint"))
        } catch (error: Exception) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.MALFORMED_RESPONSE,
                MetroraFailureReason.MALFORMED_RESPONSE,
                "The endpoint returned an invalid identity",
                error,
            )
        }
        if (returnedFingerprint != desktop.fingerprint) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.DESKTOP_IDENTITY_CHANGED,
                "The desktop identity changed during pairing",
            )
        }
        if (json.optString("code") != expectedCode) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.CONFIRMATION_CODE_MISMATCH,
                "The desktop returned a different confirmation code",
            )
        }
        val token = json.optString("token").trim()
        if (token.isBlank()) {
            throw failure(
                MetroraOperation.PAIR,
                MetroraFailureCategory.MALFORMED_RESPONSE,
                MetroraFailureReason.MALFORMED_RESPONSE,
                "The endpoint did not return a pairing credential",
            )
        }
        PairingCredentials(
            host = desktop.host,
            port = desktop.port,
            desktopName = json.optString("name").trim().ifBlank { desktop.name }.take(120),
            serverFingerprint = desktop.fingerprint,
            clientFingerprint = clientFingerprint,
            token = token,
            pairedAtEpochMs = System.currentTimeMillis(),
        )
    }

    override suspend fun fetchUsage(credentials: PairingCredentials, period: String): UsageSnapshot =
        mapped(MetroraOperation.REFRESH) {
            requireCurrentIdentity(credentials, MetroraOperation.REFRESH)
            val response = transport.request(
                host = credentials.host,
                port = credentials.port,
                method = "GET",
                path = MetroraProtocol.usagePath(period),
                expectedFingerprint = credentials.serverFingerprint,
                headers = mapOf("Authorization" to "Bearer ${credentials.token}"),
                readTimeoutMs = MetroraTransport.USAGE_READ_TIMEOUT_MS,
            )
            ensureSuccess(MetroraOperation.REFRESH, response)
            try {
                CompanionUsageV1Parser.parse(response.body, credentials)
            } catch (error: MetroraException) {
                throw error
            } catch (error: Exception) {
                throw failure(
                    MetroraOperation.REFRESH,
                    MetroraFailureCategory.MALFORMED_RESPONSE,
                    MetroraFailureReason.MALFORMED_RESPONSE,
                    "The endpoint returned an invalid usage snapshot",
                    error,
                )
            }
        }

    override suspend fun revoke(credentials: PairingCredentials) = mapped(MetroraOperation.REVOKE) {
        requireCurrentIdentity(credentials, MetroraOperation.REVOKE)
        val response = transport.request(
            host = credentials.host,
            port = credentials.port,
            method = "POST",
            path = MetroraProtocol.REVOKE_PATH,
            expectedFingerprint = credentials.serverFingerprint,
            headers = mapOf("Authorization" to "Bearer ${credentials.token}"),
        )
        ensureSuccess(MetroraOperation.REVOKE, response)
        val json = parseJson(MetroraOperation.REVOKE, response.body)
        if (!json.optBoolean("revoked", false)) {
            throw failure(
                MetroraOperation.REVOKE,
                MetroraFailureCategory.UNEXPECTED,
                MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED,
                "The desktop did not confirm revocation",
            )
        }
    }

    override fun localIdentityMatches(credentials: PairingCredentials): Boolean =
        runCatching { identity.fingerprint() == credentials.clientFingerprint }.getOrDefault(false)

    private fun requireCurrentIdentity(credentials: PairingCredentials, operation: MetroraOperation) {
        if (!localIdentityMatches(credentials)) {
            throw failure(
                operation = operation,
                category = MetroraFailureCategory.IDENTITY_SECURITY,
                reason = MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
                detail = "The phone identity no longer matches the saved pairing",
            )
        }
    }

    private fun supportsApiV1(json: JSONObject): Boolean {
        val apiVersion = json.optInt("apiVersion", -1)
        return apiVersion == MetroraProtocol.API_VERSION ||
            (json.optJSONArray("apiVersions")?.let { versions ->
                (0 until versions.length()).any { index -> versions.optInt(index, -1) == MetroraProtocol.API_VERSION }
            } == true)
    }

    private fun parseJson(operation: MetroraOperation, body: String): JSONObject = try {
        JSONObject(body)
    } catch (error: Exception) {
        throw failure(
            operation,
            MetroraFailureCategory.MALFORMED_RESPONSE,
            MetroraFailureReason.MALFORMED_RESPONSE,
            "The endpoint returned malformed JSON",
            error,
        )
    }

    private fun ensureSuccess(operation: MetroraOperation, response: MetroraResponse) {
        if (response.status == 200) return
        val marker = runCatching { JSONObject(response.body).optString("error").lowercase() }.getOrDefault("")
        val mapped = when {
            response.status == 401 && operation == MetroraOperation.REVOKE ->
                MetroraFailure(
                    operation,
                    MetroraFailureCategory.IDENTITY_SECURITY,
                    MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED,
                    "HTTP 401",
                )
            response.status == 401 -> MetroraFailure(
                operation,
                MetroraFailureCategory.IDENTITY_SECURITY,
                MetroraFailureReason.UNAUTHORIZED,
                "HTTP 401",
            )
            response.status == 403 && operation == MetroraOperation.PAIR &&
                marker.contains("not accepting") -> MetroraFailure(
                operation,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.PAIRING_NOT_AVAILABLE,
                "HTTP 403",
            )
            response.status == 403 && operation == MetroraOperation.PAIR -> MetroraFailure(
                operation,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.PAIRING_DECLINED_OR_EXPIRED,
                "HTTP 403",
            )
            response.status == 404 || response.status == 405 -> MetroraFailure(
                operation,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.COMPANION_API_UNAVAILABLE,
                "HTTP ${response.status}",
            )
            response.status == 409 -> MetroraFailure(
                operation,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.ALREADY_PAIRED,
                "HTTP 409",
            )
            response.status >= 500 -> MetroraFailure(
                operation,
                MetroraFailureCategory.UNEXPECTED,
                MetroraFailureReason.UNEXPECTED_SERVER_BEHAVIOR,
                "HTTP ${response.status}",
            )
            else -> MetroraFailure(
                operation,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.COMPANION_API_UNAVAILABLE,
                "HTTP ${response.status}",
            )
        }
        throw MetroraException(mapped)
    }

    private suspend fun <T> mapped(operation: MetroraOperation, block: suspend () -> T): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: MetroraException) {
        throw error
    } catch (error: Exception) {
        throw MetroraException(classify(operation, error), error)
    }

    private fun classify(operation: MetroraOperation, error: Exception): MetroraFailure {
        val reason = when {
            isLocalKeyFailure(error) -> MetroraFailureReason.KEY_UNAVAILABLE
            error is SocketTimeoutException -> MetroraFailureReason.TIMEOUT
            error is UnknownHostException || error is ConnectException -> MetroraFailureReason.DESKTOP_UNREACHABLE
            isCertificateFailure(error) -> MetroraFailureReason.CERTIFICATE_MISMATCH
            else -> MetroraFailureReason.UNKNOWN
        }
        val category = when (reason) {
            MetroraFailureReason.TIMEOUT,
            MetroraFailureReason.DESKTOP_UNREACHABLE,
            -> MetroraFailureCategory.CONNECTIVITY
            MetroraFailureReason.CERTIFICATE_MISMATCH -> MetroraFailureCategory.IDENTITY_SECURITY
            MetroraFailureReason.KEY_UNAVAILABLE -> MetroraFailureCategory.LOCAL_STATE
            else -> MetroraFailureCategory.UNEXPECTED
        }
        return MetroraFailure(operation, category, reason, safeCauseChain(error))
    }

    private fun isLocalKeyFailure(error: Throwable): Boolean = causeChain(error).any { cause ->
        cause is InvalidKeyException ||
            cause is UnrecoverableKeyException ||
            cause.javaClass.name == "android.security.KeyStoreException"
    }

    private fun isCertificateFailure(error: Throwable): Boolean = causeChain(error).any { cause ->
        cause is CertificateException ||
            cause is SSLPeerUnverifiedException ||
            (cause is SSLHandshakeException && cause.cause is CertificateException)
    }

    private fun safeCauseChain(error: Throwable): String = causeChain(error)
        .map { cause -> cause.javaClass.simpleName.ifBlank { cause.javaClass.name.substringAfterLast('.') } }
        .distinct()
        .take(MAX_DIAGNOSTIC_CAUSES)
        .joinToString(" -> ")

    private fun causeChain(error: Throwable): Sequence<Throwable> =
        generateSequence(error) { cause -> cause.cause }

    private fun failure(
        operation: MetroraOperation,
        category: MetroraFailureCategory,
        reason: MetroraFailureReason,
        detail: String,
        cause: Throwable? = null,
    ): MetroraException = MetroraException(
        MetroraFailure(operation, category, reason, detail),
        cause,
    )

    private companion object {
        const val PAIRING_TIMEOUT_MS = 70_000
        const val MAX_DIAGNOSTIC_CAUSES = 4
    }
}
