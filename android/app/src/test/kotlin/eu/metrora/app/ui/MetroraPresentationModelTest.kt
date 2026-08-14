package eu.metrora.app.ui

import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraOperation
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
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
}
