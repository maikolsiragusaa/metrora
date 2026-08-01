package eu.metrora.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import eu.metrora.app.ui.MetroraApp
import eu.metrora.app.ui.MetroraTheme

class MainActivity : ComponentActivity() {
    private lateinit var coordinator: MetroraCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        coordinator = MetroraCoordinator(applicationContext)
        enableEdgeToEdge()
        setContent {
            MetroraTheme {
                MetroraApp(coordinator)
            }
        }
    }

    override fun onDestroy() {
        coordinator.close()
        super.onDestroy()
    }
}
