package eu.metrora.app.network

import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import java.time.Instant
import org.json.JSONObject

internal object CompanionUsageV1Parser {
    private const val MAX_TOP_MODELS = 5

    fun parse(raw: String, credentials: PairingCredentials): UsageSnapshot {
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
                    ),
                )
            }
        }

        val cacheHitPercent = totals.getDouble("cacheHitPercent")
        require(cacheHitPercent.isFinite() && cacheHitPercent in 0.0..100.0) {
            "The desktop returned an invalid cache-hit percentage."
        }

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
        )
    }

    private fun JSONObject.nonNegativeLong(name: String): Long {
        val value = getLong(name)
        require(value >= 0L) { "The desktop returned a negative $name value." }
        return value
    }
}
