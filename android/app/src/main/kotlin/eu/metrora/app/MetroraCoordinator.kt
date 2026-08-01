package eu.metrora.app

import android.content.Context
import android.os.Build
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.network.MetroraApiClient
import eu.metrora.app.network.MetroraProtocol
import eu.metrora.app.security.SecureStore
import java.io.Closeable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MetroraUiState(
    val initializing: Boolean = true,
    val busy: Boolean = false,
    val credentials: PairingCredentials? = null,
    val snapshot: UsageSnapshot? = null,
    val showingCachedData: Boolean = false,
    val pairingCode: String? = null,
    val pairingDesktopName: String? = null,
    val message: String? = null,
    val error: String? = null,
) {
    val paired: Boolean
        get() = credentials != null
}

class MetroraCoordinator(context: Context) : Closeable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val store = SecureStore(context.applicationContext)
    private val api = MetroraApiClient()
    private val mutableState = MutableStateFlow(MetroraUiState())

    val state: StateFlow<MetroraUiState> = mutableState.asStateFlow()

    init {
        scope.launch {
            try {
                val credentials = store.loadCredentials()
                val snapshot = store.loadSnapshot()?.takeIf { cached ->
                    credentials != null && cached.desktopId == credentials.serverFingerprint
                }
                mutableState.value = MetroraUiState(
                    initializing = false,
                    credentials = credentials,
                    snapshot = snapshot,
                    showingCachedData = snapshot != null,
                )
            } catch (error: Exception) {
                runCatching { store.clearPairing() }
                mutableState.value = MetroraUiState(
                    initializing = false,
                    error = error.safeMessage("Encrypted local state could not be read and was removed."),
                )
            }
        }
    }

    fun pair(host: String, portText: String) {
        if (mutableState.value.busy || mutableState.value.paired) return
        val port = try {
            MetroraProtocol.validatePort(portText.trim().toInt())
        } catch (error: Exception) {
            mutableState.update { it.copy(error = error.safeMessage("Enter a valid port."), message = null) }
            return
        }
        mutableState.update {
            it.copy(
                busy = true,
                pairingCode = null,
                pairingDesktopName = null,
                error = null,
                message = "Connecting to the desktop…",
            )
        }
        scope.launch {
            try {
                val desktop = api.discover(host, port)
                val code = api.pairingCode(desktop)
                mutableState.update {
                    it.copy(
                        pairingCode = code,
                        pairingDesktopName = desktop.name,
                        message = "Compare the complete code with Metrora Desktop, then approve there.",
                    )
                }
                val credentials = api.pair(desktop, code, androidDeviceName())
                store.saveCredentials(credentials)
                mutableState.update {
                    it.copy(
                        busy = true,
                        credentials = credentials,
                        pairingCode = null,
                        pairingDesktopName = null,
                        message = "Desktop paired. Loading the first usage snapshot…",
                    )
                }
                try {
                    val snapshot = api.fetchUsage(credentials)
                    store.saveSnapshot(snapshot)
                    mutableState.update {
                        it.copy(
                            busy = false,
                            snapshot = snapshot,
                            showingCachedData = false,
                            message = "Pairing complete.",
                            error = null,
                        )
                    }
                } catch (error: Exception) {
                    mutableState.update {
                        it.copy(
                            busy = false,
                            showingCachedData = it.snapshot != null,
                            message = "The desktop is paired. Usage will appear after the first successful refresh.",
                            error = error.safeMessage("The initial usage refresh failed."),
                        )
                    }
                }
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        busy = false,
                        credentials = null,
                        pairingCode = null,
                        pairingDesktopName = null,
                        message = null,
                        error = error.safeMessage("Pairing failed."),
                    )
                }
            }
        }
    }

    fun refresh() {
        val credentials = mutableState.value.credentials ?: return
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, error = null, message = null) }
        scope.launch {
            try {
                val snapshot = api.fetchUsage(credentials)
                store.saveSnapshot(snapshot)
                mutableState.update {
                    it.copy(
                        busy = false,
                        snapshot = snapshot,
                        showingCachedData = false,
                        message = "Usage refreshed from the desktop.",
                    )
                }
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        busy = false,
                        showingCachedData = it.snapshot != null,
                        error = error.safeMessage("Desktop unreachable. The last encrypted snapshot remains available."),
                    )
                }
            }
        }
    }

    fun disconnect() {
        val credentials = mutableState.value.credentials ?: return
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, error = null, message = "Revoking this phone on the desktop…") }
        scope.launch {
            try {
                api.revoke(credentials)
                store.clearPairing()
                mutableState.value = MetroraUiState(
                    initializing = false,
                    message = "Desktop access revoked and local pairing data removed.",
                )
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        busy = false,
                        message = null,
                        error = error.safeMessage(
                            "The desktop could not confirm revocation. Access remains paired; retry or forget only this phone.",
                        ),
                    )
                }
            }
        }
    }

    fun forgetLocal() {
        if (mutableState.value.busy || !mutableState.value.paired) return
        mutableState.update { it.copy(busy = true, error = null, message = null) }
        scope.launch {
            try {
                store.clearPairing()
                mutableState.value = MetroraUiState(
                    initializing = false,
                    message = "Pairing data removed only from this phone. Revoke the old device from the desktop when available.",
                )
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        busy = false,
                        error = error.safeMessage("Local pairing data could not be removed."),
                    )
                }
            }
        }
    }

    override fun close() {
        scope.cancel()
    }

    private fun androidDeviceName(): String = listOf(Build.MANUFACTURER, Build.MODEL)
        .map(String::trim)
        .filter(String::isNotBlank)
        .distinct()
        .joinToString(" ")
        .ifBlank { "Android" }
        .take(80)

    private fun Throwable.safeMessage(fallback: String): String {
        val sanitized = message
            ?.replace(Regex("[\\u0000-\\u001f\\u007f]"), " ")
            ?.trim()
            ?.take(180)
            .orEmpty()
        return sanitized.ifBlank { fallback }
    }
}
