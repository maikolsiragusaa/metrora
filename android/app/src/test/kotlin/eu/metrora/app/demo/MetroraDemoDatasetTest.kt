package eu.metrora.app.demo

import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.UsageSnapshot
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MetroraDemoDatasetTest {
    @Test
    fun v1_is_deterministic_bounded_and_round_trips_through_domain_parsers() {
        val today = LocalDate.of(2026, 8, 25)
        val first = MetroraDemoDatasetV1.source(today).load()
        val second = MetroraDemoDatasetV1.source(today).load()

        assertEquals(first, second)
        assertEquals("v1", MetroraDemoDatasetV1.source(today).datasetVersion)
        assertEquals(listOf("today", "week", "30days", "month"), MetroraDemoDatasetV1.supportedPeriods)
        assertFalse(MetroraDemoDatasetV1.supportsPeriod("lifetime"))
        assertEquals(25, first.snapshot.costTrend.size)
        assertTrue(first.snapshot.costTrend.map { it.costMicrosUsd }.distinct().size > 1)
        assertTrue(first.snapshot.models.size in 4..20)
        assertTrue(first.foundation.analyzeModels.size in 4..32)
        assertTrue(first.activity.sessions.size <= 40)
        assertTrue(first.activity.pullRequests.size <= 40)
        assertTrue(first.snapshot.costMicrosUsd > 0L)
        assertTrue(first.snapshot.calls > 0L)
        assertTrue(first.snapshot.sessions > 0L)
        assertTrue(first.snapshot.totalTokens > 0L)
        assertTrue(first.snapshot.cacheHitPercent in 0.0..100.0)
        val pricingCoverage = first.snapshot.pricingCoverage
        assertTrue(pricingCoverage != null && pricingCoverage in 0.0..1.0)
        assertTrue(first.snapshot.costTrend.all { it.costMicrosUsd >= 0L })
        assertTrue(first.activity.sessions.all { it.costMicrosUsd != null && it.costMicrosUsd >= 0L })
        assertTrue(first.activity.sessions.all { it.totalTokens != null && it.totalTokens >= 0L })
        assertTrue(first.activity.pullRequests.all { it.url == null })

        val parsedUsage = UsageSnapshot.fromJson(first.snapshot.toJson())
        val parsedFoundation = MobileFoundationSnapshot.fromJson(
            first.foundation.toJson(),
            desktopId = first.foundation.desktopId,
            retrievedAtEpochMs = first.foundation.retrievedAtEpochMs,
        )
        val parsedCatalog = ProjectCatalogSnapshot.fromJson(
            first.projectCatalog.toJson(),
            desktopId = first.projectCatalog.desktopId,
            retrievedAtEpochMs = first.projectCatalog.retrievedAtEpochMs,
        )
        val parsedActivity = ActivitySnapshot.fromJson(first.activity.toJson())

        assertEquals(first.snapshot, parsedUsage)
        assertEquals(first.foundation, parsedFoundation)
        assertEquals(first.projectCatalog, parsedCatalog)
        assertEquals(first.activity, parsedActivity)

        val serialized = listOf(
            first.snapshot.toJson(),
            first.foundation.toJson(),
            first.projectCatalog.toJson(),
            first.activity.toJson(),
        ).joinToString("\n")
        assertFalse(serialized.contains("token="))
        assertFalse(serialized.contains("/Users/"))
        assertFalse(serialized.contains("C:\\"))
    }

    @Test
    fun project_scope_changes_coherently_across_usage_foundation_and_activity() {
        val source = MetroraDemoDatasetV1.source(LocalDate.of(2026, 8, 25))
        val all = source.load(projectScopeId = "all")
        val atlas = source.load(projectScopeId = "mp_atlas")

        assertTrue(atlas.snapshot.costMicrosUsd in 1 until all.snapshot.costMicrosUsd)
        assertEquals("mp_atlas", atlas.snapshot.projectScopeId)
        assertEquals("mp_atlas", atlas.foundation.projectScopeId)
        assertEquals(atlas.snapshot.costMicrosUsd, atlas.foundation.spend?.costMicrosUsd)
        assertEquals(
            atlas.snapshot.costMicrosUsd,
            atlas.foundation.analyzeModels.sumOf { it.costMicrosUsd },
        )
        assertTrue(atlas.activity.sessions.all { it.projectId == "mp_atlas" })
        assertTrue(atlas.foundation.activitySessions.all { it.projectId == "mp_atlas" })
        assertNotNull(atlas.projectCatalog.projectOption("mp_atlas"))
        assertNotNull(atlas.projectCatalog.projectOption("mp_nova"))
    }

    @Test
    fun activity_pull_requests_are_bounded_to_the_selected_period() {
        val today = LocalDate.of(2026, 8, 25)
        val source = MetroraDemoDatasetV1.source(today)
        val todayPullRequests = source.load(period = "today").activity.pullRequests
        val weekPullRequests = source.load(period = "week").activity.pullRequests

        assertEquals(1, todayPullRequests.size)
        assertEquals(2, weekPullRequests.size)
        assertTrue(todayPullRequests.all { it.dateFrom.startsWith(today.toString()) && it.dateTo.startsWith(today.toString()) })
        assertTrue(todayPullRequests.sumOf { it.costMicrosUsd } < weekPullRequests.sumOf { it.costMicrosUsd })
        assertTrue(todayPullRequests.all { it.linkedSessionCount <= 1L })
    }

    @Test
    fun month_is_calendar_to_date_and_30days_is_a_distinct_rolling_window() {
        val today = LocalDate.of(2026, 8, 25)
        val source = MetroraDemoDatasetV1.source(today)
        val monthWindow = source.periodWindow("month")
        val rollingWindow = source.periodWindow("30days")
        val month = source.load(period = "month")
        val rolling = source.load(period = "30days")

        assertEquals(LocalDate.of(2026, 8, 1), monthWindow.start)
        assertEquals(today, monthWindow.end)
        assertEquals(LocalDate.of(2026, 7, 27), rollingWindow.start)
        assertTrue(rollingWindow.start.isBefore(monthWindow.start))
        assertEquals(monthWindow.start.toString(), month.activity.query.effectiveFrom)
        assertEquals(monthWindow.end.toString(), month.activity.query.effectiveTo)
        assertEquals(25, month.activity.sessions.size)
        assertEquals(30, rolling.activity.sessions.size)
        assertEquals(monthWindow.start.toString(), month.snapshot.costTrend.first().date)
        assertEquals(25, month.snapshot.costTrend.size)
        assertEquals(30, rolling.snapshot.costTrend.size)
        assertTrue(month.activity.sessions.none { it.startedAt.startsWith("2026-07") })
        assertTrue(month.foundation.activitySessions.none { it.startedAt.startsWith("2026-07") })
        assertTrue(month.activity.pullRequests.all { request ->
            request.dateFrom.substring(0, 10) >= monthWindow.start.toString() &&
                request.dateTo.substring(0, 10) <= monthWindow.end.toString()
        })
        assertTrue(month.activity.pullRequests.sumOf { it.costMicrosUsd } < rolling.activity.pullRequests.sumOf { it.costMicrosUsd })
        assertTrue(month.activity.pullRequests.sumOf { it.calls } <= rolling.activity.pullRequests.sumOf { it.calls })
        assertTrue(month.activity.pullRequests.sumOf { it.linkedSessionCount } <= rolling.activity.pullRequests.sumOf { it.linkedSessionCount })

        assertEquals(month.snapshot.costMicrosUsd, month.foundation.spend?.costMicrosUsd)
        assertEquals(month.snapshot.costMicrosUsd, month.activity.sessions.sumOf { it.costMicrosUsd ?: 0L })
        assertEquals(month.snapshot.calls, month.foundation.spend?.calls)
        assertEquals(month.snapshot.sessions, month.activity.sessionTotalCount)
        assertEquals(month.activity.pullRequests.sumOf { it.costMicrosUsd }, month.activity.attributedCostMicrosUsd)
    }

    @Test
    fun project_scoped_month_uses_the_same_calendar_window() {
        val source = MetroraDemoDatasetV1.source(LocalDate.of(2026, 8, 25))
        val atlas = source.load(period = "month", projectScopeId = "mp_atlas")

        assertEquals("2026-08-01", atlas.activity.query.effectiveFrom)
        assertEquals("2026-08-25", atlas.activity.query.effectiveTo)
        assertEquals("mp_atlas", atlas.snapshot.projectScopeId)
        assertEquals(atlas.snapshot.costMicrosUsd, atlas.foundation.spend?.costMicrosUsd)
        assertTrue(atlas.activity.sessions.all { it.projectId == "mp_atlas" })
        assertTrue(atlas.activity.pullRequests.all {
            it.dateFrom.substring(0, 10) >= "2026-08-01" && it.dateTo.substring(0, 10) <= "2026-08-25"
        })
    }
}
