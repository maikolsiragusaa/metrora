package eu.metrora.app.network

import eu.metrora.app.data.ActivityPageMeta
import eu.metrora.app.data.ActivityPullRequest
import eu.metrora.app.data.ActivityPullRequestsPage
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySessionDetail
import eu.metrora.app.data.ActivitySessionsPage
import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.PairingCredentials
import org.json.JSONArray
import org.json.JSONObject

internal object ActivityV1Parser {
    fun parseSessions(raw: String, credentials: PairingCredentials, expectedQuery: ActivityQuery? = null): ActivitySessionsPage {
        val root = JSONObject(raw)
        require(root.optString("kind") == "metrora.companion.activity.sessions") { "Unsupported Activity Sessions contract." }
        require(root.optInt("version", -1) == 1) { "Unsupported Activity Sessions version." }
        val query = parseQuery(root.getJSONObject("query"))
        validateDesktop(root, credentials, query, expectedQuery)
        val sessions = buildList {
            val array = root.optJSONArray("sessions") ?: JSONArray()
            for (index in 0 until minOf(array.length(), 50)) add(ActivitySnapshot.parseSession(array.getJSONObject(index)))
        }
        require(sessions.all { projectMatchesScope(it.projectId, query.projectScopeId) }) {
            "Activity session Project scope does not match the response query."
        }
        return ActivitySessionsPage(
            meta = parseMeta(root, credentials, query),
            sessions = sessions,
        )
    }

    fun parseSessionDetail(raw: String, credentials: PairingCredentials, expectedQuery: ActivityQuery? = null): ActivitySessionDetail {
        val root = JSONObject(raw)
        require(root.optString("kind") == "metrora.companion.activity.session") { "Unsupported Activity session detail contract." }
        require(root.optInt("version", -1) == 1) { "Unsupported Activity session detail version." }
        val query = parseQuery(root.getJSONObject("query"))
        validateDesktop(root, credentials, query, expectedQuery)
        return ActivitySnapshot.parseDetail(root.getJSONObject("session")).also {
            require(projectMatchesScope(it.session.projectId, query.projectScopeId)) {
                "Activity detail Project scope does not match the response query."
            }
        }
    }

    fun parsePullRequests(raw: String, credentials: PairingCredentials, expectedQuery: ActivityQuery? = null): ActivityPullRequestsPage {
        val root = JSONObject(raw)
        require(root.optString("kind") == "metrora.companion.activity.pullRequests") { "Unsupported Activity Pull Request contract." }
        require(root.optInt("version", -1) == 1) { "Unsupported Activity Pull Request version." }
        val query = parseQuery(root.getJSONObject("query"))
        validateDesktop(root, credentials, query, expectedQuery)
        val rows = buildList {
            val array = root.optJSONArray("pullRequests") ?: JSONArray()
            for (index in 0 until minOf(array.length(), 50)) add(ActivitySnapshot.parsePullRequest(array.getJSONObject(index)))
        }
        return ActivityPullRequestsPage(
            meta = parseMeta(root, credentials, query).copy(
                totalCount = root.optLong("totalCount", rows.size.toLong()).coerceAtLeast(0L),
            ),
            attributedCostMicrosUsd = nonNegativeLong(root, "attributedCostMicrosUsd"),
            unattributedCostMicrosUsd = nonNegativeLong(root, "unattributedCostMicrosUsd"),
            pullRequests = rows,
        )
    }

    private fun parseQuery(value: JSONObject): ActivityQuery {
        // Effective bounds are retained in the wire response and checked for
        // presence/shape here. The Android query remains on the existing
        // period presets; it does not invent custom-range semantics.
        require(value.optString("effectiveFrom").matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { "Activity effective start is invalid." }
        require(value.optString("effectiveTo").matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { "Activity effective end is invalid." }
        return ActivityQuery(
            period = value.getString("period").trim(),
            projectScopeId = value.getString("projectScopeId").trim(),
            provider = value.optNullableString("provider"),
            route = value.optNullableString("route"),
            model = value.optNullableString("model"),
            source = value.optNullableString("source"),
            order = value.optString("order", "newest"),
            limit = value.optInt("limit", 40),
            effectiveFrom = value.optString("effectiveFrom").trim(),
            effectiveTo = value.optString("effectiveTo").trim(),
        )
    }

    private fun parseMeta(root: JSONObject, credentials: PairingCredentials, query: ActivityQuery): ActivityPageMeta = ActivityPageMeta(
        desktopId = root.getString("desktopId").trim().also { require(it == credentials.serverFingerprint) { "Activity Desktop identity does not match pairing." } },
        generatedAt = root.getString("generatedAt").trim(),
        query = query,
        freshness = parseFreshness(root.optString("freshness")),
        coverage = DetailCoverage.fromWire(root.optString("coverage")),
        totalCount = if (!root.has("totalCount") || root.isNull("totalCount")) null else root.getLong("totalCount").also { require(it >= 0L) },
        availableCount = nonNegativeLong(root, "availableCount"),
        hasMore = root.optBoolean("hasMore", false),
        nextCursor = root.optNullableString("nextCursor"),
    )

    private fun validateDesktop(root: JSONObject, credentials: PairingCredentials, query: ActivityQuery, expectedQuery: ActivityQuery?) {
        require(root.getString("desktopId") == credentials.serverFingerprint) { "Activity Desktop identity does not match pairing." }
        expectedQuery?.let {
            require(query.matchesRequest(it)) { "Activity response query does not match request." }
        }
    }

    private fun projectMatchesScope(projectId: String, scopeId: String): Boolean = when (scopeId) {
        "all" -> projectId == "unassigned" || projectId.startsWith("mp_")
        "unassigned" -> projectId == "unassigned"
        else -> projectId == scopeId
    }

    private fun parseFreshness(value: String?): CapabilityFreshness = when (value?.trim()?.lowercase()) {
        "live" -> CapabilityFreshness.LIVE
        "cached" -> CapabilityFreshness.CACHED
        else -> CapabilityFreshness.UNKNOWN
    }

    private fun nonNegativeLong(root: JSONObject, name: String): Long = root.getLong(name).also { require(it >= 0L) }

    private fun JSONObject.optNullableString(name: String): String? = if (!has(name) || isNull(name)) null else optString(name).trim().takeIf { it.isNotBlank() }
}
