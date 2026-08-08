package eu.metrora.app.network

import java.security.MessageDigest

object MetroraProtocol {
    const val API_VERSION = 1
    const val DEFAULT_PORT = 7777
    const val HELLO_PATH = "/api/v1/peer/hello"
    const val PAIR_REQUEST_PATH = "/api/v1/peer/pair-request"
    const val REVOKE_PATH = "/api/v1/peer/revoke"
    const val USAGE_PATH = "/api/v1/usage"
    const val USAGE_KIND = "metrora.companion.usage"

    private val allowedPeriods = setOf("today", "week", "30days", "month", "all", "lifetime")

    fun normalizeHost(raw: String): String {
        val value = raw.trim().removePrefix("[").removeSuffix("]")
        require(value.isNotBlank()) { "Enter the desktop address." }
        require(value.length <= 253) { "The desktop address is too long." }
        require(!value.contains(Regex("[\\s/?#]"))) { "Enter only a hostname or IP address." }
        require(!value.contains("://")) { "Do not include a URL scheme." }
        return value
    }

    fun validatePort(port: Int): Int {
        require(port in 1..65535) { "The port must be between 1 and 65535." }
        return port
    }

    fun normalizeFingerprint(raw: String): String {
        val value = raw.trim().lowercase().replace(":", "")
        require(value.matches(Regex("[0-9a-f]{64}"))) { "Invalid certificate fingerprint." }
        return value
    }

    fun pairingCode(fingerprintA: String, fingerprintB: String): String {
        val normalized = listOf(normalizeFingerprint(fingerprintA), normalizeFingerprint(fingerprintB)).sorted()
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("${normalized[0]}|${normalized[1]}".toByteArray(Charsets.UTF_8))
        val value = ((digest[0].toLong() and 0xff) shl 24) or
            ((digest[1].toLong() and 0xff) shl 16) or
            ((digest[2].toLong() and 0xff) shl 8) or
            (digest[3].toLong() and 0xff)
        return (value % 1_000_000L).toString().padStart(6, '0')
    }

    fun usagePath(period: String): String {
        require(period in allowedPeriods) { "Unsupported usage period." }
        return "$USAGE_PATH?period=$period"
    }
}
