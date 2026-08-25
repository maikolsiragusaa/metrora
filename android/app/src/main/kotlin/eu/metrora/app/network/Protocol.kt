package eu.metrora.app.network

import java.security.MessageDigest
import eu.metrora.app.data.ActivityQuery

object MetroraProtocol {
    const val API_VERSION = 1
    const val DEFAULT_PORT = 7777
    const val HELLO_PATH = "/api/v1/peer/hello"
    const val PAIR_REQUEST_PATH = "/api/v1/peer/pair-request"
    const val REVOKE_PATH = "/api/v1/peer/revoke"
    const val USAGE_PATH = "/api/v1/usage"
    const val CAPABILITIES_PATH = "/api/v1/capabilities"
    const val CAPACITY_PATH = "/api/v1/capacity"
    const val FOUNDATION_PATH = "/api/v1/foundation"
    const val PROJECTS_PATH = "/api/v1/projects"
    const val ACTIVITY_SESSIONS_PATH = "/api/v1/activity/sessions"
    const val ACTIVITY_PULL_REQUESTS_PATH = "/api/v1/activity/pull-requests"
    const val USAGE_KIND = "metrora.companion.usage"
    const val CAPABILITIES_KIND = "metrora.companion.capabilities"
    const val CAPACITY_KIND = "metrora.companion.capacity"
    const val FOUNDATION_KIND = "metrora.companion.foundation"

    private val allowedPeriods = setOf("today", "week", "30days", "month", "all", "lifetime")
    private val allowedTrendGranularities = setOf("day", "week", "month")

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

    fun usagePath(period: String, granularity: String? = null, projectScopeId: String? = null): String {
        require(period in allowedPeriods) { "Unsupported usage period." }
        if (granularity != null) require(granularity in allowedTrendGranularities) { "Unsupported trend granularity." }
        val params = buildList {
            add("period=$period")
            granularity?.let { add("granularity=$it") }
            projectScopeId?.let {
                require(it == "all" || it == "unassigned" || it.matches(Regex("[a-zA-Z0-9_.:-]{1,120}"))) {
                    "Invalid Project scope."
                }
                if (it != "all") add("projectScopeId=$it")
            }
        }
        return "$USAGE_PATH?${params.joinToString("&")}"
    }

    fun capabilitiesPath(): String = CAPABILITIES_PATH

    fun projectCatalogPath(): String = PROJECTS_PATH

    fun foundationPath(period: String, granularity: String? = null, projectScopeId: String? = null): String =
        usagePath(period, granularity, projectScopeId).replace(USAGE_PATH, FOUNDATION_PATH)

    fun activitySessionsPath(query: ActivityQuery, cursor: String? = null): String =
        activityPath(ACTIVITY_SESSIONS_PATH, query, cursor)

    fun activitySessionDetailPath(query: ActivityQuery, id: String): String {
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,80}"))) { "Invalid Activity session id." }
        return activityPath("$ACTIVITY_SESSIONS_PATH/$id", query, null)
    }

    fun activityPullRequestsPath(query: ActivityQuery, cursor: String? = null): String =
        activityPath(ACTIVITY_PULL_REQUESTS_PATH, query, cursor)

    private fun activityPath(base: String, query: ActivityQuery, cursor: String?): String {
        val params = buildList {
            add("period=${encodeQueryComponent(query.period)}")
            add("order=${encodeQueryComponent(query.order)}")
            add("limit=${query.limit}")
            if (query.projectScopeId != "all") add("projectScopeId=${encodeQueryComponent(query.projectScopeId)}")
            query.provider?.let { add("provider=${encodeQueryComponent(it)}") }
            query.route?.let { add("route=${encodeQueryComponent(it)}") }
            query.model?.let { add("model=${encodeQueryComponent(it)}") }
            query.source?.let { add("source=${encodeQueryComponent(it)}") }
            cursor?.let { add("cursor=${encodeQueryComponent(it)}") }
        }
        return "$base?${params.joinToString("&")}"
    }

    private fun encodeQueryComponent(value: String): String = buildString {
        val hex = "0123456789ABCDEF"
        value.toByteArray(Charsets.UTF_8).forEach { raw ->
            val byte = raw.toInt() and 0xff
            if (byte in 0x30..0x39 || byte in 0x41..0x5a || byte in 0x61..0x7a || byte == '-'.code || byte == '.'.code || byte == '_'.code || byte == '~'.code) {
                append(byte.toChar())
            } else {
                append('%').append(hex[byte shr 4]).append(hex[byte and 0x0f])
            }
        }
    }
}
