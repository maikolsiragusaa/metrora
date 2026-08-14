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
                "calls":5,
                "sessions":2,
                "tokens":{"input":100,"output":50,"cacheRead":20,"cacheWrite":10},
                "cacheHitPercent":16.7
              },
              "topModels":[{"name":"Model A","calls":5,"costMicrosUsd":750000}]
            }
        """.trimIndent()

        val snapshot = CompanionUsageV1Parser.parse(raw, testCredentials(), retrievedAtEpochMs = 1234L)

        assertEquals(180L, snapshot.totalTokens)
        assertEquals(1234L, snapshot.retrievedAtEpochMs)
        assertEquals("Model A", snapshot.topModels.single().name)
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
}
