package eu.metrora.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProtocolTest {
    @Test
    fun exposesStableV1Routes() {
        assertEquals("/api/v1/peer/hello", MetroraProtocol.HELLO_PATH)
        assertEquals("/api/v1/peer/pair-request", MetroraProtocol.PAIR_REQUEST_PATH)
        assertEquals("/api/v1/peer/revoke", MetroraProtocol.REVOKE_PATH)
        assertEquals("/api/v1/usage?period=month", MetroraProtocol.usagePath("month"))
        assertEquals("metrora.companion.usage", MetroraProtocol.USAGE_KIND)
    }

    @Test
    fun validatesConnectionInput() {
        assertEquals("192.168.1.24", MetroraProtocol.normalizeHost(" 192.168.1.24 "))
        assertEquals("fe80::1", MetroraProtocol.normalizeHost("[fe80::1]"))
        assertEquals(7777, MetroraProtocol.validatePort(7777))
    }

    @Test
    fun rejectsUrlsInvalidPortsAndUnknownPeriods() {
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.normalizeHost("https://desktop") }
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.validatePort(0) }
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.usagePath("year") }
    }

    @Test
    fun normalizesSha256Fingerprint() {
        val raw = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), MetroraProtocol.normalizeFingerprint(raw))
    }

    @Test
    fun derivesTheSameSixDigitSasAsDesktop() {
        assertEquals("404542", MetroraProtocol.pairingCode("00".repeat(32), "ff".repeat(32)))
        assertEquals("404542", MetroraProtocol.pairingCode("ff".repeat(32), "00".repeat(32)))
    }
}
