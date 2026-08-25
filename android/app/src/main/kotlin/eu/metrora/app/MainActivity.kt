package eu.metrora.app

import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import eu.metrora.app.demo.MetroraDemoLaunchSpec
import eu.metrora.app.ui.MetroraApp
import eu.metrora.app.ui.MetroraTheme

class MainActivity : ComponentActivity() {
    private lateinit var coordinator: MetroraCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val demoLaunchSpec = MetroraDemoLaunchSpec.fromIntent(intent).takeIf { savedInstanceState == null }
        // The automation contract is a one-shot launch hint, not persisted
        // app state. Removing it also prevents task recreation from re-entering
        // Demo Mode after a normal process restart.
        intent.removeExtra(MetroraDemoLaunchSpec.DEMO_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.DATASET_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.NOW_EXTRA)
        intent.removeExtra(MetroraDemoLaunchSpec.DESTINATION_EXTRA)
        coordinator = MetroraCoordinator(applicationContext, demoLaunchSpec)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
        )
        setContent {
            MetroraTheme {
                MetroraApp(coordinator, demoLaunchSpec?.initialDestination?.wireName)
            }
        }
    }

    override fun onDestroy() {
        coordinator.close()
        super.onDestroy()
    }
}
