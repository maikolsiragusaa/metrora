package eu.metrora.app.demo

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class MetroraDemoLaunchSpecTest {
    @Test
    fun malformed_demo_overrides_fail_closed() {
        assertNull(MetroraDemoLaunchSpec.parse(false, "v1", "2026-08-25", "home"))
        assertNull(MetroraDemoLaunchSpec.parse(true, "v2", "2026-08-25", "home"))
        assertNull(MetroraDemoLaunchSpec.parse(true, "v1", "2026-02-30", "home"))
        assertNull(MetroraDemoLaunchSpec.parse(true, "v1", "2026-08-25", "not-a-route"))
        assertNull(MetroraDemoLaunchSpec.parse(true, "v1", "", "home"))
    }

    @Test
    fun allowlisted_destination_and_date_are_the_only_automation_inputs() {
        MetroraDemoDestination.entries.forEach { destination ->
            val spec = MetroraDemoLaunchSpec.parse(
                enabled = true,
                dataset = "v1",
                now = "2026-08-25",
                destination = destination.wireName,
            )

            assertEquals(LocalDate.of(2026, 8, 25), spec?.session?.today)
            assertEquals(destination, spec?.initialDestination)
        }
    }

    @Test
    fun lifecycle_state_round_trips_and_exit_invalidates_saved_demo_inputs() {
        val original = MetroraDemoLifecycleState(
            session = MetroraDemoSession(LocalDate.of(2026, 8, 25)),
            selectedPeriod = "month",
            selectedProjectId = "mp_atlas",
            destination = MetroraDemoDestination.ACTIVITY,
        )
        val restored = MetroraDemoLifecycleState.fromInput(original.toInput())

        assertNotNull(restored)
        assertEquals(original, restored)
        assertNull(MetroraDemoLifecycleState.fromInput(original.toInput().copy(active = false)))
    }

    @Test
    fun invalid_lifecycle_route_or_period_fails_closed() {
        assertNull(
            MetroraDemoLifecycleState.fromInput(
                MetroraDemoLifecycleInput(
                    active = true,
                    dataset = "v1",
                    now = "2026-08-25",
                    period = "quarter",
                    project = "all",
                    destination = "arbitrary",
                ),
            ),
        )
    }
}
