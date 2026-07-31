package io.github.maikolsiragusaa.qovrion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.maikolsiragusaa.qovrion.ui.QovrionApp
import io.github.maikolsiragusaa.qovrion.ui.QovrionTheme

class MainActivity : ComponentActivity() {
    private lateinit var coordinator: QovrionCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        coordinator = QovrionCoordinator(applicationContext)
        enableEdgeToEdge()
        setContent {
            QovrionTheme {
                QovrionApp(coordinator)
            }
        }
    }

    override fun onDestroy() {
        coordinator.close()
        super.onDestroy()
    }
}
