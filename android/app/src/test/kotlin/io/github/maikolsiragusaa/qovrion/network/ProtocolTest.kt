package io.github.maikolsiragusaa.qovrion.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProtocolTest {
    @Test
    fun exposesStableV1Routes() {
        assertEquals("/api/v1/peer/hello", QovrionProtocol.HELLO_PATH)
        assertEquals("/api/v1/peer/pair-request", QovrionProtocol.PAIR_REQUEST_PATH)
        assertEquals("/api/v1/peer/revoke", QovrionProtocol.REVOKE_PATH)
        assertEquals("/api/v1/usage?period=month", QovrionProtocol.usagePath("month"))
        assertEquals("qovrion.companion.usage", QovrionProtocol.USAGE_KIND)
    }

    @Test
    fun validatesConnectionInput() {
        assertEquals("192.168.1.24", QovrionProtocol.normalizeHost(" 192.168.1.24 "))
        assertEquals("fe80::1", QovrionProtocol.normalizeHost("[fe80::1]"))
        assertEquals(7777, QovrionProtocol.validatePort(7777))
    }

    @Test
    fun rejectsUrlsInvalidPortsAndUnknownPeriods() {
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.normalizeHost("https://desktop") }
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.validatePort(0) }
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.usagePath("year") }
    }

    @Test
    fun normalizesSha256Fingerprint() {
        val raw = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), QovrionProtocol.normalizeFingerprint(raw))
    }

    @Test
    fun derivesTheSameSixDigitSasAsDesktop() {
        assertEquals("404542", QovrionProtocol.pairingCode("00".repeat(32), "ff".repeat(32)))
        assertEquals("404542", QovrionProtocol.pairingCode("ff".repeat(32), "00".repeat(32)))
    }
}
