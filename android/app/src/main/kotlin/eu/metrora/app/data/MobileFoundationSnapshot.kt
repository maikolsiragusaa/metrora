package eu.metrora.app.data

import org.json.JSONArray
import org.json.JSONObject

private const val FOUNDATION_MAX_CAPABILITIES = 16
private const val FOUNDATION_MAX_PROJECT_OPTIONS = 64
private const val FOUNDATION_MAX_SOURCE_PROJECTS = 256
private const val FOUNDATION_MAX_CONTRIBUTORS = 32
private const val FOUNDATION_MAX_ROUTE_IDS = 8
private const val FOUNDATION_MAX_ACTIVITY_SESSIONS = 128
private const val FOUNDATION_MAX_MODELS = 32
private const val FOUNDATION_MAX_TREND_POINTS = 128
private const val FOUNDATION_MAX_DISPLAY_LENGTH = 120
private const val FOUNDATION_MAX_TIMESTAMP_LENGTH = 80
private val FOUNDATION_SAFE_ID = Regex("[a-zA-Z0-9_.:-]{1,120}")
private val FOUNDATION_DATE_PATTERN = Regex("\\d{4}-\\d{2}-\\d{2}")

private fun foundationSafeDisplayName(value: String): Boolean = value.isNotBlank() &&
    value.length <= FOUNDATION_MAX_DISPLAY_LENGTH &&
    !value.contains('/') && !value.contains('\\')

enum class CapabilityAvailability {
    AVAILABLE,
    UNAVAILABLE,
}

enum class CapabilityFreshness {
    LIVE,
    CACHED,
    UNKNOWN,
}

data class CapabilityDescriptor(
    val id: String,
    val versions: List<Int>,
    val availability: CapabilityAvailability,
    val freshness: CapabilityFreshness,
    val periodScoped: Boolean,
    val projectScoped: Boolean,
    val workspaceScoped: Boolean,
    val reason: String? = null,
) {
    init {
        require(id.matches(FOUNDATION_SAFE_ID)) { "Capability id is invalid." }
        require(versions.isNotEmpty() && versions.size <= 4) { "Capability versions are invalid." }
        require(versions.all { it in 1..32 }) { "Capability version is invalid." }
        require(reason == null || reason.matches(FOUNDATION_SAFE_ID)) { "Capability reason is invalid." }
    }
}

data class CapabilityDiscovery(
    val generatedAt: String,
    val capabilities: List<CapabilityDescriptor>,
    val available: Boolean = true,
) {
    init {
        require(generatedAt.length <= FOUNDATION_MAX_TIMESTAMP_LENGTH) { "Capability timestamp is invalid." }
        require(capabilities.size <= FOUNDATION_MAX_CAPABILITIES) { "Too many capabilities." }
        require(capabilities.map { it.id }.toSet().size == capabilities.size) {
            "Capability ids must be unique."
        }
    }

    fun isAvailable(id: String): Boolean = available && capabilities.any {
        it.id == id && it.availability == CapabilityAvailability.AVAILABLE
    }

    companion object {
        fun unavailable(): CapabilityDiscovery = CapabilityDiscovery(
            generatedAt = "unknown",
            capabilities = emptyList(),
            available = false,
        )
    }
}

data class ProjectScopeOption(
    val id: String,
    val name: String,
    val icon: String,
    val color: String,
    val sourceProjectCount: Int,
) {
    init {
        require(id == "all" || id == "unassigned" || id.matches(FOUNDATION_SAFE_ID)) { "Project id is invalid." }
        require(name.isNotBlank() && name.length <= FOUNDATION_MAX_DISPLAY_LENGTH) { "Project name is invalid." }
        require(icon.matches(FOUNDATION_SAFE_ID)) { "Project icon is invalid." }
        require(color.matches(FOUNDATION_SAFE_ID)) { "Project color is invalid." }
        require(sourceProjectCount >= 0) { "Source Project count cannot be negative." }
    }
}

data class SourceProjectContributor(
    val sourceId: String,
    val routeIds: List<String>,
) {
    init {
        require(sourceId.isNotBlank() && sourceId.length <= 120) { "Source identity is invalid." }
        require(routeIds.size <= FOUNDATION_MAX_ROUTE_IDS) { "Too many route identities." }
        require(routeIds.all { it.isNotBlank() && it.length <= 120 }) { "Route identity is invalid." }
    }
}

data class SourceProjectSummary(
    val id: String,
    val name: String,
    val contributors: List<SourceProjectContributor>,
    val assignedProjectId: String?,
) {
    init {
        require(id.startsWith("sp_") && id.length <= 80) { "Source Project id is invalid." }
        require(foundationSafeDisplayName(name)) { "Source Project name is not privacy-safe." }
        require(contributors.size <= FOUNDATION_MAX_CONTRIBUTORS) { "Too many Source Project contributors." }
        require(assignedProjectId == null || assignedProjectId == "unassigned" || assignedProjectId.matches(FOUNDATION_SAFE_ID)) {
            "Assigned Project id is invalid."
        }
    }
}

data class MobileActivitySession(
    val id: String,
    val projectId: String,
    val sourceProjectId: String,
    val sourceProjectName: String,
    val title: String,
    val sourceIds: List<String>,
    val routeIds: List<String>,
    val brandIds: List<String>,
    val models: List<String>,
    val costMicrosUsd: Long,
    val calls: Long,
    val turns: Long,
    val startedAt: String,
    val endedAt: String,
) {
    init {
        require(id.matches(FOUNDATION_SAFE_ID) && id.length <= 80) { "Activity session id is invalid." }
        require(projectId == "unassigned" || projectId.matches(FOUNDATION_SAFE_ID)) { "Activity Project id is invalid." }
        require(sourceProjectId.startsWith("sp_") && sourceProjectId.length <= 80) {
            "Activity Source Project id is invalid."
        }
        require(foundationSafeDisplayName(sourceProjectName)) { "Activity Source Project name is not privacy-safe." }
        require(title.startsWith("Session") && title.length <= FOUNDATION_MAX_DISPLAY_LENGTH) {
            "Activity title is not content-minimal."
        }
        require(sourceIds.size <= FOUNDATION_MAX_ROUTE_IDS && routeIds.size <= FOUNDATION_MAX_ROUTE_IDS && brandIds.size <= FOUNDATION_MAX_ROUTE_IDS) {
            "Activity provenance is unbounded."
        }
        require(models.size <= FOUNDATION_MAX_MODELS && models.all { it.isNotBlank() && it.length <= 160 }) {
            "Activity model metadata is invalid."
        }
        require(costMicrosUsd >= 0L && calls >= 0L && turns >= 0L) { "Activity totals cannot be negative." }
        require(startedAt.length <= FOUNDATION_MAX_TIMESTAMP_LENGTH && endedAt.length <= FOUNDATION_MAX_TIMESTAMP_LENGTH) {
            "Activity timestamp is invalid."
        }
    }
}

data class AnalyzeModelUsage(
    val name: String,
    val routeId: String?,
    val sourceIds: List<String>,
    val brandId: String?,
    val calls: Long,
    val costMicrosUsd: Long,
    val inputTokens: Long,
    val outputTokens: Long,
    val cacheReadTokens: Long,
    val cacheWriteTokens: Long,
) {
    init {
        require(name.isNotBlank() && name.length <= 160) { "Analyze model name is invalid." }
        require(routeId == null || routeId.length <= 120) { "Analyze route identity is invalid." }
        require(sourceIds.size <= FOUNDATION_MAX_ROUTE_IDS && sourceIds.all { it.isNotBlank() && it.length <= 120 }) {
            "Analyze source identities are invalid."
        }
        require(brandId == null || brandId.length <= 120) { "Analyze brand identity is invalid." }
        require(listOf(calls, costMicrosUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens).all { it >= 0L }) {
            "Analyze totals cannot be negative."
        }
    }
}

data class SpendTrendPoint(
    val date: String,
    val costMicrosUsd: Long,
) {
    init {
        require(date.matches(FOUNDATION_DATE_PATTERN)) { "Spend trend date is invalid." }
        require(costMicrosUsd >= 0L) { "Spend trend cost cannot be negative." }
    }
}

data class MobileSpendSummary(
    val costMicrosUsd: Long,
    val calls: Long,
    val sessions: Long,
    val trend: List<SpendTrendPoint>,
) {
    init {
        require(costMicrosUsd >= 0L && calls >= 0L && sessions >= 0L) { "Spend totals cannot be negative." }
        require(trend.size <= FOUNDATION_MAX_TREND_POINTS) { "Spend trend is unbounded." }
    }
}

data class MobileFoundationSnapshot(
    val desktopId: String,
    val generatedAt: String,
    val retrievedAtEpochMs: Long,
    val projectScopeId: String,
    val projectOptions: List<ProjectScopeOption>,
    val sourceProjects: List<SourceProjectSummary>,
    val capabilities: CapabilityDiscovery,
    val activitySessions: List<MobileActivitySession>,
    val analyzeModels: List<AnalyzeModelUsage>,
    val spend: MobileSpendSummary?,
    val workspaceAvailable: Boolean,
    val available: Boolean = true,
) {
    init {
        require(!available || desktopId.isNotBlank()) { "Foundation desktop identity is missing." }
        require(generatedAt.length <= FOUNDATION_MAX_TIMESTAMP_LENGTH) { "Foundation timestamp is invalid." }
        require(retrievedAtEpochMs >= 0L) { "Foundation retrieval timestamp is invalid." }
        require(projectScopeId == "all" || projectScopeId == "unassigned" || projectScopeId.matches(FOUNDATION_SAFE_ID)) {
            "Foundation Project scope is invalid."
        }
        require(projectOptions.size <= FOUNDATION_MAX_PROJECT_OPTIONS) { "Too many Project options." }
        require(sourceProjects.size <= FOUNDATION_MAX_SOURCE_PROJECTS) { "Too many Source Projects." }
        require(activitySessions.size <= FOUNDATION_MAX_ACTIVITY_SESSIONS) { "Too many Activity sessions." }
        require(analyzeModels.size <= FOUNDATION_MAX_MODELS) { "Too many Analyze models." }
    }

    fun projectOption(id: String): ProjectScopeOption? = projectOptions.firstOrNull { it.id == id }

    companion object {
        fun unavailable(desktopId: String = ""): MobileFoundationSnapshot = MobileFoundationSnapshot(
            desktopId = desktopId,
            generatedAt = "unknown",
            retrievedAtEpochMs = 0L,
            projectScopeId = "all",
            projectOptions = emptyList(),
            sourceProjects = emptyList(),
            capabilities = CapabilityDiscovery.unavailable(),
            activitySessions = emptyList(),
            analyzeModels = emptyList(),
            spend = null,
            workspaceAvailable = false,
            available = false,
        )

        fun fromJson(
            raw: String,
            desktopId: String = "",
            retrievedAtEpochMs: Long = System.currentTimeMillis(),
        ): MobileFoundationSnapshot {
            val root = JSONObject(raw)
            require(root.optString("kind") == "metrora.companion.foundation") {
                "Unsupported mobile foundation kind."
            }
            require(root.optInt("version", -1) == 1) { "Unsupported mobile foundation version." }
            return parse(root, desktopId, retrievedAtEpochMs)
        }

        private fun parse(root: JSONObject, fallbackDesktopId: String, retrievedAtEpochMs: Long): MobileFoundationSnapshot {
            val projects = root.optJSONObject("projectScope") ?: JSONObject()
            val projectOptions = parseProjectOptions(projects.optJSONArray("options") ?: JSONArray())
            val sourceProjects = parseSourceProjects(projects.optJSONArray("sourceProjects") ?: JSONArray())
            val capabilities = parseCapabilities(root.optJSONObject("capabilities") ?: JSONObject())
            val activity = root.optJSONObject("activity")
            val analyze = root.optJSONObject("analyze")
            val models = analyze?.optJSONObject("models")?.optJSONArray("rows")?.let(::parseModels) ?: emptyList()
            val spend = analyze?.optJSONObject("spend")?.optJSONObject("data")?.let(::parseSpend)
            return MobileFoundationSnapshot(
                desktopId = root.optString("desktopId", fallbackDesktopId).trim(),
                generatedAt = root.getString("generatedAt").trim(),
                retrievedAtEpochMs = root.optLong("retrievedAtEpochMs", retrievedAtEpochMs).coerceAtLeast(0L),
                projectScopeId = projects.optString("selectedId", "all").trim().ifBlank { "all" },
                projectOptions = projectOptions,
                sourceProjects = sourceProjects,
                capabilities = capabilities,
                activitySessions = activity?.optJSONArray("sessions")?.let(::parseActivity) ?: emptyList(),
                analyzeModels = models,
                spend = spend,
                workspaceAvailable = root.optJSONObject("workspace")?.optBoolean("available", false) == true,
                available = root.optBoolean("available", true),
            )
        }

        private fun parseProjectOptions(array: JSONArray): List<ProjectScopeOption> = buildList {
            for (index in 0 until minOf(array.length(), FOUNDATION_MAX_PROJECT_OPTIONS)) {
                val value = array.getJSONObject(index)
                add(
                    ProjectScopeOption(
                        id = value.getString("id").trim(),
                        name = value.getString("name").trim(),
                        icon = value.getString("icon").trim().lowercase(),
                        color = value.getString("color").trim().lowercase(),
                        sourceProjectCount = value.optInt("sourceProjectCount", 0),
                    ),
                )
            }
        }

        private fun parseSourceProjects(array: JSONArray): List<SourceProjectSummary> = buildList {
            for (index in 0 until minOf(array.length(), FOUNDATION_MAX_SOURCE_PROJECTS)) {
                val value = array.getJSONObject(index)
                val contributors = value.optJSONArray("contributors")?.let { contributorsJson ->
                    buildList {
                        for (contributorIndex in 0 until minOf(contributorsJson.length(), FOUNDATION_MAX_CONTRIBUTORS)) {
                            val contributor = contributorsJson.getJSONObject(contributorIndex)
                            add(
                                SourceProjectContributor(
                                    sourceId = contributor.getString("sourceId").trim(),
                                    routeIds = parseStrings(contributor.optJSONArray("routeIds"), FOUNDATION_MAX_ROUTE_IDS),
                                ),
                            )
                        }
                    }
                } ?: emptyList()
                add(
                    SourceProjectSummary(
                        id = value.getString("id").trim(),
                        name = value.getString("name").trim(),
                        contributors = contributors,
                        assignedProjectId = value.optNullableString("assignedProjectId"),
                    ),
                )
            }
        }

        private fun parseCapabilities(root: JSONObject): CapabilityDiscovery {
            if (root.optString("kind") != "metrora.companion.capabilities" || root.optInt("version", -1) != 1) {
                return CapabilityDiscovery.unavailable()
            }
            val capabilities = buildList {
                val array = root.optJSONArray("capabilities") ?: JSONArray()
                for (index in 0 until minOf(array.length(), FOUNDATION_MAX_CAPABILITIES)) {
                    val value = array.getJSONObject(index)
                    val scopes = value.optJSONObject("scopes") ?: JSONObject()
                    add(
                        CapabilityDescriptor(
                            id = value.getString("id").trim(),
                            versions = parseInts(value.optJSONArray("versions"), 4),
                            availability = when (value.getString("availability")) {
                                "available" -> CapabilityAvailability.AVAILABLE
                                "unavailable" -> CapabilityAvailability.UNAVAILABLE
                                else -> throw IllegalArgumentException("Unsupported capability availability.")
                            },
                            freshness = when (value.optString("freshness", "unknown")) {
                                "live" -> CapabilityFreshness.LIVE
                                "cached" -> CapabilityFreshness.CACHED
                                else -> CapabilityFreshness.UNKNOWN
                            },
                            periodScoped = scopes.optBoolean("period", false),
                            projectScoped = scopes.optBoolean("project", false),
                            workspaceScoped = scopes.optBoolean("workspace", false),
                            reason = value.optNullableString("reason"),
                        ),
                    )
                }
            }
            return CapabilityDiscovery(
                generatedAt = root.optString("generatedAt", "unknown"),
                capabilities = capabilities,
            )
        }

        private fun parseActivity(array: JSONArray): List<MobileActivitySession> = buildList {
            for (index in 0 until minOf(array.length(), FOUNDATION_MAX_ACTIVITY_SESSIONS)) {
                val value = array.getJSONObject(index)
                add(
                    MobileActivitySession(
                        id = value.getString("id").trim(),
                        projectId = value.getString("projectId").trim(),
                        sourceProjectId = value.getString("sourceProjectId").trim(),
                        sourceProjectName = value.getString("sourceProjectName").trim(),
                        title = value.getString("title").trim(),
                        sourceIds = parseStrings(value.optJSONArray("sourceIds"), FOUNDATION_MAX_ROUTE_IDS),
                        routeIds = parseStrings(value.optJSONArray("routeIds"), FOUNDATION_MAX_ROUTE_IDS),
                        brandIds = parseStrings(value.optJSONArray("brandIds"), FOUNDATION_MAX_ROUTE_IDS),
                        models = parseStrings(value.optJSONArray("models"), FOUNDATION_MAX_MODELS),
                        costMicrosUsd = value.nonNegativeLong("costMicrosUsd"),
                        calls = value.nonNegativeLong("calls"),
                        turns = value.nonNegativeLong("turns"),
                        startedAt = value.optString("startedAt", "unknown"),
                        endedAt = value.optString("endedAt", "unknown"),
                    ),
                )
            }
        }

        private fun parseModels(array: JSONArray): List<AnalyzeModelUsage> = buildList {
            for (index in 0 until minOf(array.length(), FOUNDATION_MAX_MODELS)) {
                val value = array.getJSONObject(index)
                add(
                    AnalyzeModelUsage(
                        name = value.getString("name").trim(),
                        routeId = value.optNullableString("routeId"),
                        sourceIds = parseStrings(value.optJSONArray("sourceIds"), FOUNDATION_MAX_ROUTE_IDS),
                        brandId = value.optNullableString("brandId"),
                        calls = value.nonNegativeLong("calls"),
                        costMicrosUsd = value.nonNegativeLong("costMicrosUsd"),
                        inputTokens = value.nonNegativeLong("inputTokens"),
                        outputTokens = value.nonNegativeLong("outputTokens"),
                        cacheReadTokens = value.nonNegativeLong("cacheReadTokens"),
                        cacheWriteTokens = value.nonNegativeLong("cacheWriteTokens"),
                    ),
                )
            }
        }

        private fun parseSpend(value: JSONObject): MobileSpendSummary = MobileSpendSummary(
            costMicrosUsd = value.nonNegativeLong("costMicrosUsd"),
            calls = value.nonNegativeLong("calls"),
            sessions = value.nonNegativeLong("sessions"),
            trend = buildList {
                val array = value.optJSONArray("trend") ?: JSONArray()
                for (index in 0 until minOf(array.length(), FOUNDATION_MAX_TREND_POINTS)) {
                    val point = array.getJSONObject(index)
                    add(
                        SpendTrendPoint(
                            date = point.getString("date").trim(),
                            costMicrosUsd = point.nonNegativeLong("costMicrosUsd"),
                        ),
                    )
                }
            },
        )

        private fun parseStrings(array: JSONArray?, max: Int): List<String> = buildList {
            for (index in 0 until minOf(array?.length() ?: 0, max)) {
                val value = array?.getString(index)?.trim().orEmpty()
                require(value.isNotBlank() && value.length <= 160) { "Bounded identity is invalid." }
                add(value)
            }
        }

        private fun parseInts(array: JSONArray?, max: Int): List<Int> = buildList {
            for (index in 0 until minOf(array?.length() ?: 0, max)) add(array!!.getInt(index))
        }

        private fun JSONObject.nonNegativeLong(name: String): Long = getLong(name).also {
            require(it >= 0L) { "$name cannot be negative." }
        }

        private fun JSONObject.optNullableString(name: String): String? =
            if (!has(name) || isNull(name)) null else optString(name).trim().takeIf { it.isNotBlank() }

    }

    fun toJson(): String {
        fun strings(values: List<String>) = JSONArray().apply { values.forEach(::put) }
        val optionJson = JSONArray().apply {
            projectOptions.forEach { value ->
                put(JSONObject().put("id", value.id).put("name", value.name).put("icon", value.icon).put("color", value.color).put("sourceProjectCount", value.sourceProjectCount))
            }
        }
        val sourceJson = JSONArray().apply {
            sourceProjects.forEach { value ->
                val contributors = JSONArray().apply {
                    value.contributors.forEach { contributor ->
                        put(JSONObject().put("sourceId", contributor.sourceId).put("routeIds", strings(contributor.routeIds)))
                    }
                }
                put(JSONObject().put("id", value.id).put("name", value.name).put("contributors", contributors).putOpt("assignedProjectId", value.assignedProjectId))
            }
        }
        val capabilityJson = JSONObject().put("kind", "metrora.companion.capabilities").put("version", 1).put("generatedAt", capabilities.generatedAt)
            .put("capabilities", JSONArray().apply {
                capabilities.capabilities.forEach { value ->
                    put(
                        JSONObject()
                            .put("id", value.id)
                            .put("versions", JSONArray().apply { value.versions.forEach(::put) })
                            .put("availability", if (value.availability == CapabilityAvailability.AVAILABLE) "available" else "unavailable")
                            .put("freshness", value.freshness.name.lowercase())
                            .put("scopes", JSONObject().put("period", value.periodScoped).put("project", value.projectScoped).put("workspace", value.workspaceScoped))
                            .putOpt("reason", value.reason),
                    )
                }
            })
        val activityJson = JSONArray().apply {
            activitySessions.forEach { value ->
                put(
                    JSONObject()
                        .put("id", value.id).put("projectId", value.projectId).put("sourceProjectId", value.sourceProjectId)
                        .put("sourceProjectName", value.sourceProjectName).put("title", value.title)
                        .put("sourceIds", strings(value.sourceIds)).put("routeIds", strings(value.routeIds)).put("brandIds", strings(value.brandIds))
                        .put("models", strings(value.models)).put("costMicrosUsd", value.costMicrosUsd).put("calls", value.calls).put("turns", value.turns)
                        .put("startedAt", value.startedAt).put("endedAt", value.endedAt),
                )
            }
        }
        val modelJson = JSONArray().apply {
            analyzeModels.forEach { value ->
                put(
                    JSONObject().put("name", value.name).putOpt("routeId", value.routeId).put("sourceIds", strings(value.sourceIds)).putOpt("brandId", value.brandId)
                        .put("calls", value.calls).put("costMicrosUsd", value.costMicrosUsd).put("inputTokens", value.inputTokens).put("outputTokens", value.outputTokens)
                        .put("cacheReadTokens", value.cacheReadTokens).put("cacheWriteTokens", value.cacheWriteTokens),
                )
            }
        }
        val spendJson = spend?.let { value ->
            JSONObject().put("costMicrosUsd", value.costMicrosUsd).put("calls", value.calls).put("sessions", value.sessions)
                .put("trend", JSONArray().apply { value.trend.forEach { point -> put(JSONObject().put("date", point.date).put("costMicrosUsd", point.costMicrosUsd)) } })
        }
        return JSONObject()
            .put("kind", "metrora.companion.foundation")
            .put("version", 1)
            .put("desktopId", desktopId)
            .put("generatedAt", generatedAt)
            .put("retrievedAtEpochMs", retrievedAtEpochMs)
            .put("projectScope", JSONObject().put("selectedId", projectScopeId).put("options", optionJson).put("sourceProjects", sourceJson))
            .put("capabilities", capabilityJson)
            .put("activity", JSONObject().put("available", activitySessions.isNotEmpty() || available).put("sessions", activityJson))
            .put("analyze", JSONObject().put("models", JSONObject().put("available", analyzeModels.isNotEmpty() || available).put("rows", modelJson)).put("spend", JSONObject().put("available", spend != null).putOpt("data", spendJson)))
            .put("workspace", JSONObject().put("available", workspaceAvailable).putOpt("reason", if (workspaceAvailable) null else "no-authority"))
            .put("available", available)
            .toString()
    }
}
