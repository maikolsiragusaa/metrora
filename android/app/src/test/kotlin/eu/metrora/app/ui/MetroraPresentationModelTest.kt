package eu.metrora.app.ui

import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraDataMode
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraOperation
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.AnalyzeAccountingCoverage
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.testCredentials
import eu.metrora.app.testSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MetroraPresentationModelTest {
    @Test
    fun every_connection_state_has_a_product_status_copy() {
        MetroraConnectionState.values().forEach { state ->
            val copy = statusCopy(state)

            assertNotEquals("Missing title for $state", 0, copy.title)
            assertNotEquals("Missing body for $state", 0, copy.body)
            assertNotEquals("Missing accessibility label for $state", 0, copy.iconDescription)
        }
    }

    @Test
    fun every_failure_reason_has_safe_user_copy() {
        MetroraFailureReason.values().forEach { reason ->
            val failure = MetroraFailure(
                operation = MetroraOperation.REFRESH,
                category = MetroraFailureCategory.UNEXPECTED,
                reason = reason,
            )

            assertNotEquals("Missing resource for $reason", 0, failureResource(failure))
        }
    }

    @Test
    fun fresh_saved_and_failed_refresh_have_distinct_tones() {
        assertEquals(StatusTone.POSITIVE, statusCopy(MetroraConnectionState.CONNECTED).tone)
        assertEquals(StatusTone.SAVED, statusCopy(MetroraConnectionState.RESTORED).tone)
        assertEquals(StatusTone.WARNING, statusCopy(MetroraConnectionState.OFFLINE_WITH_SNAPSHOT).tone)
        assertEquals(R.string.status_waiting_approval, statusCopy(
            MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL,
        ).title)
    }

    @Test
    fun cached_data_is_never_marked_as_fresh() {
        val snapshot = testSnapshot()

        assertFalse(
            MetroraUiState(
                initializing = false,
                status = MetroraConnectionState.CONNECTED,
                snapshot = snapshot,
            ).showingCachedData,
        )
        assertTrue(
            MetroraUiState(
                initializing = false,
                status = MetroraConnectionState.RESTORED,
                snapshot = snapshot,
            ).showingCachedData,
        )
        assertTrue(
            MetroraUiState(
                initializing = false,
                status = MetroraConnectionState.OFFLINE_WITH_SNAPSHOT,
                snapshot = snapshot,
            ).showingCachedData,
        )
    }

    @Test
    fun snapshot_with_refresh_failure_shows_refresh_failed_freshness() {
        val state = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.OFFLINE_WITH_SNAPSHOT,
            snapshot = testSnapshot(),
            failure = MetroraFailure(
                operation = MetroraOperation.REFRESH,
                category = MetroraFailureCategory.CONNECTIVITY,
                reason = MetroraFailureReason.TIMEOUT,
            ),
        )

        assertEquals(FreshnessKind.REFRESH_FAILED, freshnessPresentation(state).kind)
        assertEquals(R.string.data_saved_after_failed_refresh, freshnessPresentation(state).label)
    }

    @Test
    fun snapshot_with_revoke_failure_stays_neutral_saved() {
        val state = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.ERROR,
            snapshot = testSnapshot(),
            failure = MetroraFailure(
                operation = MetroraOperation.REVOKE,
                category = MetroraFailureCategory.CONNECTIVITY,
                reason = MetroraFailureReason.DESKTOP_UNREACHABLE,
            ),
        )

        assertEquals(FreshnessKind.SAVED, freshnessPresentation(state).kind)
        assertEquals(R.string.data_saved_on_phone, freshnessPresentation(state).label)
    }

    @Test
    fun restored_snapshot_without_failure_stays_neutral_saved() {
        val state = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.RESTORED,
            snapshot = testSnapshot(),
        )

        assertEquals(FreshnessKind.SAVED, freshnessPresentation(state).kind)
        assertEquals(R.string.data_saved_on_phone, freshnessPresentation(state).label)
    }

    @Test
    fun connected_snapshot_is_fresh() {
        val state = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.CONNECTED,
            snapshot = testSnapshot(),
        )

        assertEquals(FreshnessKind.FRESH, freshnessPresentation(state).kind)
        assertEquals(R.string.data_fresh, freshnessPresentation(state).label)
    }

    @Test
    fun demo_presentation_is_explicit_and_not_paired_or_cached() {
        val state = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.DEMO,
            dataMode = MetroraDataMode.DEMO,
            demoDatasetVersion = "v1",
            demoToday = "2026-08-25",
            snapshot = testSnapshot(),
        )

        assertFalse(state.paired)
        assertFalse(state.showingCachedData)
        assertEquals(R.string.status_demo, statusCopy(state.status).title)
        assertEquals(R.string.data_demo, freshnessPresentation(state).label)
    }

    @Test
    fun initial_destination_is_ignored_for_real_state_but_allowed_for_demo_state() {
        val realState = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.RESTORED,
            credentials = testCredentials(),
        )
        val demoState = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.DEMO,
            dataMode = MetroraDataMode.DEMO,
            demoDatasetVersion = "v1",
            demoToday = "2026-08-25",
        )

        assertEquals("HOME", initialDestinationFor(realState, "SETTINGS"))
        assertEquals("SETTINGS", initialDestinationFor(demoState, "SETTINGS"))
    }

    @Test
    fun partial_token_coverage_keeps_a_factual_subtotal_explicitly_partial() {
        assertEquals("13.5B+", tokenMetricValue(DetailCoverage.PARTIAL, 13_500_000_000L))
        assertEquals(null, tokenMetricValue(DetailCoverage.PARTIAL, 0L))
        assertEquals("13.5B", tokenMetricValue(DetailCoverage.COMPLETE, 13_500_000_000L))
        assertEquals(null, tokenMetricValue(DetailCoverage.UNAVAILABLE, 13_500_000_000L))
    }

    @Test
    fun analyze_coverage_keeps_pricing_cost_token_and_model_detail_authorities_separate() {
        val presentation = analyzeCoveragePresentation(
            canonicalPricingCoverage = 0.976,
            accountingCoverage = AnalyzeAccountingCoverage(
                cost = 1.0,
                calls = 0.9,
                tokenCost = 0.25,
                tokenCalls = 0.5,
            ),
            tokenCoverage = DetailCoverage.PARTIAL,
            modelDetailCoverage = DetailCoverage.UNAVAILABLE,
        )

        assertEquals(0.976, presentation.pricingCoverage ?: -1.0, 0.0001)
        assertEquals(1.0, presentation.accountingCostCoverage ?: -1.0, 0.0001)
        assertEquals(DetailCoverage.PARTIAL, presentation.tokenCoverage)
        assertEquals(DetailCoverage.UNAVAILABLE, presentation.modelDetailCoverage)
    }

    @Test
    fun analyze_coverage_labels_cannot_swap_factual_dimensions() {
        assertEquals(R.string.pricing_coverage_short, analyzeCoverageLabel(AnalyzeCoverageDimension.PRICING))
        assertEquals(R.string.cost_accounting_coverage, analyzeCoverageLabel(AnalyzeCoverageDimension.ACCOUNTING_COST))
        assertEquals(R.string.token_coverage, analyzeCoverageLabel(AnalyzeCoverageDimension.TOKEN))
        assertEquals(R.string.models_coverage, analyzeCoverageLabel(AnalyzeCoverageDimension.MODEL_DETAIL))
    }

    @Test
    fun activity_rows_keep_project_and_compact_facts_on_left_without_a_timestamp() {
        val metadata = activityRowLeftMetadata("metrora-dev", 138_420_000L, 993L, "OpenAI")

        assertEquals("metrora-dev", metadata.projectLabel)
        assertEquals("138.42M tokens · 993 calls · OpenAI", metadata.compactFacts)
        assertFalse(metadata.projectLabel.contains("02:14"))
    }

}
