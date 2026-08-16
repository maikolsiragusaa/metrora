package eu.metrora.app.data

import org.json.JSONArray
import org.json.JSONObject

private const val CATALOG_MAX_PROJECT_OPTIONS = 64
private const val CATALOG_MAX_SOURCE_PROJECTS = 256
private const val CATALOG_MAX_CONTRIBUTORS = 32
private const val CATALOG_MAX_ROUTE_IDS = 8

/** Non-period-scoped Desktop Project authority cached independently of usage domains. */
data class ProjectCatalogSnapshot(
    val desktopId: String,
    val generatedAt: String,
    val retrievedAtEpochMs: Long,
    val projectOptions: List<ProjectScopeOption>,
    val sourceProjects: List<SourceProjectSummary>,
    val freshness: CapabilityFreshness = CapabilityFreshness.LIVE,
    val available: Boolean = true,
) {
    init {
        require(!available || desktopId.isNotBlank()) { "Project catalog Desktop identity is missing." }
        require(generatedAt.isNotBlank() && generatedAt.length <= 80) { "Project catalog timestamp is invalid." }
        require(retrievedAtEpochMs >= 0L) { "Project catalog retrieval timestamp is invalid." }
        require(projectOptions.size <= CATALOG_MAX_PROJECT_OPTIONS) { "Too many Project options." }
        require(projectOptions.map { it.id }.toSet().size == projectOptions.size) {
            "Project catalog options must be unique."
        }
        require(!available || projectOption("all") != null) {
            "An available Project catalog must include All projects."
        }
        require(sourceProjects.size <= CATALOG_MAX_SOURCE_PROJECTS) { "Too many Source Projects." }
    }

    fun projectOption(id: String): ProjectScopeOption? = projectOptions.firstOrNull { it.id == id }

    fun asLocallyCached(): ProjectCatalogSnapshot = copy(
        freshness = when (freshness) {
            CapabilityFreshness.LIVE, CapabilityFreshness.CACHED -> CapabilityFreshness.CACHED
            CapabilityFreshness.UNKNOWN -> CapabilityFreshness.UNKNOWN
        },
    )

    companion object {
        fun unavailable(desktopId: String = ""): ProjectCatalogSnapshot = ProjectCatalogSnapshot(
            desktopId = desktopId,
            generatedAt = "unknown",
            retrievedAtEpochMs = 0L,
            projectOptions = emptyList(),
            sourceProjects = emptyList(),
            freshness = CapabilityFreshness.UNKNOWN,
            available = false,
        )

        fun fromJson(
            raw: String,
            desktopId: String = "",
            retrievedAtEpochMs: Long = System.currentTimeMillis(),
        ): ProjectCatalogSnapshot {
            val root = JSONObject(raw)
            require(root.optString("kind") == "metrora.companion.projects") {
                "Unsupported Project catalog kind."
            }
            require(root.optInt("version", -1) == 1) { "Unsupported Project catalog version." }
            val scope = root.optJSONObject("projectScope") ?: JSONObject()
            return ProjectCatalogSnapshot(
                desktopId = root.optString("desktopId", desktopId).trim(),
                generatedAt = root.optString("generatedAt", "unknown").trim().ifBlank { "unknown" },
                retrievedAtEpochMs = root.optLong("retrievedAtEpochMs", retrievedAtEpochMs).coerceAtLeast(0L),
                projectOptions = parseProjectOptions(scope.optJSONArray("options") ?: JSONArray()),
                sourceProjects = parseSourceProjects(scope.optJSONArray("sourceProjects") ?: JSONArray()),
                freshness = when (root.optString("freshness", "live").trim().lowercase()) {
                    "live" -> CapabilityFreshness.LIVE
                    "cached" -> CapabilityFreshness.CACHED
                    else -> CapabilityFreshness.UNKNOWN
                },
                available = root.optBoolean("available", true),
            )
        }

        private fun parseProjectOptions(array: JSONArray): List<ProjectScopeOption> = buildList {
            for (index in 0 until minOf(array.length(), CATALOG_MAX_PROJECT_OPTIONS)) {
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
            for (index in 0 until minOf(array.length(), CATALOG_MAX_SOURCE_PROJECTS)) {
                val value = array.getJSONObject(index)
                val contributors = value.optJSONArray("contributors")?.let { contributorArray ->
                    buildList {
                        for (contributorIndex in 0 until minOf(contributorArray.length(), CATALOG_MAX_CONTRIBUTORS)) {
                            val contributor = contributorArray.getJSONObject(contributorIndex)
                            add(
                                SourceProjectContributor(
                                    sourceId = contributor.getString("sourceId").trim(),
                                    routeIds = parseStrings(contributor.optJSONArray("routeIds"), CATALOG_MAX_ROUTE_IDS),
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
                        assignedProjectId = if (!value.has("assignedProjectId") || value.isNull("assignedProjectId")) {
                            null
                        } else {
                            value.optString("assignedProjectId").trim().ifBlank { null }
                        },
                        historicalOnly = value.optBoolean("historicalOnly", false),
                    ),
                )
            }
        }

        private fun parseStrings(array: JSONArray?, max: Int): List<String> = buildList {
            for (index in 0 until minOf(array?.length() ?: 0, max)) {
                val value = array?.getString(index)?.trim().orEmpty()
                require(value.isNotBlank() && value.length <= 160) { "Bounded Project identity is invalid." }
                add(value)
            }
        }
    }

    fun toJson(): String {
        fun strings(values: List<String>) = JSONArray().apply { values.forEach(::put) }
        val options = JSONArray().apply {
            projectOptions.forEach { value ->
                put(
                    JSONObject()
                        .put("id", value.id)
                        .put("name", value.name)
                        .put("icon", value.icon)
                        .put("color", value.color)
                        .put("sourceProjectCount", value.sourceProjectCount),
                )
            }
        }
        val sources = JSONArray().apply {
            sourceProjects.forEach { value ->
                val contributors = JSONArray().apply {
                    value.contributors.forEach { contributor ->
                        put(JSONObject().put("sourceId", contributor.sourceId).put("routeIds", strings(contributor.routeIds)))
                    }
                }
                put(
                    JSONObject()
                        .put("id", value.id)
                        .put("name", value.name)
                        .put("contributors", contributors)
                        .putOpt("assignedProjectId", value.assignedProjectId)
                        .put("historicalOnly", value.historicalOnly),
                )
            }
        }
        return JSONObject()
            .put("kind", "metrora.companion.projects")
            .put("version", 1)
            .put("desktopId", desktopId)
            .put("generatedAt", generatedAt)
            .put("retrievedAtEpochMs", retrievedAtEpochMs)
            .put("freshness", freshness.name.lowercase())
            .put("available", available)
            .put("projectScope", JSONObject().put("options", options).put("sourceProjects", sources))
            .toString()
    }
}
