package io.github.maikolsiragusaa.qovrion.network

object QovrionProtocol {
    const val API_VERSION = 1
    const val DEFAULT_PORT = 7777
    const val HELLO_PATH = "/api/v1/peer/hello"
    const val PAIR_PATH = "/api/v1/peer/pair"
    const val USAGE_PATH = "/api/v1/usage"

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

    fun validatePin(raw: String): String {
        val pin = raw.trim()
        require(pin.matches(Regex("\\d{6}"))) { "The pairing PIN must contain exactly six digits." }
        return pin
    }

    fun normalizeFingerprint(raw: String): String {
        val value = raw.trim().lowercase().replace(":", "")
        require(value.matches(Regex("[0-9a-f]{64}"))) { "Invalid certificate fingerprint." }
        return value
    }

    fun usagePath(period: String): String {
        require(period in allowedPeriods) { "Unsupported usage period." }
        return "$USAGE_PATH?period=$period"
    }
}
