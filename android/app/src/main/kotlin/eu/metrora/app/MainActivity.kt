package eu.metrora.app

import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import eu.metrora.app.demo.MetroraDemoDestination
import eu.metrora.app.demo.MetroraDemoLifecycleState
import eu.metrora.app.demo.MetroraDemoLaunchSpec
import eu.metrora.app.demo.MetroraDemoSession
import eu.metrora.app.ui.MetroraApp
import eu.metrora.app.ui.MetroraTheme
import java.time.LocalDate

class MainActivity : ComponentActivity() {
    private lateinit var coordinator: MetroraCoordinator
    private var demoDestination: String = MetroraDemoDestination.HOME.wireName
    private var demoLifecycleHint: MetroraDemoLifecycleState? = null
    private var restoredInstanceState: Bundle? = null
    private var latestSavedInstanceState: Bundle? = null
    private var demoLifecycleInvalidated: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        restoredInstanceState = savedInstanceState
        demoLifecycleInvalidated = false
        val restoredDemoState = MetroraDemoLifecycleState.fromBundle(savedInstanceState)
        val demoLaunchSpec = MetroraDemoLaunchSpec.fromIntent(intent).takeIf { savedInstanceState == null }
        demoDestination = demoLaunchSpec?.initialDestination?.wireName
            ?: restoredDemoState?.destination?.wireName
            ?: MetroraDemoDestination.HOME.wireName
        demoLifecycleHint = restoredDemoState ?: demoLaunchSpec?.let { spec ->
            MetroraDemoLifecycleState(
                session = spec.session,
                selectedPeriod = "month",
                selectedProjectId = "all",
                destination = spec.initialDestination,
            )
        }
        // The automation contract is a one-shot launch hint, not persisted
        // app state. Removing it also prevents task recreation from re-entering
        // Demo Mode after a normal process restart.
        intent.removeExtra(MetroraDemoLaunchSpec.DEMO_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.DATASET_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.NOW_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.DESTINATION_EXTRA)
        coordinator = MetroraCoordinator(
            context = applicationContext,
            demoLaunchSpec = demoLaunchSpec,
            demoLifecycleState = restoredDemoState,
        )
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
        )
        setContent {
            MetroraTheme {
                MetroraApp(
                    coordinator = coordinator,
                    initialDemoDestination = demoLaunchSpec?.initialDestination?.wireName
                        ?: restoredDemoState?.destination?.wireName,
                    onDemoDestinationChanged = { destination -> demoDestination = destination },
                    onExitDemo = ::exitDemoAndInvalidateLifecycleState,
                )
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        latestSavedInstanceState = outState
        val state = coordinator.state.value
        val lifecycleState = if (!demoLifecycleInvalidated && state.isDemo && state.demoDatasetVersion != null && state.demoToday != null) {
            MetroraDemoLifecycleState(
                session = MetroraDemoSession(
                    today = LocalDate.parse(state.demoToday),
                    datasetVersion = state.demoDatasetVersion,
                ),
                selectedPeriod = state.selectedPeriod,
                selectedProjectId = state.selectedProjectId,
                destination = MetroraDemoDestination.entries.firstOrNull {
                    it.wireName.equals(demoDestination, ignoreCase = true) ||
                        it.name.equals(demoDestination, ignoreCase = true)
                }
                    ?: MetroraDemoDestination.HOME,
            )
        } else if (state.initializing) {
            // Preserve a valid launch/recreation hint if Android recreates the
            // Activity before the local restore coroutine has completed. The
            // Coordinator still rechecks real storage before entering Demo.
            demoLifecycleHint
        } else {
            null
        }
        if (lifecycleState != null) {
            lifecycleState.writeTo(outState)
        } else {
            MetroraDemoLifecycleState.clearFrom(outState)
        }
        super.onSaveInstanceState(outState)
    }

    private fun exitDemoAndInvalidateLifecycleState() {
        demoLifecycleInvalidated = true
        demoLifecycleHint = null
        restoredInstanceState?.let(MetroraDemoLifecycleState::clearFrom)
        latestSavedInstanceState?.let(MetroraDemoLifecycleState::clearFrom)
        coordinator.exitDemo()
    }

    override fun onDestroy() {
        coordinator.close()
        super.onDestroy()
    }
}
