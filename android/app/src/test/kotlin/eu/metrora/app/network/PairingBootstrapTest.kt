package eu.metrora.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PairingBootstrapTest {
    @Test
    fun parses_bounded_metrora_connection_payload() {
        val endpoint = PairingBootstrap.parse("metrora://connect?host=desktop.local&port=7777")

        assertEquals("desktop.local", endpoint.host)
        assertEquals(7777, endpoint.port)
    }

    @Test
    fun parses_https_endpoint_with_default_port() {
        val endpoint = PairingBootstrap.parse("https://192.168.1.24/")

        assertEquals("192.168.1.24", endpoint.host)
        assertEquals(MetroraProtocol.DEFAULT_PORT, endpoint.port)
    }

    @Test
    fun rejects_non_metrora_payloads_and_urls_with_paths() {
        assertThrows(IllegalArgumentException::class.java) {
            PairingBootstrap.parse("https://example.com/account")
        }
        assertThrows(IllegalArgumentException::class.java) {
            PairingBootstrap.parse("otpauth://totp/example")
        }
    }
}
