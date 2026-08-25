package eu.metrora.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CapacitySnapshotTest {
    private val desktopId = "ab".repeat(32)

    @Test
    fun encrypted_cache_roundTrip_preserves_provider_facts_and_explicit_zero() {
        val original = freshSnapshot()

        val restored = CapacitySnapshot.fromJson(original.toJson())

        assertEquals(original, restored)
        assertEquals(0.0, restored.providers.single().windows.single().usedPercent, 0.0)
        assertEquals(0.0, restored.providers.single().credits?.balance ?: -1.0, 0.0)
    }

    @Test
    fun local_cache_marks_facts_stale_without_erasing_observation_time() {
        val cached = freshSnapshot().asLocallyCached()
        val provider = cached.providers.single()

        assertEquals(CapacityFreshness.STALE, cached.freshness)
        assertEquals(CapacityAvailability.UNAVAILABLE, provider.availability)
        assertEquals(CapacityFreshness.STALE, provider.freshness)
        assertEquals("2026-08-14T10:00:00Z", provider.observedAt)
        assertTrue(provider.hasFacts)
    }

    @Test
    fun compatibility_binds_desktop_contract_and_fixed_scope() {
        val snapshot = freshSnapshot()

        assertTrue(snapshot.isCompatible(desktopId))
        assertFalse(snapshot.isCompatible("cd".repeat(32)))
        assertThrows(IllegalArgumentException::class.java) {
            snapshot.copy(scopeKey = "month")
        }
    }

    @Test
    fun unavailable_snapshot_has_no_fake_provider_facts() {
        val unavailable = CapacitySnapshot.unavailable(desktopId, 1L)

        assertFalse(unavailable.available)
        assertEquals(CapacityFreshness.UNAVAILABLE, unavailable.freshness)
        assertTrue(unavailable.providers.isEmpty())
    }

    private fun freshSnapshot(): CapacitySnapshot = CapacitySnapshot(
        desktopId = desktopId,
        contractVersion = CAPACITY_CONTRACT_VERSION,
        scopeKey = CAPACITY_SCOPE_KEY,
        generatedAtEpochMs = 1_700_000_000_000L,
        retrievedAtEpochMs = 1_700_000_001_000L,
        observationId = "11".repeat(32),
        freshness = CapacityFreshness.FRESH,
        available = true,
        providers = listOf(
            CapacityProviderSnapshot(
                provider = CapacityProvider.CLAUDE,
                availability = CapacityAvailability.AVAILABLE,
                connection = CapacityConnection.CONNECTED,
                freshness = CapacityFreshness.FRESH,
                observedAt = "2026-08-14T10:00:00Z",
                planLabel = "Pro",
                windows = listOf(CapacityWindow("primary", "5 hour", 0.0, 100.0, null)),
                credits = CapacityCredits(0.0),
                source = CapacitySource("provider-api", "provider-owned"),
            ),
        ),
    )
}
