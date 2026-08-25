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
import org.junit.Assert.assertTrue
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
        assertTrue(presentation.detailProviders.isEmpty())
    }

    @Test
    fun compact_home_is_bounded_but_detail_retains_every_window_and_reset() {
        val presentation = capacityPresentation(snapshot(provider(
            provider = CapacityProvider.CLAUDE,
            freshness = CapacityFreshness.FRESH,
            withFacts = true,
            windows = listOf(
                CapacityWindow("short", "5 hour", 25.0, 75.0, "2026-08-14T15:00:00Z"),
                CapacityWindow("weekly", "Weekly", 50.0, 50.0, "2026-08-21T10:00:00Z"),
            ),
        )))

        assertEquals(listOf("short"), presentation.compactProviders.single().windows.map { it.id })
        assertEquals(listOf("short", "weekly"), presentation.detailProviders.single().windows.map { it.id })
        assertEquals(listOf("5 hour", "Weekly"), presentation.detailProviders.single().windows.map { it.label })
        assertEquals(
            listOf("2026-08-14T15:00:00Z", "2026-08-21T10:00:00Z"),
            presentation.detailProviders.single().windows.map { it.resetsAt },
        )
    }

    @Test
    fun stale_multi_window_facts_remain_stale_and_explicit_zero_remains_zero() {
        val presentation = capacityPresentation(snapshot(provider(
            provider = CapacityProvider.CODEX,
            freshness = CapacityFreshness.STALE,
            withFacts = true,
            windows = listOf(
                CapacityWindow("short", "5 hour", 0.0, 100.0, null),
                CapacityWindow("weekly", "Weekly", 80.0, 20.0, "2026-08-21T10:00:00Z"),
            ),
        )))

        assertEquals(CapacityPresentationState.STALE, presentation.state)
        assertEquals(2, presentation.detailProviders.single().windows.size)
        assertEquals(0.0, presentation.detailProviders.single().windows.first().usedPercent, 0.0)
        assertEquals(100.0, presentation.detailProviders.single().windows.first().remainingPercent, 0.0)
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
        windows: List<CapacityWindow>? = null,
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
        windows = windows ?: if (withFacts) listOf(CapacityWindow("primary", "Window", 25.0, 75.0, null)) else emptyList(),
        credits = null,
        source = null,
    )
}
