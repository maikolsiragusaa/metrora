package eu.metrora.app.ui

import eu.metrora.app.data.CapacityFreshness
import eu.metrora.app.data.CapacityProviderSnapshot
import eu.metrora.app.data.CapacitySnapshot

/** Small, deterministic view model for the Home Capacity module. */
internal enum class CapacityPresentationState {
    HIDDEN,
    CONNECTED,
    PARTIAL,
    STALE,
    UNAVAILABLE,
}

internal data class CapacityPresentation(
    val state: CapacityPresentationState,
    val visibleProviders: List<CapacityProviderSnapshot>,
    val unavailableProviderCount: Int,
) {
    val showModule: Boolean
        get() = state != CapacityPresentationState.HIDDEN
}

internal fun capacityPresentation(snapshot: CapacitySnapshot?): CapacityPresentation {
    if (snapshot == null) {
        return CapacityPresentation(CapacityPresentationState.HIDDEN, emptyList(), 0)
    }
    val visible = snapshot.providers.filter { it.hasFacts }
    val unavailableCount = snapshot.providers.count { !it.hasFacts }
    val state = when {
        visible.isEmpty() -> CapacityPresentationState.UNAVAILABLE
        visible.any { it.freshness == CapacityFreshness.STALE } -> CapacityPresentationState.STALE
        unavailableCount > 0 -> CapacityPresentationState.PARTIAL
        else -> CapacityPresentationState.CONNECTED
    }
    return CapacityPresentation(state, visible, unavailableCount)
}
