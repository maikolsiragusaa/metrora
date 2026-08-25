package eu.metrora.app.ui

import eu.metrora.app.data.CapacityAvailability
import eu.metrora.app.data.CapacityConnection
import eu.metrora.app.data.CapacityFreshness
import eu.metrora.app.data.CapacityProvider
import eu.metrora.app.data.CapacityProviderSnapshot
import eu.metrora.app.data.CapacitySnapshot
import eu.metrora.app.data.CapacityWindow
import eu.metrora.app.data.CAPACITY_CONTRACT_VERSION
import eu.metrora.app.data.CAPACITY_SCOPE_KEY
import org.junit.Assert.assertEquals
import org.junit.Test

class CapacityPresentationTest {
    @Test
    fun null_snapshot_hides_optional_module() {
        assertEquals(CapacityPresentationState.HIDDEN, capacityPresentation(null).state)
    }

    @Test
    fun fresh_facts_are_connected_and_missing_providers_are_partial() {
        val presentation = capacityPresentation(snapshot(
            provider(CapacityProvider.CLAUDE, CapacityFreshness.FRESH, true),
            provider(CapacityProvider.CODEX, CapacityFreshness.UNAVAILABLE, false),
        ))

        assertEquals(CapacityPresentationState.PARTIAL, presentation.state)
        assertEquals(1, presentation.visibleProviders.size)
        assertEquals(1, presentation.unavailableProviderCount)
    }

    @Test
    fun stale_facts_are_never_presented_as_current() {
        val presentation = capacityPresentation(snapshot(provider(CapacityProvider.CLAUDE, CapacityFreshness.STALE, true)))

        assertEquals(CapacityPresentationState.STALE, presentation.state)
        assertEquals(1, presentation.visibleProviders.size)
    }

    @Test
    fun no_facts_are_unavailable_even_when_provider_row_exists() {
        val presentation = capacityPresentation(snapshot(provider(CapacityProvider.CLAUDE, CapacityFreshness.UNAVAILABLE, false)))

        assertEquals(CapacityPresentationState.UNAVAILABLE, presentation.state)
        assertEquals(0, presentation.visibleProviders.size)
    }

    private fun snapshot(vararg providers: CapacityProviderSnapshot) = CapacitySnapshot(
        desktopId = "ab".repeat(32),
        contractVersion = CAPACITY_CONTRACT_VERSION,
        scopeKey = CAPACITY_SCOPE_KEY,
        generatedAtEpochMs = 1L,
        retrievedAtEpochMs = 2L,
        observationId = "11".repeat(32),
        freshness = when {
            providers.any { it.freshness == CapacityFreshness.FRESH } -> CapacityFreshness.FRESH
            providers.any { it.freshness == CapacityFreshness.STALE } -> CapacityFreshness.STALE
            else -> CapacityFreshness.UNAVAILABLE
        },
        available = providers.any { it.hasFacts },
        providers = providers.toList(),
    )

    private fun provider(
        provider: CapacityProvider,
        freshness: CapacityFreshness,
        withFacts: Boolean,
    ) = CapacityProviderSnapshot(
        provider = provider,
        availability = if (withFacts && freshness == CapacityFreshness.FRESH) CapacityAvailability.AVAILABLE else CapacityAvailability.UNAVAILABLE,
        connection = when (freshness) {
            CapacityFreshness.FRESH -> CapacityConnection.CONNECTED
            CapacityFreshness.STALE -> CapacityConnection.STALE
            CapacityFreshness.UNAVAILABLE -> CapacityConnection.DISCONNECTED
        },
        freshness = freshness,
        observedAt = if (withFacts) "2026-08-14T10:00:00Z" else null,
        planLabel = if (withFacts) "Pro" else null,
        windows = if (withFacts) listOf(CapacityWindow("primary", "Window", 25.0, 75.0, null)) else emptyList(),
        credits = null,
        source = null,
    )
}
