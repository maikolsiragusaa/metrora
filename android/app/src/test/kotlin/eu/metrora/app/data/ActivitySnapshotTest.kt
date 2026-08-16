package eu.metrora.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivitySnapshotTest {
    @Test
    fun encryptedCachePayloadRoundTripsBoundedPagesAndQueryIdentity() {
        val query = ActivityQuery(
            "month",
            "mp_demo",
            provider = "claude",
            source = "sp_" + "a".repeat(64),
            limit = 1,
            effectiveFrom = "2026-08-01",
            effectiveTo = "2026-08-15",
        )
        val session = ActivitySession(
            id = "session_1",
            projectId = "mp_demo",
            sourceProjectId = "sp_" + "a".repeat(64),
            sourceProjectName = "metrora",
            title = "Session · 2026-08-14",
            sourceIds = listOf("claude-cli"),
            routeIds = listOf("anthropic-api"),
            brandIds = listOf("anthropic"),
            models = listOf("claude-opus-4-6"),
            costMicrosUsd = 1_500_000L,
            estimatedCostMicrosUsd = null,
            calls = 2L,
            turns = 1L,
            totalTokens = 35L,
            tokenCoverage = DetailCoverage.PARTIAL,
            pricingCoverage = DetailCoverage.COMPLETE,
            startedAt = "2026-08-14T10:00:00.000Z",
            endedAt = "2026-08-14T10:01:00.000Z",
        )
        val snapshot = ActivitySnapshot(
            desktopId = "ab".repeat(32),
            retrievedAtEpochMs = 1_700_000_000_000L,
            query = query,
            sessions = listOf(session),
            sessionNextCursor = "opaque",
            sessionHasMore = true,
            sessionTotalCount = 2L,
            sessionAvailableCount = 1L,
            sessionCoverage = DetailCoverage.PARTIAL,
            pullRequests = emptyList(),
            pullRequestNextCursor = null,
            pullRequestHasMore = false,
            pullRequestTotalCount = 0L,
            pullRequestAvailableCount = 0L,
            pullRequestCoverage = DetailCoverage.UNAVAILABLE,
            attributedCostMicrosUsd = 0L,
            unattributedCostMicrosUsd = 0L,
            freshness = CapabilityFreshness.LIVE,
        )

        val restored = ActivitySnapshot.fromJson(snapshot.toJson())

        assertEquals(snapshot.desktopId, restored.desktopId)
        assertEquals(snapshot.query, restored.query)
        assertEquals(snapshot.sessions, restored.sessions)
        assertEquals("opaque", restored.sessionNextCursor)
        assertTrue(restored.sessionHasMore)
        assertEquals(DetailCoverage.PARTIAL, restored.sessionCoverage)
        assertFalse(restored.toJson().contains("prompt"))
        assertTrue(snapshot.query.cacheKey(snapshot.desktopId) != snapshot.query.copy(effectiveTo = "2026-08-14").cacheKey(snapshot.desktopId))
        assertTrue(snapshot.query.cacheKey(snapshot.desktopId) != snapshot.query.copy(source = "sp_" + "b".repeat(64)).cacheKey(snapshot.desktopId))
        assertTrue(snapshot.query.cacheKey(snapshot.desktopId, "cursor-a") != snapshot.query.cacheKey(snapshot.desktopId, "cursor-b"))
    }

    @Test
    fun sourceFilterOptionsKeepStableIdsBehindSafeLabels() {
        val first = ActivitySession(
            id = "session_1",
            projectId = "mp_demo",
            sourceProjectId = "sp_" + "a".repeat(64),
            sourceProjectName = "Shared",
            title = "Session · 2026-08-14",
            sourceIds = emptyList(),
            routeIds = emptyList(),
            brandIds = emptyList(),
            models = emptyList(),
            costMicrosUsd = null,
            estimatedCostMicrosUsd = null,
            calls = 0L,
            turns = 0L,
            totalTokens = null,
            tokenCoverage = DetailCoverage.UNAVAILABLE,
            pricingCoverage = DetailCoverage.UNAVAILABLE,
            startedAt = "2026-08-14T10:00:00.000Z",
            endedAt = "2026-08-14T10:01:00.000Z",
        )
        val second = first.copy(
            id = "session_2",
            sourceProjectId = "sp_" + "b".repeat(64),
        )

        val options = sourceProjectFilterOptions(listOf(first, second))

        assertEquals(listOf("Shared", "Shared"), options.map { it.label })
        assertEquals(listOf("sp_" + "a".repeat(64), "sp_" + "b".repeat(64)), options.map { it.id })
    }

    @Test
    fun sourceFilterRejectsProviderLabels() {
        assertThrows(IllegalArgumentException::class.java) {
            ActivityQuery(period = "month", projectScopeId = "all", source = "claude-cli")
        }
    }
}
