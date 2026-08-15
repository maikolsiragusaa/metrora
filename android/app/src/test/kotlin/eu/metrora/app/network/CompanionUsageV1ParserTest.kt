package eu.metrora.app.network

import eu.metrora.app.testCredentials
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CompanionUsageV1ParserTest {
    @Test
    fun parses_authoritative_usage_and_records_local_retrieval_time() {
        val raw = """
            {
              "kind":"metrora.companion.usage",
              "version":1,
              "generatedAt":"2026-08-14T10:00:00Z",
              "period":{"label":"This month"},
              "totals":{
                "costMicrosUsd":750000,
                "estimatedCostMicrosUsd":120000,
                "calls":5,
                "sessions":2,
                "tokens":{"input":100,"output":50,"cacheRead":20,"cacheWrite":10},
                "cacheHitPercent":16.7
              },
              "topModels":[{"name":"Model A","calls":5,"costMicrosUsd":750000,"estimatedCostMicrosUsd":120000}],
              "quality":{"pricingCoverage":0.875},
              "trend":{"granularity":"day","periodLabel":"This month","buckets":[
                {"date":"2026-08-01","costMicrosUsd":300000},
                {"date":"2026-08-02","costMicrosUsd":450000}
              ]}
            }
        """.trimIndent()

        val snapshot = CompanionUsageV1Parser.parse(raw, testCredentials(), retrievedAtEpochMs = 1234L)

        assertEquals(180L, snapshot.totalTokens)
        assertEquals(1234L, snapshot.retrievedAtEpochMs)
        assertEquals("Model A", snapshot.topModels.single().name)
        assertEquals(null, snapshot.topModels.single().providerId)
        assertEquals(1, snapshot.models.size)
        assertEquals("day", snapshot.costTrendGranularity)
        assertEquals(120000L, snapshot.estimatedCostMicrosUsd)
        assertEquals(0.875, snapshot.pricingCoverage)
        assertEquals(2, snapshot.costTrend.size)
        assertEquals(120000L, snapshot.topModels.single().estimatedCostMicrosUsd)
    }

    @Test
    fun rejects_unsupported_kind_and_version() {
        val raw = """
            {"kind":"other","version":1,"period":{},"totals":{},"topModels":[]}
        """.trimIndent()

        assertThrows(IllegalArgumentException::class.java) {
            CompanionUsageV1Parser.parse(raw, testCredentials())
        }
    }

    @Test
    fun rejects_malformed_new_quality_and_trend_fields() {
        val raw = """
            {
              "kind":"metrora.companion.usage",
              "version":1,
              "generatedAt":"2026-08-14T10:00:00Z",
              "period":{"label":"This month"},
              "totals":{"costMicrosUsd":1,"calls":1,"sessions":1,"tokens":{"input":1,"output":0,"cacheRead":0,"cacheWrite":0},"cacheHitPercent":0},
              "quality":{"pricingCoverage":2},
              "trend":{"granularity":"day","buckets":[{"date":"not-a-date","costMicrosUsd":1}]},
              "topModels":[]
            }
        """.trimIndent()

        assertThrows(IllegalArgumentException::class.java) {
            CompanionUsageV1Parser.parse(raw, testCredentials())
        }
    }

    @Test
    fun preserves_provider_identity_full_models_and_weekly_trend() {
        val raw = """
            {
              "kind":"metrora.companion.usage",
              "version":1,
              "generatedAt":"2026-08-14T10:00:00Z",
              "period":{"label":"Last 6 months"},
              "totals":{"costMicrosUsd":2,"calls":3,"sessions":1,"tokens":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0},"cacheHitPercent":0},
              "topModels":[{"name":"GPT-5.6 Sol","providerId":"provider-a","calls":2,"costMicrosUsd":1000000}],
              "models":[
                {"name":"GPT-5.6 Sol","providerId":"provider-a","calls":2,"costMicrosUsd":1000000},
                {"name":"GPT-5.6 Sol","providerId":"provider-b","calls":1,"costMicrosUsd":1000000}
              ],
              "trend":{"granularity":"week","periodLabel":"Last 6 months","buckets":[{"date":"2026-08-10","costMicrosUsd":2000000}]}
            }
        """.trimIndent()

        val snapshot = CompanionUsageV1Parser.parse(raw, testCredentials())

        assertEquals(2, snapshot.models.size)
        assertEquals(listOf("provider-a", "provider-b"), snapshot.models.map { it.providerId })
        assertEquals("week", snapshot.costTrendGranularity)
    }

    @Test
    fun preserves_route_and_desktop_derived_model_brand_separately() {
        val raw = """
            {
              "kind":"metrora.companion.usage",
              "version":1,
              "generatedAt":"2026-08-14T10:00:00Z",
              "period":{"label":"This month"},
              "totals":{"costMicrosUsd":3,"calls":3,"sessions":1,"tokens":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0},"cacheHitPercent":0},
              "topModels":[{"name":"GPT-5.4","providerId":"openai","brandId":"openai","calls":1,"costMicrosUsd":1000000}],
              "models":[
                {"name":"Claude Sonnet 4.6","providerId":"amazon-bedrock","brandId":"anthropic","calls":1,"costMicrosUsd":1000000},
                {"name":"Claude Sonnet 4.6","providerId":"api_provider_anthropic","brandId":"anthropic","calls":1,"costMicrosUsd":1000000},
                {"name":"Unresolved model","providerId":"unknown-route","calls":1,"costMicrosUsd":1000000},
                {"name":"DeepSeek V4 Flash","providerId":"deepseek","brandId":"deepseek","calls":1,"costMicrosUsd":1000000},
                {"name":"Qwen 3.7 Plus","providerId":"qwen","brandId":"qwen","calls":1,"costMicrosUsd":1000000},
                {"name":"Kimi K2.6","providerId":"moonshotai","brandId":"moonshot","calls":1,"costMicrosUsd":1000000}
              ]
            }
        """.trimIndent()

        val snapshot = CompanionUsageV1Parser.parse(raw, testCredentials())

        assertEquals("openai", snapshot.topModels.single().brandId)
        assertEquals(
            listOf("amazon-bedrock", "api_provider_anthropic", "unknown-route", "deepseek", "qwen", "moonshotai"),
            snapshot.models.map { it.providerId },
        )
        assertEquals(listOf("anthropic", "anthropic", null, "deepseek", "qwen", "moonshot"), snapshot.models.map { it.brandId })
    }

    @Test
    fun preserves_duplicate_display_rows_when_one_route_is_unavailable() {
        val raw = """
            {
              "kind":"metrora.companion.usage",
              "version":1,
              "generatedAt":"2026-08-14T10:00:00Z",
              "period":{"label":"This month"},
              "totals":{"costMicrosUsd":3,"calls":3,"sessions":1,"tokens":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0},"cacheHitPercent":0},
              "topModels":[{"name":"Opus 4.6","providerId":"anthropic","brandId":"anthropic","calls":2,"costMicrosUsd":2000000}],
              "models":[
                {"name":"Opus 4.6","providerId":"anthropic","brandId":"anthropic","calls":2,"costMicrosUsd":2000000},
                {"name":"Opus 4.6","brandId":"anthropic","calls":1,"costMicrosUsd":1000000}
              ]
            }
        """.trimIndent()

        val snapshot = CompanionUsageV1Parser.parse(raw, testCredentials())

        assertEquals(2, snapshot.models.size)
        assertEquals(listOf("anthropic", null), snapshot.models.map { it.providerId })
        assertEquals(listOf("anthropic", "anthropic"), snapshot.models.map { it.brandId })
    }
}
