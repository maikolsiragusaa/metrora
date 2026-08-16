package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.ActivitySnapshot

data class MetroraUiState(
    val initializing: Boolean = true,
    val status: MetroraConnectionState = MetroraConnectionState.UNPAIRED,
    val selectedPeriod: String = "month",
    val selectedProjectId: String = "all",
    val credentials: PairingCredentials? = null,
    val snapshot: UsageSnapshot? = null,
    val foundation: MobileFoundationSnapshot? = null,
    val projectCatalog: ProjectCatalogSnapshot? = null,
    val activity: ActivitySnapshot? = null,
    /** Non-sensitive Activity V1 failure; null means no known Activity error. */
    val activityFailure: MetroraFailure? = null,
    val capabilities: CapabilityDiscovery = CapabilityDiscovery.unavailable(),
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
        get() = (snapshot != null || activity != null) && status != MetroraConnectionState.CONNECTED

    val hasLocalState: Boolean
        get() = paired || snapshot != null || foundation != null || projectCatalog != null || activity != null || status == MetroraConnectionState.RECOVERY_REQUIRED
}
