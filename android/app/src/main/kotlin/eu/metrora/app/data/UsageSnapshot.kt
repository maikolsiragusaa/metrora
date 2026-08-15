package eu.metrora.app.data

import org.json.JSONArray
import org.json.JSONObject

data class ModelUsage(
    val name: String,
    val calls: Long,
    val costMicrosUsd: Long,
    val estimatedCostMicrosUsd: Long? = null,
) {
    init {
        require(name.isNotBlank()) { "Model name is missing." }
        require(calls >= 0L) { "Model calls cannot be negative." }
        require(costMicrosUsd >= 0L) { "Model cost cannot be negative." }
        require(estimatedCostMicrosUsd == null || estimatedCostMicrosUsd >= 0L) {
            "Estimated model cost cannot be negative."
        }
    }
}

data class CostTrendPoint(
    val date: String,
    val costMicrosUsd: Long,
) {
    init {
        require(date.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { "Trend date is invalid." }
        require(costMicrosUsd >= 0L) { "Trend cost cannot be negative." }
    }
}

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
    /** Portion of Desktop cost backed by a resolved price, or null when unknown. */
    val pricingCoverage: Double? = null,
    /** Desktop-reported portion of cost that came from estimated token pricing. */
    val estimatedCostMicrosUsd: Long? = null,
    /** Bounded, Desktop-derived daily aggregates. Empty means unavailable, not zero. */
    val costTrend: List<CostTrendPoint> = emptyList(),
    /** Local retrieval time; generatedAtEpochMs remains Desktop authority. */
    val retrievedAtEpochMs: Long = generatedAtEpochMs,
) {
    init {
        require(desktopId.isNotBlank()) { "Desktop identity is missing." }
        require(desktopName.isNotBlank()) { "Desktop name is missing." }
        require(generatedAtEpochMs >= 0L) { "Generated timestamp is invalid." }
        require(retrievedAtEpochMs >= 0L) { "Retrieval timestamp is invalid." }
        require(periodLabel.isNotBlank()) { "Usage period is missing." }
        require(costMicrosUsd >= 0L) { "Cost cannot be negative." }
        require(calls >= 0L) { "Calls cannot be negative." }
        require(sessions >= 0L) { "Sessions cannot be negative." }
        require(inputTokens >= 0L) { "Input tokens cannot be negative." }
        require(outputTokens >= 0L) { "Output tokens cannot be negative." }
        require(cacheReadTokens >= 0L) { "Cache-read tokens cannot be negative." }
        require(cacheWriteTokens >= 0L) { "Cache-write tokens cannot be negative." }
        require(cacheHitPercent.isFinite() && cacheHitPercent in 0.0..100.0) {
            "Cache-hit percentage is invalid."
        }
        require(pricingCoverage == null || pricingCoverage.isFinite() && pricingCoverage in 0.0..1.0) {
            "Pricing coverage is invalid."
        }
        require(estimatedCostMicrosUsd == null || estimatedCostMicrosUsd >= 0L) {
            "Estimated cost cannot be negative."
        }
        require(topModels.size <= MAX_TOP_MODELS) { "Too many models in local snapshot." }
        require(costTrend.size <= MAX_TREND_POINTS) { "Too many trend points in local snapshot." }
    }

    val totalTokens: Long
        get() = listOf(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens)
            .fold(0L) { total, value -> saturatingAdd(total, value) }

    fun toJson(): String {
        val models = JSONArray()
        topModels.forEach { model ->
            val modelJson = JSONObject()
                .put("name", model.name)
                .put("calls", model.calls)
                .put("costMicrosUsd", model.costMicrosUsd)
            model.estimatedCostMicrosUsd?.let { modelJson.put("estimatedCostMicrosUsd", it) }
            models.put(modelJson)
        }
        val trend = JSONArray()
        costTrend.forEach { point ->
            trend.put(
                JSONObject()
                    .put("date", point.date)
                    .put("costMicrosUsd", point.costMicrosUsd),
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
            .putOpt("pricingCoverage", pricingCoverage)
            .putOpt("estimatedCostMicrosUsd", estimatedCostMicrosUsd)
            .put("retrievedAtEpochMs", retrievedAtEpochMs)
            .put("topModels", models)
            .put("costTrend", trend)
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
                            estimatedCostMicrosUsd = model.optNullableNonNegativeLong("estimatedCostMicrosUsd"),
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
                pricingCoverage = json.optNullableFraction("pricingCoverage"),
                estimatedCostMicrosUsd = json.optNullableNonNegativeLong("estimatedCostMicrosUsd"),
                costTrend = json.optJSONArray("costTrend")?.let { trendJson ->
                    buildList {
                        for (index in 0 until minOf(trendJson.length(), MAX_TREND_POINTS)) {
                            val point = trendJson.getJSONObject(index)
                            add(
                                CostTrendPoint(
                                    date = point.getString("date"),
                                    costMicrosUsd = point.getLong("costMicrosUsd"),
                                ),
                            )
                        }
                    }
                } ?: emptyList(),
                // Older foundation snapshots did not carry a local retrieval time.
                retrievedAtEpochMs = json.optLong("retrievedAtEpochMs", json.getLong("generatedAtEpochMs")),
            )
        }

        private const val MAX_TOP_MODELS = 5
        private const val MAX_TREND_POINTS = 31

        private fun JSONObject.optNullableNonNegativeLong(name: String): Long? {
            if (!has(name) || isNull(name)) return null
            return getLong(name).also { require(it >= 0L) { "$name cannot be negative." } }
        }

        private fun JSONObject.optNullableFraction(name: String): Double? {
            if (!has(name) || isNull(name)) return null
            return getDouble(name).also {
                require(it.isFinite() && it in 0.0..1.0) { "$name is invalid." }
            }
        }

        private fun saturatingAdd(left: Long, right: Long): Long =
            if (Long.MAX_VALUE - left < right) Long.MAX_VALUE else left + right
    }
}
