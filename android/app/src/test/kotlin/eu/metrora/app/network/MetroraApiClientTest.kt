package eu.metrora.app.network

import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraException
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.security.ClientIdentity
import eu.metrora.app.security.IdentityMaterial
import java.net.SocketTimeoutException
import java.security.InvalidKeyException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class MetroraApiClientTest {
    private val desktopFingerprint = "ab".repeat(32)
    private val clientFingerprint = "cd".repeat(32)
    private val identity = FakeIdentity(clientFingerprint)
    private val transport = FakeTransport()
    private val api = MetroraApiClient(identity, transport)

    @Test
    fun discovery_success_verifies_advertised_and_presented_identity() = runTest {
        transport.response = MetroraResponse(200, helloJson(), desktopFingerprint)

        val desktop = api.discover(" desktop.local ", 7777)

        assertEquals("desktop.local", desktop.host)
        assertEquals("Metrora Desktop", desktop.name)
        assertEquals(desktopFingerprint, desktop.fingerprint)
    }

    @Test
    fun unsupported_version_is_compatibility_failure() = runTest {
        transport.response = MetroraResponse(
            200,
            """
                {"product":"metrora","apiVersion":2,"pairingMethods":["approve-sas"],"fingerprint":"$desktopFingerprint"}
            """.trimIndent(),
            desktopFingerprint,
        )

        val error = expectFailure { api.discover("desktop.local", 7777) }

        assertEquals(MetroraFailureCategory.COMPATIBILITY, error.failure.category)
        assertEquals(MetroraFailureReason.PROTOCOL_VERSION_UNSUPPORTED, error.failure.reason)
    }

    @Test
    fun malformed_usage_payload_is_not_treated_as_offline() = runTest {
        transport.response = MetroraResponse(200, "not-json", desktopFingerprint)

        val error = expectFailure { api.fetchUsage(credentials()) }

        assertEquals(MetroraFailureCategory.MALFORMED_RESPONSE, error.failure.category)
        assertEquals(MetroraFailureReason.MALFORMED_RESPONSE, error.failure.reason)
    }

    @Test
    fun unauthorized_usage_is_security_failure() = runTest {
        transport.response = MetroraResponse(401, "{\"error\":\"unauthorized\"}", desktopFingerprint)

        val error = expectFailure { api.fetchUsage(credentials()) }

        assertEquals(MetroraFailureCategory.IDENTITY_SECURITY, error.failure.category)
        assertEquals(MetroraFailureReason.UNAUTHORIZED, error.failure.reason)
    }

    @Test
    fun revoke_unauthorized_does_not_claim_remote_revocation() = runTest {
        transport.response = MetroraResponse(401, "{\"error\":\"unauthorized\"}", desktopFingerprint)

        val error = expectFailure { api.revoke(credentials()) }

        assertEquals(MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED, error.failure.reason)
    }

    @Test
    fun timeout_and_certificate_failures_keep_distinct_security_and_connectivity_categories() = runTest {
        transport.error = SocketTimeoutException("test timeout")
        val timeout = expectFailure { api.discover("desktop.local", 7777) }
        assertEquals(MetroraFailureCategory.CONNECTIVITY, timeout.failure.category)
        assertEquals(MetroraFailureReason.TIMEOUT, timeout.failure.reason)

        transport.error = SSLHandshakeException("certificate mismatch")
        val certificate = expectFailure { api.discover("desktop.local", 7777) }
        assertEquals(MetroraFailureCategory.IDENTITY_SECURITY, certificate.failure.category)
        assertEquals(MetroraFailureReason.CERTIFICATE_MISMATCH, certificate.failure.reason)
    }

    @Test
    fun tls_client_key_failure_is_local_state_not_desktop_identity_failure() = runTest {
        transport.error = SSLHandshakeException("client signing failed").apply {
            initCause(InvalidKeyException("Keystore operation failed"))
        }

        val error = expectFailure { api.discover("desktop.local", 7777) }

        assertEquals(MetroraFailureCategory.LOCAL_STATE, error.failure.category)
        assertEquals(MetroraFailureReason.KEY_UNAVAILABLE, error.failure.reason)
        assertEquals("SSLHandshakeException -> InvalidKeyException", error.failure.technicalDetail)
    }

    @Test
    fun returned_confirmation_code_mismatch_is_security_failure() = runTest {
        val desktop = DiscoveredDesktop("desktop.local", 7777, "Metrora Desktop", desktopFingerprint)
        val expected = MetroraProtocol.pairingCode(desktopFingerprint, clientFingerprint)
        transport.response = MetroraResponse(
            200,
            """
                {"token":"token-1","name":"Metrora Desktop","fingerprint":"$desktopFingerprint","code":"000000"}
            """.trimIndent(),
            desktopFingerprint,
        )

        val error = expectFailure { api.pair(desktop, expected, "Android") }

        assertEquals(MetroraFailureReason.CONFIRMATION_CODE_MISMATCH, error.failure.reason)
        assertEquals(MetroraFailureCategory.IDENTITY_SECURITY, error.failure.category)
    }

    @Test
    fun cancellation_is_not_mapped_to_an_error() = runTest {
        transport.error = CancellationException("user cancelled")

        expectCancellation { api.discover("desktop.local", 7777) }
    }

    @Test
    fun local_identity_match_is_required_for_saved_credentials() {
        assertEquals(true, api.localIdentityMatches(credentials()))
        assertNotNull(api.pairingCode(DiscoveredDesktop("desktop.local", 7777, "Desktop", desktopFingerprint)))
    }

    private fun helloJson(): String = """
        {
          "product":"metrora",
          "apiVersion":1,
          "apiVersions":[1],
          "fingerprint":"$desktopFingerprint",
          "name":"Metrora Desktop",
          "pairingMethods":["approve-sas"]
        }
    """.trimIndent()

    private fun credentials(): PairingCredentials = PairingCredentials(
        host = "desktop.local",
        port = 7777,
        desktopName = "Metrora Desktop",
        serverFingerprint = desktopFingerprint,
        clientFingerprint = clientFingerprint,
        token = "token-1",
        pairedAtEpochMs = 1L,
    )

    private suspend fun expectFailure(block: suspend () -> Unit): MetroraException = try {
        block()
        throw AssertionError("Expected MetroraException")
    } catch (error: MetroraException) {
        error
    }

    private suspend fun expectCancellation(block: suspend () -> Unit) {
        try {
            block()
            throw AssertionError("Expected cancellation")
        } catch (_: CancellationException) {
            // Expected: user cancellation is never converted to a product error.
        }
    }
}

private class FakeTransport : MetroraTransport {
    var response = MetroraResponse(200, "{}", "ab".repeat(32))
    var error: Exception? = null

    override suspend fun request(
        host: String,
        port: Int,
        method: String,
        path: String,
        expectedFingerprint: String?,
        headers: Map<String, String>,
        body: String?,
        readTimeoutMs: Int,
    ): MetroraResponse {
        error?.let { throw it }
        return response
    }
}

private class FakeIdentity(private val value: String) : ClientIdentity {
    override fun fingerprint(): String = value

    override fun material(): IdentityMaterial = error("TLS material is not needed in protocol unit tests")
}
