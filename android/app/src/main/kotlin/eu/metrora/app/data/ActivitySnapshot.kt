package eu.metrora.app.data

import org.json.JSONArray
import org.json.JSONObject

private const val ACTIVITY_CACHE_KIND = "metrora.mobile.activity.cache"
private const val ACTIVITY_CACHE_VERSION = 1
private const val MAX_ACTIVITY_ROWS = 500
private const val MAX_ACTIVITY_CATEGORIES = 32
private const val MAX_ACTIVITY_IDENTITIES = 8
private const val MAX_ACTIVITY_MODELS = 16
private const val MAX_ACTIVITY_TEXT = 160
private const val MAX_ACTIVITY_TIMESTAMP = 80
private val ACTIVITY_SAFE_ID = Regex("[a-zA-Z0-9_.:-]{1,160}")

enum class ActivityTab {
    SESSIONS,
    PULL_REQUESTS,
}

data class ActivityQuery(
    val period: String,
    val projectScopeId: String,
    val provider: String? = null,
    val route: String? = null,
    val model: String? = null,
    val source: String? = null,
    val order: String = "newest",
    val limit: Int = 40,
    /** Desktop-resolved bounds. Null only before the first authoritative response. */
    val effectiveFrom: String? = null,
    val effectiveTo: String? = null,
) {
    init {
        require(period in setOf("today", "week", "30days", "month", "all", "lifetime")) { "Activity period is invalid." }
        require(projectScopeId == "all" || projectScopeId == "unassigned" || projectScopeId.matches(ACTIVITY_SAFE_ID)) {
            "Activity Project scope is invalid."
        }
        listOf(provider, route, model, source).forEach { value ->
            require(value == null || safeActivityText(value)) { "Activity filter is invalid." }
        }
        require(order in setOf("newest", "cost", "tokens", "calls")) { "Activity ordering is invalid." }
        require(limit in 1..50) { "Activity page size is invalid." }
        require((effectiveFrom == null) == (effectiveTo == null)) { "Activity effective bounds must be paired." }
        listOf(effectiveFrom, effectiveTo).forEach { value ->
            require(value == null || value.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { "Activity effective bound is invalid." }
        }
        if (effectiveFrom != null && effectiveTo != null) require(effectiveFrom <= effectiveTo) { "Activity effective bounds are reversed." }
    }

    fun cacheKey(desktopId: String, pageCursor: String? = null): String = listOf(
        desktopId,
        "activity",
        projectScopeId,
        period,
        provider.orEmpty(),
        route.orEmpty(),
        model.orEmpty(),
        source.orEmpty(),
        order,
        limit,
        effectiveFrom.orEmpty(),
        effectiveTo.orEmpty(),
        pageCursor.orEmpty(),
    ).joinToString("\u0000")

    /** Match a request against an authoritative response without guessing bounds. */
    fun matchesRequest(request: ActivityQuery): Boolean =
        period == request.period &&
            projectScopeId == request.projectScopeId &&
            provider == request.provider &&
            route == request.route &&
            model == request.model &&
            source == request.source &&
            order == request.order &&
            limit == request.limit &&
            (request.effectiveFrom == null || effectiveFrom == request.effectiveFrom) &&
            (request.effectiveTo == null || effectiveTo == request.effectiveTo)
}

data class ActivitySession(
    val id: String,
    val projectId: String,
    val sourceProjectId: String,
    val sourceProjectName: String,
    val title: String,
    val sourceIds: List<String>,
    val routeIds: List<String>,
    val brandIds: List<String>,
    val models: List<String>,
    val costMicrosUsd: Long?,
    val estimatedCostMicrosUsd: Long?,
    val calls: Long,
    val turns: Long,
    val totalTokens: Long?,
    val tokenCoverage: DetailCoverage,
    val pricingCoverage: DetailCoverage,
    val startedAt: String,
    val endedAt: String,
) {
    init {
        require(id.matches(ACTIVITY_SAFE_ID) && id.length <= 80) { "Activity session id is invalid." }
        require(projectId == "unassigned" || projectId.startsWith("mp_") && projectId.matches(ACTIVITY_SAFE_ID)) { "Activity Project id is invalid." }
        require(sourceProjectId.startsWith("sp_") && sourceProjectId.length <= 80 && sourceProjectId.matches(ACTIVITY_SAFE_ID)) { "Activity Source Project id is invalid." }
        require(safeDisplayName(sourceProjectName)) { "Activity Source Project name is not privacy-safe." }
        require(title.startsWith("Session") && title.length <= MAX_ACTIVITY_TEXT) { "Activity title is not content-minimal." }
        require(sourceIds.size <= MAX_ACTIVITY_IDENTITIES && routeIds.size <= MAX_ACTIVITY_IDENTITIES && brandIds.size <= MAX_ACTIVITY_IDENTITIES) {
            "Activity provenance is unbounded."
        }
        require((sourceIds + routeIds + brandIds).all(::safeActivityText)) { "Activity provenance is invalid." }
        require(models.size <= MAX_ACTIVITY_MODELS && models.all(::safeActivityText)) {
            "Activity model metadata is invalid."
        }
        require((costMicrosUsd == null || costMicrosUsd >= 0L) && (estimatedCostMicrosUsd == null || estimatedCostMicrosUsd >= 0L)) {
            "Activity cost cannot be negative."
        }
        require(calls >= 0L && turns >= 0L) { "Activity counts cannot be negative." }
        require(totalTokens == null || totalTokens >= 0L) { "Activity tokens cannot be negative." }
        require(safeActivityText(startedAt, MAX_ACTIVITY_TIMESTAMP)) { "Activity start is invalid." }
        require(safeActivityText(endedAt, MAX_ACTIVITY_TIMESTAMP)) { "Activity end is invalid." }
    }
}

data class ActivitySessionDetail(
    val session: ActivitySession,
    val durationMs: Long?,
    val inputTokens: Long?,
    val outputTokens: Long?,
    val reasoningTokens: Long?,
    val cacheReadTokens: Long?,
    val cacheWriteTokens: Long?,
    val cacheReusePercent: Double?,
    val reasoningSemantics: String,
    val detailCoverage: DetailCoverage,
) {
    init {
        require(durationMs == null || durationMs >= 0L) { "Activity duration cannot be negative." }
        listOf(inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens).forEach { value ->
            require(value == null || value >= 0L) { "Activity token detail cannot be negative." }
        }
        require(cacheReusePercent == null || cacheReusePercent.isFinite() && cacheReusePercent in 0.0..100.0) {
            "Activity cache reuse is invalid."
        }
        require(reasoningSemantics in setOf("separate", "aggregate-output", "unavailable", "mixed")) {
            "Activity reasoning semantics are invalid."
        }
    }
}

data class ActivityPageMeta(
    val desktopId: String,
    val generatedAt: String,
    val query: ActivityQuery,
    val freshness: CapabilityFreshness,
    val coverage: DetailCoverage,
    val totalCount: Long?,
    val availableCount: Long,
    val hasMore: Boolean,
    val nextCursor: String?,
) {
    init {
        require(desktopId.isNotBlank()) { "Activity Desktop identity is missing." }
        require(generatedAt.isNotBlank() && generatedAt.length <= MAX_ACTIVITY_TIMESTAMP) { "Activity timestamp is invalid." }
        require(totalCount == null || totalCount >= 0L) { "Activity total cannot be negative." }
        require(availableCount >= 0L) { "Activity available count cannot be negative." }
        require(nextCursor == null || nextCursor.length in 1..768) { "Activity cursor is invalid." }
        require(!hasMore || nextCursor != null) { "Activity continuation cursor is missing." }
    }
}

data class ActivitySessionsPage(
    val meta: ActivityPageMeta,
    val sessions: List<ActivitySession>,
)

data class ActivityCategory(
    val name: String,
    val costMicrosUsd: Long,
) {
    init {
        require(safeActivityText(name, 120)) { "Activity category is invalid." }
        require(costMicrosUsd >= 0L) { "Activity category cost cannot be negative." }
    }
}

data class ActivityPullRequest(
    val id: String,
    val reference: String,
    val url: String?,
    val dateFrom: String,
    val dateTo: String,
    val costMicrosUsd: Long,
    val calls: Long,
    val linkedSessionCount: Long,
    val models: List<String>,
    val approximate: Boolean,
    val categoryCoverage: DetailCoverage,
    val categories: List<ActivityCategory>,
) {
    init {
        require(id.matches(ACTIVITY_SAFE_ID) && id.length <= 80) { "Pull Request id is invalid." }
        require(safeActivityText(reference)) { "Pull Request reference is invalid." }
        require(url == null || url.matches(Regex("https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+")) && url.length <= 320) { "Pull Request URL is invalid." }
        require(safeActivityText(dateFrom, MAX_ACTIVITY_TIMESTAMP)) { "Pull Request start is invalid." }
        require(safeActivityText(dateTo, MAX_ACTIVITY_TIMESTAMP)) { "Pull Request end is invalid." }
        require(costMicrosUsd >= 0L && calls >= 0L && linkedSessionCount >= 0L) { "Pull Request totals cannot be negative." }
        require(models.size <= MAX_ACTIVITY_MODELS && models.all { it.isNotBlank() && it.length <= MAX_ACTIVITY_TEXT }) {
            "Pull Request models are unbounded."
        }
        require(categories.size <= MAX_ACTIVITY_CATEGORIES) { "Pull Request categories are unbounded." }
    }
}

data class ActivityPullRequestsPage(
    val meta: ActivityPageMeta,
    val attributedCostMicrosUsd: Long,
    val unattributedCostMicrosUsd: Long,
    val pullRequests: List<ActivityPullRequest>,
) {
    init {
        require(attributedCostMicrosUsd >= 0L && unattributedCostMicrosUsd >= 0L) { "Pull Request accounting cannot be negative." }
    }
}

data class ActivitySnapshot(
    val desktopId: String,
    val retrievedAtEpochMs: Long,
    val query: ActivityQuery,
    val sessions: List<ActivitySession>,
    val sessionNextCursor: String?,
    val sessionHasMore: Boolean,
    val sessionTotalCount: Long?,
    val sessionAvailableCount: Long,
    val sessionCoverage: DetailCoverage,
    val pullRequests: List<ActivityPullRequest>,
    val pullRequestNextCursor: String?,
    val pullRequestHasMore: Boolean,
    val pullRequestTotalCount: Long,
    val pullRequestAvailableCount: Long,
    val pullRequestCoverage: DetailCoverage,
    val attributedCostMicrosUsd: Long,
    val unattributedCostMicrosUsd: Long,
    val freshness: CapabilityFreshness,
    val selectedSession: ActivitySessionDetail? = null,
    val selectedPullRequest: ActivityPullRequest? = null,
) {
    init {
        require(desktopId.isNotBlank()) { "Activity Desktop identity is missing." }
        require(retrievedAtEpochMs >= 0L) { "Activity retrieval timestamp is invalid." }
        require(sessions.size <= MAX_ACTIVITY_ROWS && pullRequests.size <= MAX_ACTIVITY_ROWS) { "Activity cache is unbounded." }
        require(sessionAvailableCount >= 0L && pullRequestAvailableCount >= 0L) { "Activity available count is invalid." }
        require(sessionTotalCount == null || sessionTotalCount >= 0L) { "Activity session total is invalid." }
        require(pullRequestTotalCount >= 0L) { "Activity Pull Request total is invalid." }
        require(attributedCostMicrosUsd >= 0L && unattributedCostMicrosUsd >= 0L) { "Activity accounting is invalid." }
    }

    fun asLocallyCached(): ActivitySnapshot = copy(freshness = when (freshness) {
        CapabilityFreshness.LIVE, CapabilityFreshness.CACHED -> CapabilityFreshness.CACHED
        CapabilityFreshness.UNKNOWN -> CapabilityFreshness.UNKNOWN
    })

    companion object {
        fun unavailable(desktopId: String, query: ActivityQuery): ActivitySnapshot = ActivitySnapshot(
            desktopId = desktopId,
            retrievedAtEpochMs = 0L,
            query = query,
            sessions = emptyList(),
            sessionNextCursor = null,
            sessionHasMore = false,
            sessionTotalCount = null,
            sessionAvailableCount = 0L,
            sessionCoverage = DetailCoverage.UNAVAILABLE,
            pullRequests = emptyList(),
            pullRequestNextCursor = null,
            pullRequestHasMore = false,
            pullRequestTotalCount = 0L,
            pullRequestAvailableCount = 0L,
            pullRequestCoverage = DetailCoverage.UNAVAILABLE,
            attributedCostMicrosUsd = 0L,
            unattributedCostMicrosUsd = 0L,
            freshness = CapabilityFreshness.UNKNOWN,
        )

        fun fromJson(raw: String): ActivitySnapshot {
            val root = JSONObject(raw)
            require(root.optString("kind") == ACTIVITY_CACHE_KIND && root.optInt("version", -1) == ACTIVITY_CACHE_VERSION) {
                "Unsupported Activity cache version."
            }
            val queryObject = root.getJSONObject("query")
            val query = ActivityQuery(
                period = queryObject.getString("period"),
                projectScopeId = queryObject.getString("projectScopeId"),
                provider = queryObject.optNullableString("provider"),
                route = queryObject.optNullableString("route"),
                model = queryObject.optNullableString("model"),
                source = queryObject.optNullableString("source"),
                order = queryObject.optString("order", "newest"),
                limit = queryObject.optInt("limit", 40),
                effectiveFrom = queryObject.optNullableString("effectiveFrom"),
                effectiveTo = queryObject.optNullableString("effectiveTo"),
            )
            val sessions = parseSessions(root.optJSONArray("sessions") ?: JSONArray())
            val pullRequests = parsePullRequests(root.optJSONArray("pullRequests") ?: JSONArray())
            return ActivitySnapshot(
                desktopId = root.getString("desktopId"),
                retrievedAtEpochMs = root.optLong("retrievedAtEpochMs", 0L).coerceAtLeast(0L),
                query = query,
                sessions = sessions,
                sessionNextCursor = root.optNullableString("sessionNextCursor"),
                sessionHasMore = root.optBoolean("sessionHasMore", false),
                sessionTotalCount = root.optNullableLong("sessionTotalCount"),
                sessionAvailableCount = root.optLong("sessionAvailableCount", sessions.size.toLong()).coerceAtLeast(0L),
                sessionCoverage = DetailCoverage.fromWire(root.optString("sessionCoverage")),
                pullRequests = pullRequests,
                pullRequestNextCursor = root.optNullableString("pullRequestNextCursor"),
                pullRequestHasMore = root.optBoolean("pullRequestHasMore", false),
                pullRequestTotalCount = root.optLong("pullRequestTotalCount", pullRequests.size.toLong()).coerceAtLeast(0L),
                pullRequestAvailableCount = root.optLong("pullRequestAvailableCount", pullRequests.size.toLong()).coerceAtLeast(0L),
                pullRequestCoverage = DetailCoverage.fromWire(root.optString("pullRequestCoverage")),
                attributedCostMicrosUsd = root.nonNegativeLong("attributedCostMicrosUsd"),
                unattributedCostMicrosUsd = root.nonNegativeLong("unattributedCostMicrosUsd"),
                freshness = parseFreshness(root.optString("freshness")),
                selectedSession = root.optJSONObject("selectedSession")?.let(::parseDetail),
                selectedPullRequest = root.optJSONObject("selectedPullRequest")?.let(::parsePullRequest),
            )
        }

        private fun parseSessions(array: JSONArray): List<ActivitySession> = buildList {
            for (index in 0 until minOf(array.length(), MAX_ACTIVITY_ROWS)) add(parseSession(array.getJSONObject(index)))
        }

        private fun parsePullRequests(array: JSONArray): List<ActivityPullRequest> = buildList {
            for (index in 0 until minOf(array.length(), MAX_ACTIVITY_ROWS)) add(parsePullRequest(array.getJSONObject(index)))
        }

        internal fun parseSession(value: JSONObject): ActivitySession = ActivitySession(
            id = value.getString("id").trim(),
            projectId = value.getString("projectId").trim(),
            sourceProjectId = value.getString("sourceProjectId").trim(),
            sourceProjectName = value.getString("sourceProjectName").trim(),
            title = value.getString("title").trim(),
            sourceIds = value.optJSONArray("sourceIds").parseStrings(MAX_ACTIVITY_IDENTITIES),
            routeIds = value.optJSONArray("routeIds").parseStrings(MAX_ACTIVITY_IDENTITIES),
            brandIds = value.optJSONArray("brandIds").parseStrings(MAX_ACTIVITY_IDENTITIES),
            models = value.optJSONArray("models").parseStrings(MAX_ACTIVITY_MODELS),
            costMicrosUsd = value.optNullableLong("costMicrosUsd"),
            estimatedCostMicrosUsd = value.optNullableLong("estimatedCostMicrosUsd"),
            calls = value.nonNegativeLong("calls"),
            turns = value.nonNegativeLong("turns"),
            totalTokens = value.optNullableLong("totalTokens"),
            tokenCoverage = DetailCoverage.fromWire(value.optString("tokenCoverage")),
            pricingCoverage = DetailCoverage.fromWire(value.optString("pricingCoverage")),
            startedAt = value.getString("startedAt").trim(),
            endedAt = value.getString("endedAt").trim(),
        )

        internal fun parseDetail(value: JSONObject): ActivitySessionDetail {
            val session = value.optJSONObject("session")?.let(::parseSession) ?: parseSession(value)
            return ActivitySessionDetail(
                session = session,
                durationMs = value.optNullableLong("durationMs"),
                inputTokens = value.optNullableLong("inputTokens"),
                outputTokens = value.optNullableLong("outputTokens"),
                reasoningTokens = value.optNullableLong("reasoningTokens"),
                cacheReadTokens = value.optNullableLong("cacheReadTokens"),
                cacheWriteTokens = value.optNullableLong("cacheWriteTokens"),
                cacheReusePercent = value.optNullableDouble("cacheReusePercent"),
                reasoningSemantics = value.optString("reasoningSemantics", "unavailable"),
                detailCoverage = DetailCoverage.fromWire(value.optString("detailCoverage")),
            )
        }

        internal fun parsePullRequest(value: JSONObject): ActivityPullRequest = ActivityPullRequest(
            id = value.getString("id").trim(),
            reference = value.getString("reference").trim(),
            url = value.optNullableString("url"),
            dateFrom = value.getString("dateFrom").trim(),
            dateTo = value.getString("dateTo").trim(),
            costMicrosUsd = value.nonNegativeLong("costMicrosUsd"),
            calls = value.nonNegativeLong("calls"),
            linkedSessionCount = value.nonNegativeLong("linkedSessionCount"),
            models = value.optJSONArray("models").parseStrings(MAX_ACTIVITY_MODELS),
            approximate = value.optBoolean("approximate", false),
            categoryCoverage = DetailCoverage.fromWire(value.optString("categoryCoverage")),
            categories = buildList {
                val array = value.optJSONArray("categories") ?: JSONArray()
                for (index in 0 until minOf(array.length(), MAX_ACTIVITY_CATEGORIES)) {
                    val category = array.getJSONObject(index)
                    add(ActivityCategory(category.getString("name").trim(), category.nonNegativeLong("costMicrosUsd")))
                }
            },
        )
    }

    fun toJson(): String {
        fun strings(values: List<String>) = JSONArray().apply { values.forEach(::put) }
        fun session(value: ActivitySession) = JSONObject()
            .put("id", value.id).put("projectId", value.projectId).put("sourceProjectId", value.sourceProjectId)
            .put("sourceProjectName", value.sourceProjectName).put("title", value.title)
            .put("sourceIds", strings(value.sourceIds)).put("routeIds", strings(value.routeIds)).put("brandIds", strings(value.brandIds))
            .put("models", strings(value.models)).putOpt("costMicrosUsd", value.costMicrosUsd)
            .putOpt("estimatedCostMicrosUsd", value.estimatedCostMicrosUsd).put("calls", value.calls).put("turns", value.turns)
            .putOpt("totalTokens", value.totalTokens).put("tokenCoverage", value.tokenCoverage.name.lowercase())
            .put("pricingCoverage", value.pricingCoverage.name.lowercase()).put("startedAt", value.startedAt).put("endedAt", value.endedAt)
        fun pullRequest(value: ActivityPullRequest) = JSONObject()
            .put("id", value.id).put("reference", value.reference).putOpt("url", value.url).put("dateFrom", value.dateFrom).put("dateTo", value.dateTo)
            .put("costMicrosUsd", value.costMicrosUsd).put("calls", value.calls).put("linkedSessionCount", value.linkedSessionCount)
            .put("models", strings(value.models)).put("approximate", value.approximate).put("categoryCoverage", value.categoryCoverage.name.lowercase())
            .put("categories", JSONArray().apply { value.categories.forEach { put(JSONObject().put("name", it.name).put("costMicrosUsd", it.costMicrosUsd)) } })
        fun detail(value: ActivitySessionDetail) = JSONObject()
            .put("session", session(value.session)).putOpt("durationMs", value.durationMs).putOpt("inputTokens", value.inputTokens)
            .putOpt("outputTokens", value.outputTokens).putOpt("reasoningTokens", value.reasoningTokens)
            .putOpt("cacheReadTokens", value.cacheReadTokens).putOpt("cacheWriteTokens", value.cacheWriteTokens)
            .putOpt("cacheReusePercent", value.cacheReusePercent).put("reasoningSemantics", value.reasoningSemantics)
            .put("detailCoverage", value.detailCoverage.name.lowercase())
        return JSONObject()
            .put("kind", ACTIVITY_CACHE_KIND).put("version", ACTIVITY_CACHE_VERSION).put("desktopId", desktopId)
            .put("retrievedAtEpochMs", retrievedAtEpochMs)
            .put("query", JSONObject().put("period", query.period).put("projectScopeId", query.projectScopeId)
                .putOpt("provider", query.provider).putOpt("route", query.route).putOpt("model", query.model).putOpt("source", query.source)
                .put("order", query.order).put("limit", query.limit)
                .putOpt("effectiveFrom", query.effectiveFrom).putOpt("effectiveTo", query.effectiveTo))
            .put("sessions", JSONArray().apply { sessions.forEach { put(session(it)) } })
            .putOpt("sessionNextCursor", sessionNextCursor).put("sessionHasMore", sessionHasMore).putOpt("sessionTotalCount", sessionTotalCount)
            .put("sessionAvailableCount", sessionAvailableCount).put("sessionCoverage", sessionCoverage.name.lowercase())
            .put("pullRequests", JSONArray().apply { pullRequests.forEach { put(pullRequest(it)) } })
            .putOpt("pullRequestNextCursor", pullRequestNextCursor).put("pullRequestHasMore", pullRequestHasMore)
            .put("pullRequestTotalCount", pullRequestTotalCount).put("pullRequestAvailableCount", pullRequestAvailableCount)
            .put("pullRequestCoverage", pullRequestCoverage.name.lowercase()).put("attributedCostMicrosUsd", attributedCostMicrosUsd)
            .put("unattributedCostMicrosUsd", unattributedCostMicrosUsd).put("freshness", freshness.name.lowercase())
            .putOpt("selectedSession", selectedSession?.let(::detail))
            .putOpt("selectedPullRequest", selectedPullRequest?.let(::pullRequest))
            .toString()
    }
}

private fun safeActivityText(value: String, max: Int = MAX_ACTIVITY_TEXT): Boolean =
    value.isNotBlank() && value.length <= max && value.none { it.code < 0x20 || it.code == 0x7f }

private fun safeDisplayName(value: String): Boolean = safeActivityText(value, 120) && !value.contains('/') && !value.contains('\\')

private fun parseFreshness(value: String?): CapabilityFreshness = when (value?.trim()?.lowercase()) {
    "live" -> CapabilityFreshness.LIVE
    "cached" -> CapabilityFreshness.CACHED
    else -> CapabilityFreshness.UNKNOWN
}

private fun JSONArray?.parseStrings(max: Int): List<String> = buildList {
    for (index in 0 until minOf(this@parseStrings?.length() ?: 0, max)) {
        val value = this@parseStrings?.getString(index)?.trim().orEmpty()
        require(safeActivityText(value)) { "Activity identity is invalid." }
        add(value)
    }
}

private fun JSONObject.optNullableString(name: String): String? = if (!has(name) || isNull(name)) null else optString(name).trim().takeIf { it.isNotBlank() }

private fun JSONObject.optNullableLong(name: String): Long? = if (!has(name) || isNull(name)) null else getLong(name).also { require(it >= 0L) }

private fun JSONObject.optNullableDouble(name: String): Double? = if (!has(name) || isNull(name)) null else getDouble(name).also { require(it.isFinite()) }

private fun JSONObject.nonNegativeLong(name: String): Long = getLong(name).also { require(it >= 0L) }
