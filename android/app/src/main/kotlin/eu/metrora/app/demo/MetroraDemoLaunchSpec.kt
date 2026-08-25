package eu.metrora.app.demo

import android.content.Intent
import android.os.Bundle
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

/**
 * Narrow lifecycle-only Demo state. This is saved in Activity instance state,
 * never in Metrora's product authority or projection stores.
 */
data class MetroraDemoLifecycleState(
    val session: MetroraDemoSession,
    val selectedPeriod: String,
    val selectedProjectId: String,
    val destination: MetroraDemoDestination,
) {
    init {
        require(MetroraDemoDatasetV1.supportsPeriod(selectedPeriod)) { "Unsupported demo lifecycle period." }
        require(selectedProjectId.isNotBlank()) { "Demo lifecycle Project scope cannot be blank." }
    }

    fun toInput(): MetroraDemoLifecycleInput = MetroraDemoLifecycleInput(
        active = true,
        dataset = session.datasetVersion,
        now = session.today.toString(),
        period = selectedPeriod,
        project = selectedProjectId,
        destination = destination.wireName,
    )

    fun writeTo(bundle: Bundle) {
        val input = toInput()
        bundle.putBoolean(ACTIVE_KEY, input.active)
        bundle.putString(DATASET_KEY, input.dataset)
        bundle.putString(NOW_KEY, input.now)
        bundle.putString(PERIOD_KEY, input.period)
        bundle.putString(PROJECT_KEY, input.project)
        bundle.putString(DESTINATION_KEY, input.destination)
    }

    companion object {
        private const val ACTIVE_KEY = "metrora.demo.lifecycle.active"
        private const val DATASET_KEY = "metrora.demo.lifecycle.dataset"
        private const val NOW_KEY = "metrora.demo.lifecycle.now"
        private const val PERIOD_KEY = "metrora.demo.lifecycle.period"
        private const val PROJECT_KEY = "metrora.demo.lifecycle.project"
        private const val DESTINATION_KEY = "metrora.demo.lifecycle.destination"

        fun fromInput(input: MetroraDemoLifecycleInput): MetroraDemoLifecycleState? {
            if (!input.active || input.dataset == null || input.now == null || input.period == null ||
                input.project == null || input.destination == null
            ) return null
            val launchSpec = MetroraDemoLaunchSpec.parse(
                enabled = true,
                dataset = input.dataset,
                now = input.now,
                destination = input.destination,
            ) ?: return null
            if (!MetroraDemoDatasetV1.supportsPeriod(input.period)) return null
            return MetroraDemoLifecycleState(
                session = launchSpec.session,
                selectedPeriod = input.period,
                selectedProjectId = input.project,
                destination = launchSpec.initialDestination,
            )
        }

        fun fromBundle(bundle: Bundle?): MetroraDemoLifecycleState? {
            if (bundle == null) return null
            return fromInput(
                MetroraDemoLifecycleInput(
                    active = bundle.getBoolean(ACTIVE_KEY, false),
                    dataset = bundle.getString(DATASET_KEY),
                    now = bundle.getString(NOW_KEY),
                    period = bundle.getString(PERIOD_KEY),
                    project = bundle.getString(PROJECT_KEY),
                    destination = bundle.getString(DESTINATION_KEY),
                ),
            )
        }

        fun clearFrom(bundle: Bundle) {
            bundle.remove(ACTIVE_KEY)
            bundle.remove(DATASET_KEY)
            bundle.remove(NOW_KEY)
            bundle.remove(PERIOD_KEY)
            bundle.remove(PROJECT_KEY)
            bundle.remove(DESTINATION_KEY)
        }
    }
}

/** Pure representation used to test the lifecycle contract without Android framework state. */
data class MetroraDemoLifecycleInput(
    val active: Boolean,
    val dataset: String?,
    val now: String?,
    val period: String?,
    val project: String?,
    val destination: String?,
)
