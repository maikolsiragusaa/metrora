package eu.metrora.app.network

import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.CostTrendPoint
import eu.metrora.app.data.UsageSnapshot
import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject

internal object CompanionUsageV1Parser {
    private const val MAX_TOP_MODELS = 5

    fun parse(
        raw: String,
        credentials: PairingCredentials,
        retrievedAtEpochMs: Long = System.currentTimeMillis(),
    ): UsageSnapshot {
        val root = JSONObject(raw)
        require(root.getString("kind") == MetroraProtocol.USAGE_KIND) {
            "The desktop returned an unsupported companion payload."
        }
        require(root.getInt("version") == MetroraProtocol.API_VERSION) {
            "The desktop returned an unsupported companion schema version."
        }

        val period = root.getJSONObject("period")
        val totals = root.getJSONObject("totals")
        val tokens = totals.getJSONObject("tokens")
        val modelsJson = root.getJSONArray("topModels")
        val topModels = buildList {
            for (index in 0 until minOf(modelsJson.length(), MAX_TOP_MODELS)) {
                val model = modelsJson.getJSONObject(index)
                val name = model.getString("name").trim()
                require(name.isNotEmpty()) { "The desktop returned an unnamed model." }
                add(
                    ModelUsage(
                        name = name.take(160),
                        calls = model.nonNegativeLong("calls"),
                        costMicrosUsd = model.nonNegativeLong("costMicrosUsd"),
                        estimatedCostMicrosUsd = model.nullableNonNegativeLong("estimatedCostMicrosUsd"),
                    ),
                )
            }
        }

        val cacheHitPercent = totals.getDouble("cacheHitPercent")
        require(cacheHitPercent.isFinite() && cacheHitPercent in 0.0..100.0) {
            "The desktop returned an invalid cache-hit percentage."
        }

        val quality = root.optJSONObject("quality")
        val trend = root.optJSONObject("trend")?.let { trendJson ->
            require(trendJson.getString("granularity") == "day") {
                "The desktop returned an unsupported usage trend granularity."
            }
            val buckets = trendJson.optJSONArray("buckets")
                ?: throw IllegalArgumentException("The desktop returned an invalid usage trend.")
            parseTrend(buckets)
        } ?: emptyList()

        return UsageSnapshot(
            desktopId = credentials.serverFingerprint,
            desktopName = credentials.desktopName,
            generatedAtEpochMs = Instant.parse(root.getString("generatedAt")).toEpochMilli(),
            periodLabel = period.getString("label").trim().ifBlank { "Selected period" }.take(120),
            costMicrosUsd = totals.nonNegativeLong("costMicrosUsd"),
            calls = totals.nonNegativeLong("calls"),
            sessions = totals.nonNegativeLong("sessions"),
            inputTokens = tokens.nonNegativeLong("input"),
            outputTokens = tokens.nonNegativeLong("output"),
            cacheReadTokens = tokens.nonNegativeLong("cacheRead"),
            cacheWriteTokens = tokens.nonNegativeLong("cacheWrite"),
            cacheHitPercent = cacheHitPercent,
            topModels = topModels,
            pricingCoverage = quality?.nullableFraction("pricingCoverage"),
            estimatedCostMicrosUsd = totals.nullableNonNegativeLong("estimatedCostMicrosUsd"),
            costTrend = trend,
            retrievedAtEpochMs = retrievedAtEpochMs,
        )
    }

    private fun parseTrend(buckets: JSONArray): List<CostTrendPoint> = buildList {
        for (index in 0 until minOf(buckets.length(), MAX_TREND_POINTS)) {
            val bucket = buckets.getJSONObject(index)
            val date = bucket.getString("date").trim()
            require(date.matches(DATE_PATTERN) && runCatching { LocalDate.parse(date) }.isSuccess) {
                "The desktop returned an invalid trend date."
            }
            add(
                CostTrendPoint(
                    date = date,
                    costMicrosUsd = bucket.nonNegativeLong("costMicrosUsd"),
                ),
            )
        }
    }

    private fun JSONObject.nonNegativeLong(name: String): Long {
        val value = getLong(name)
        require(value >= 0L) { "The desktop returned a negative $name value." }
        return value
    }

    private fun JSONObject.nullableNonNegativeLong(name: String): Long? {
        if (!has(name) || isNull(name)) return null
        return nonNegativeLong(name)
    }

    private fun JSONObject.nullableFraction(name: String): Double? {
        if (!has(name) || isNull(name)) return null
        return getDouble(name).also {
            require(it.isFinite() && it in 0.0..1.0) {
                "The desktop returned an invalid $name value."
            }
        }
    }

    private const val MAX_TREND_POINTS = 31
    private val DATE_PATTERN = Regex("\\d{4}-\\d{2}-\\d{2}")
}
