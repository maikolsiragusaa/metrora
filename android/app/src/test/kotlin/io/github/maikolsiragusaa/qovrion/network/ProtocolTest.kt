package io.github.maikolsiragusaa.qovrion.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProtocolTest {
    @Test
    fun exposesStableV1Routes() {
        assertEquals("/api/v1/peer/hello", QovrionProtocol.HELLO_PATH)
        assertEquals("/api/v1/peer/pair", QovrionProtocol.PAIR_PATH)
        assertEquals("/api/v1/usage?period=month", QovrionProtocol.usagePath("month"))
    }

    @Test
    fun validatesManualPairingInput() {
        assertEquals("192.168.1.24", QovrionProtocol.normalizeHost(" 192.168.1.24 "))
        assertEquals("fe80::1", QovrionProtocol.normalizeHost("[fe80::1]"))
        assertEquals("123456", QovrionProtocol.validatePin("123456"))
        assertEquals(7777, QovrionProtocol.validatePort(7777))
    }

    @Test
    fun rejectsUrlsInvalidPinsAndUnknownPeriods() {
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.normalizeHost("https://desktop") }
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.validatePin("12345") }
        assertThrows(IllegalArgumentException::class.java) { QovrionProtocol.usagePath("year") }
    }

    @Test
    fun normalizesSha256Fingerprint() {
        val raw = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), QovrionProtocol.normalizeFingerprint(raw))
    }
}
