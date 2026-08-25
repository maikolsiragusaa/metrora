package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.ActivitySnapshot
import java.time.LocalDate

enum class MetroraDataMode {
    REAL,
    DEMO,
}

data class MetroraUiState(
    val initializing: Boolean = true,
    val status: MetroraConnectionState = MetroraConnectionState.UNPAIRED,
    val dataMode: MetroraDataMode = MetroraDataMode.REAL,
    /** Non-null only for an active, ephemeral built-in demo session. */
    val demoDatasetVersion: String? = null,
    /** ISO-8601 session date used to anchor deterministic demo rows. */
    val demoToday: String? = null,
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
    init {
        require(
            (dataMode == MetroraDataMode.REAL && demoDatasetVersion == null && demoToday == null) ||
                (dataMode == MetroraDataMode.DEMO && demoDatasetVersion != null && demoToday != null),
        ) {
            "Data mode and demo session metadata must agree."
        }
        require(dataMode == MetroraDataMode.REAL || credentials == null) {
            "Demo state cannot carry real pairing credentials."
        }
        require((dataMode == MetroraDataMode.DEMO) == (status == MetroraConnectionState.DEMO)) {
            "Demo data mode and connection state must agree."
        }
        require(demoDatasetVersion == null || demoDatasetVersion.isNotBlank()) {
            "Demo dataset version cannot be blank."
        }
        require(
            demoToday == null || (
                demoToday.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) &&
                    runCatching { LocalDate.parse(demoToday) }.isSuccess
                ),
        ) {
            "Demo date must be ISO-8601."
        }
    }

    val isDemo: Boolean
        get() = dataMode == MetroraDataMode.DEMO

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
        get() = dataMode == MetroraDataMode.REAL &&
            (snapshot != null || activity != null) && status != MetroraConnectionState.CONNECTED

    val hasLocalState: Boolean
        get() = dataMode == MetroraDataMode.REAL &&
            (paired || snapshot != null || foundation != null || projectCatalog != null || activity != null || status == MetroraConnectionState.RECOVERY_REQUIRED)
}
