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
}
