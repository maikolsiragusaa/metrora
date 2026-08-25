package eu.metrora.app.demo

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
        val spec = MetroraDemoLaunchSpec.parse(
            enabled = true,
            dataset = "v1",
            now = "2026-08-25",
            destination = "settings",
        )

        assertEquals(LocalDate.of(2026, 8, 25), spec?.session?.today)
        assertEquals(MetroraDemoDestination.SETTINGS, spec?.initialDestination)
    }
}
