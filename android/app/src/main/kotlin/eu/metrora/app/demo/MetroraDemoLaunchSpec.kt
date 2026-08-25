package eu.metrora.app.demo

import android.content.Intent
import java.time.LocalDate
import java.time.format.DateTimeFormatter

enum class MetroraDemoDestination(val wireName: String) {
    HOME("home"),
    ACTIVITY("activity"),
    ANALYZE("analyze"),
    WORKSPACE("workspace"),
    SETTINGS("settings"),
}

data class MetroraDemoLaunchSpec(
    val session: MetroraDemoSession,
    val initialDestination: MetroraDemoDestination = MetroraDemoDestination.HOME,
) {
    companion object {
        const val DEMO_EXTRA = "metrora.demo"
        const val DATASET_EXTRA = "metrora.demo.dataset"
        const val NOW_EXTRA = "metrora.demo.now"
        const val DESTINATION_EXTRA = "metrora.demo.destination"

        fun fromIntent(intent: Intent?): MetroraDemoLaunchSpec? {
            if (intent?.getBooleanExtra(DEMO_EXTRA, false) != true) return null
            return parse(
                enabled = true,
                dataset = intent.getStringExtra(DATASET_EXTRA),
                now = intent.getStringExtra(NOW_EXTRA),
                destination = intent.getStringExtra(DESTINATION_EXTRA),
            )
        }

        /** Pure parser kept small so malformed automation inputs can be tested without Android UI. */
        fun parse(
            enabled: Boolean,
            dataset: String?,
            now: String?,
            destination: String?,
        ): MetroraDemoLaunchSpec? {
            if (!enabled) return null
            if (dataset != null && dataset != MetroraDemoDatasetV1.VERSION) return null
            val today = if (now == null) {
                LocalDate.now()
            } else {
                runCatching { LocalDate.parse(now, DateTimeFormatter.ISO_LOCAL_DATE) }.getOrNull() ?: return null
            }
            val selectedDestination = if (destination == null) {
                MetroraDemoDestination.HOME
            } else {
                MetroraDemoDestination.entries.firstOrNull { it.wireName == destination } ?: return null
            }
            return MetroraDemoLaunchSpec(
                session = MetroraDemoSession(today = today),
                initialDestination = selectedDestination,
            )
        }

        fun forExploreDemo(today: LocalDate = LocalDate.now()): MetroraDemoLaunchSpec = MetroraDemoLaunchSpec(
            session = MetroraDemoSession(today = today),
            initialDestination = MetroraDemoDestination.HOME,
        )
    }
}
