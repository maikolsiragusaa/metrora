package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot

data class MetroraUiState(
    val initializing: Boolean = true,
    val status: MetroraConnectionState = MetroraConnectionState.UNPAIRED,
    val selectedPeriod: String = "month",
    val credentials: PairingCredentials? = null,
    val snapshot: UsageSnapshot? = null,
    val pairingCode: String? = null,
    val pairingDesktopName: String? = null,
    val notice: MetroraNotice? = null,
    val failure: MetroraFailure? = null,
) {
    val paired: Boolean
        get() = credentials != null

    val busy: Boolean
        get() = status in setOf(
            MetroraConnectionState.PAIRING,
            MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL,
            MetroraConnectionState.REFRESHING,
            MetroraConnectionState.REVOKING,
            MetroraConnectionState.FORGETTING,
        )

    val showingCachedData: Boolean
        get() = snapshot != null && status != MetroraConnectionState.CONNECTED

    val hasLocalState: Boolean
        get() = paired || snapshot != null || status == MetroraConnectionState.RECOVERY_REQUIRED
}
