package eu.metrora.app.data

import org.json.JSONArray
import org.json.JSONObject

data class ModelUsage(
    val name: String,
    val calls: Long,
    val costMicrosUsd: Long,
)

data class UsageSnapshot(
    val desktopId: String,
    val desktopName: String,
    val generatedAtEpochMs: Long,
    val periodLabel: String,
    val costMicrosUsd: Long,
    val calls: Long,
    val sessions: Long,
    val inputTokens: Long,
    val outputTokens: Long,
    val cacheReadTokens: Long,
    val cacheWriteTokens: Long,
    val cacheHitPercent: Double,
    val topModels: List<ModelUsage>,
) {
    val totalTokens: Long
        get() = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens

    fun toJson(): String {
        val models = JSONArray()
        topModels.forEach { model ->
            models.put(
                JSONObject()
                    .put("name", model.name)
                    .put("calls", model.calls)
                    .put("costMicrosUsd", model.costMicrosUsd),
            )
        }
        return JSONObject()
            .put("desktopId", desktopId)
            .put("desktopName", desktopName)
            .put("generatedAtEpochMs", generatedAtEpochMs)
            .put("periodLabel", periodLabel)
            .put("costMicrosUsd", costMicrosUsd)
            .put("calls", calls)
            .put("sessions", sessions)
            .put("inputTokens", inputTokens)
            .put("outputTokens", outputTokens)
            .put("cacheReadTokens", cacheReadTokens)
            .put("cacheWriteTokens", cacheWriteTokens)
            .put("cacheHitPercent", cacheHitPercent)
            .put("topModels", models)
            .toString()
    }

    companion object {
        fun fromJson(raw: String): UsageSnapshot {
            val json = JSONObject(raw)
            val modelsJson = json.optJSONArray("topModels") ?: JSONArray()
            val models = buildList {
                for (index in 0 until modelsJson.length()) {
                    val model = modelsJson.getJSONObject(index)
                    add(
                        ModelUsage(
                            name = model.getString("name"),
                            calls = model.getLong("calls"),
                            costMicrosUsd = model.getLong("costMicrosUsd"),
                        ),
                    )
                }
            }
            return UsageSnapshot(
                desktopId = json.getString("desktopId"),
                desktopName = json.getString("desktopName"),
                generatedAtEpochMs = json.getLong("generatedAtEpochMs"),
                periodLabel = json.getString("periodLabel"),
                costMicrosUsd = json.getLong("costMicrosUsd"),
                calls = json.getLong("calls"),
                sessions = json.getLong("sessions"),
                inputTokens = json.getLong("inputTokens"),
                outputTokens = json.getLong("outputTokens"),
                cacheReadTokens = json.getLong("cacheReadTokens"),
                cacheWriteTokens = json.getLong("cacheWriteTokens"),
                cacheHitPercent = json.getDouble("cacheHitPercent"),
                topModels = models,
            )
        }
    }
}
