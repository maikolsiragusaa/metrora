package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.CapabilityAvailability
import eu.metrora.app.data.CapabilityDescriptor
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.MobileSpendSummary
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.ProjectScopeOption
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySession
import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.ActivityPageMeta
import eu.metrora.app.data.ActivitySessionsPage
import eu.metrora.app.data.CapacitySnapshot
import eu.metrora.app.data.CapacityAvailability
import eu.metrora.app.data.CapacityConnection
import eu.metrora.app.data.CapacityFreshness
import eu.metrora.app.data.CapacityProvider
import eu.metrora.app.data.CapacityProviderSnapshot
import eu.metrora.app.data.CapacityWindow
import eu.metrora.app.data.CAPACITY_CONTRACT_VERSION
import eu.metrora.app.data.CAPACITY_SCOPE_KEY
import eu.metrora.app.network.DiscoveredDesktop
import eu.metrora.app.network.MetroraApi
import eu.metrora.app.security.MetroraStore
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MetroraCoordinatorTest {
    @Test
    fun capacity_is_desktop_wide_and_fetched_only_when_advertised() = runTest {
        val store = FakeStore(credentials = testCredentials(), snapshot = testSnapshot(), foundation = testFoundation("all"))
        val api = FakeApi().apply {
            capabilitiesResult = capacityCapabilities()
            capacityResult = testCapacity()
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(period = "today", projectScopeId = "all")
        advanceUntilIdle()

        assertEquals(1, api.capacityCount.get())
        assertEquals(CapacityFreshness.FRESH, coordinator.state.value.capacity?.freshness)

        coordinator.refresh(period = "week", projectScopeId = "all")
        advanceUntilIdle()

        assertEquals(2, api.capacityCount.get())
        assertEquals(CapacityFreshness.FRESH, coordinator.state.value.capacity?.freshness)
        coordinator.close()
    }

    @Test
    fun restored_capacity_is_marked_stale_before_it_can_be_shown_as_current() = runTest {
        val store = FakeStore(
            credentials = testCredentials(),
            snapshot = testSnapshot(),
            capacity = testCapacity(),
        )
        val coordinator = coordinator(store, FakeApi())
        advanceUntilIdle()

        assertEquals(CapacityFreshness.STALE, coordinator.state.value.capacity?.freshness)
        assertEquals("2026-08-14T10:00:00Z", coordinator.state.value.capacity?.providers?.single()?.observedAt)
        coordinator.close()
    }

    @Test
    fun advertised_activity_failure_does_not_masquerade_as_foundation_compatibility() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot(), testFoundation("all"))
        val api = FakeApi().apply {
            capabilitiesResult = activityCapabilities()
            activityFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.MALFORMED_RESPONSE,
                MetroraFailureReason.MALFORMED_RESPONSE,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(period = "today")
        advanceUntilIdle()

        assertNull(coordinator.state.value.activity)
        assertEquals(MetroraFailureReason.MALFORMED_RESPONSE, coordinator.state.value.activityFailure?.reason)
        assertTrue(coordinator.state.value.capabilities.isAvailable("activity.sessions"))
        coordinator.close()
    }

    @Test
    fun advertised_activity_retry_recovers_the_native_snapshot() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot(), testFoundation("all"))
        val api = FakeApi().apply {
            capabilitiesResult = activityCapabilities()
            activityFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.MALFORMED_RESPONSE,
                MetroraFailureReason.MALFORMED_RESPONSE,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh()
        advanceUntilIdle()
        assertNotNull(coordinator.state.value.activityFailure)

        api.activityFailure = null
        api.activitySessionsResult = testActivitySessionsPage("all")
        coordinator.refresh()
        advanceUntilIdle()

        assertNotNull(coordinator.state.value.activity)
        assertNull(coordinator.state.value.activityFailure)
        coordinator.close()
    }

    @Test
    fun unsupported_activity_capability_keeps_legacy_foundation_path_without_activity_error() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot(), testFoundation("all"))
        val api = FakeApi().apply {
            capabilitiesResult = CapabilityDiscovery.unavailable()
            activityFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.COMPANION_API_UNAVAILABLE,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh()
        advanceUntilIdle()

        assertNull(coordinator.state.value.activity)
        assertNull(coordinator.state.value.activityFailure)
        assertFalse(coordinator.state.value.capabilities.available)
        coordinator.close()
    }

    @Test
    fun pairing_exposes_sas_verification_then_desktop_approval_then_connected() = runTest {
        val store = FakeStore()
        val api = FakeApi()
        val pairing = CompletableDeferred<PairingCredentials>()
        api.pairingResult = pairing
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.pair("desktop.local", "7777")
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.VERIFYING_SAS, coordinator.state.value.status)
        assertEquals("123456", coordinator.state.value.pairingCode)
        // The request is already visible to Desktop while the phone asks the
        // user to compare the code; confirmation is not the request trigger.
        assertEquals(1, api.pairCount.get())

        coordinator.confirmPairingCode()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL, coordinator.state.value.status)

        pairing.complete(testCredentials())
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        assertTrue(coordinator.state.value.paired)
        assertEquals(testSnapshot(), coordinator.state.value.snapshot)
        coordinator.close()
    }

    @Test
    fun cancelling_waiting_pairing_returns_to_unpaired_without_saving_credentials() = runTest {
        val store = FakeStore()
        val api = FakeApi()
        api.pairingResult = CompletableDeferred()
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.pair("desktop.local", "7777")
        advanceUntilIdle()
        coordinator.cancelPairing()
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.UNPAIRED, coordinator.state.value.status)
        assertEquals(MetroraNotice.PAIRING_CANCELLED, coordinator.state.value.notice)
        assertNull(store.credentials)
        coordinator.close()
    }

    @Test
    fun invalid_input_is_structured_without_reflecting_exception_text() = runTest {
        val coordinator = coordinator(FakeStore(), FakeApi())
        advanceUntilIdle()

        coordinator.pair("https://desktop", "7777")

        assertEquals(MetroraConnectionState.ERROR, coordinator.state.value.status)
        assertEquals(MetroraFailureReason.INVALID_HOST, coordinator.state.value.failure?.reason)
        assertEquals(MetroraFailureCategory.COMPATIBILITY, coordinator.state.value.failure?.category)
        coordinator.close()
    }

    @Test
    fun refresh_transitions_cached_offline_to_connected_and_blocks_double_tap() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot())
        val api = FakeApi()
        val refresh = CompletableDeferred<UsageSnapshot>()
        api.fetchResult = refresh
        val coordinator = coordinator(store, api)
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.RESTORED, coordinator.state.value.status)
        assertNull(coordinator.state.value.failure)
        assertEquals(0, api.fetchCount.get())

        coordinator.refresh()
        coordinator.refresh()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.REFRESHING, coordinator.state.value.status)
        assertEquals(1, api.fetchCount.get())

        refresh.complete(testSnapshot(retrievedAtEpochMs = 1_700_000_002_000L))
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        coordinator.close()
    }

    @Test
    fun project_scope_refresh_keeps_usage_scope_but_does_not_reuse_foundation_from_a() = runTest {
        val snapshotA = testSnapshot(projectScopeId = "mp_a")
        val foundationA = testFoundation("mp_a")
        val catalog = testCatalog()
        val store = FakeStore(testCredentials(), snapshotA, foundationA, catalog)
        val api = FakeApi().apply {
            scopedResults["mp_b"] = testSnapshot(projectScopeId = "mp_b", retrievedAtEpochMs = 1_700_000_003_000L)
            foundationFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.CONNECTIVITY,
                MetroraFailureReason.TIMEOUT,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(projectScopeId = "mp_b")
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        assertEquals("mp_b", coordinator.state.value.snapshot?.projectScopeId)
        assertNull(coordinator.state.value.foundation)
        assertEquals("mp_b", coordinator.state.value.selectedProjectId)
        assertEquals("mp_b", store.snapshot?.projectScopeId)
        assertNull(store.foundation)
        assertEquals(catalog.asLocallyCached(), coordinator.state.value.projectCatalog)
        coordinator.close()
    }

    @Test
    fun project_scope_switch_clears_previous_activity_rows_before_requesting_scope_b() = runTest {
        val snapshotA = testSnapshot(projectScopeId = "mp_a")
        val store = FakeStore(testCredentials(), snapshotA, testFoundation("mp_a"), testCatalog(), testActivity("mp_a"))
        val api = FakeApi().apply {
            scopedResults["mp_b"] = testSnapshot(projectScopeId = "mp_b")
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()
        assertEquals("mp_a", coordinator.state.value.activity?.query?.projectScopeId)

        coordinator.refresh(projectScopeId = "mp_b")

        assertNull(coordinator.state.value.activity)
        advanceUntilIdle()
        assertNull(coordinator.state.value.activity)
        coordinator.close()
    }

    @Test
    fun same_scope_foundation_cache_is_a_safe_fallback_for_a_failed_refresh() = runTest {
        val snapshotA = testSnapshot(projectScopeId = "mp_a")
        val foundationA = testFoundation("mp_a")
        val store = FakeStore(testCredentials(), snapshotA, foundationA)
        val api = FakeApi().apply {
            scopedResults["mp_a"] = testSnapshot(projectScopeId = "mp_a", retrievedAtEpochMs = 1_700_000_004_000L)
            foundationFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.CONNECTIVITY,
                MetroraFailureReason.TIMEOUT,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(projectScopeId = "mp_a")
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        assertEquals("mp_a", coordinator.state.value.snapshot?.projectScopeId)
        assertEquals(foundationA.asLocallyCached(), coordinator.state.value.foundation)
        assertEquals(foundationA.asLocallyCached(), store.foundation)
        assertEquals(CapabilityFreshness.CACHED, coordinator.state.value.foundation?.activityFreshness)
        assertEquals(CapabilityFreshness.CACHED, coordinator.state.value.foundation?.analyzeModelsFreshness)
        assertEquals(CapabilityFreshness.CACHED, coordinator.state.value.foundation?.analyzeSpendFreshness)
        coordinator.close()
    }

    @Test
    fun fresh_foundation_success_preserves_server_domain_freshness() = runTest {
        val snapshot = testSnapshot(projectScopeId = "mp_a")
        val foundation = testFoundation("mp_a").copy(
            activityFreshness = CapabilityFreshness.CACHED,
            analyzeModelsFreshness = CapabilityFreshness.LIVE,
            analyzeSpendFreshness = CapabilityFreshness.UNKNOWN,
        )
        val store = FakeStore(testCredentials(), snapshot)
        val api = FakeApi().apply {
            scopedResults["mp_a"] = snapshot.copy(retrievedAtEpochMs = 1_700_000_005_000L)
            foundationResult = foundation
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(projectScopeId = "mp_a")
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        assertEquals(foundation, coordinator.state.value.foundation)
        assertEquals(foundation, store.foundation)
        coordinator.close()
    }

    @Test
    fun legacy_implicit_day_foundation_is_not_treated_as_canonical_lifetime_data() = runTest {
        val snapshot = testSnapshot().copy(
            periodLabel = "Lifetime",
            costTrendPeriodLabel = "Lifetime",
        )
        val foundation = testFoundation("all").copy(
            periodLabel = "Lifetime",
            trendGranularity = null,
        )
        val store = FakeStore(testCredentials(), snapshot, foundation)
        val api = FakeApi().apply {
            scopedResults["all"] = snapshot
            foundationResult = foundation
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.refresh(period = "lifetime")
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.CONNECTED, coordinator.state.value.status)
        assertNull(coordinator.state.value.foundation)
        coordinator.close()
    }

    @Test
    fun restored_snapshot_preserves_the_canonical_period_preset() = runTest {
        val snapshot = testSnapshot(projectScopeId = "mp_a").copy(
            periodLabel = "Today",
            costTrendPeriodLabel = "Today",
        )
        val coordinator = coordinator(FakeStore(testCredentials(), snapshot, projectCatalog = testCatalog()), FakeApi())
        advanceUntilIdle()

        assertEquals("today", coordinator.state.value.selectedPeriod)
        assertEquals("mp_a", coordinator.state.value.selectedProjectId)
        coordinator.close()
    }

    @Test
    fun selecting_trend_granularity_requests_the_desktop_aggregate() = runTest {
        val api = FakeApi()
        val coordinator = coordinator(FakeStore(testCredentials(), testSnapshot()), api)
        advanceUntilIdle()

        coordinator.selectTrendGranularity("week")
        advanceUntilIdle()

        assertEquals("month", api.lastPeriod)
        assertEquals("week", api.lastTrendGranularity)
        coordinator.close()
    }

    @Test
    fun connectivity_failure_keeps_cached_snapshot_but_unauthorized_enters_recovery_path() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot(), projectCatalog = testCatalog())
        val api = FakeApi()
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        api.fetchFailure = testFailure(
            MetroraOperation.REFRESH,
            MetroraFailureCategory.CONNECTIVITY,
            MetroraFailureReason.DESKTOP_UNREACHABLE,
        )
        coordinator.refresh()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.OFFLINE_WITH_SNAPSHOT, coordinator.state.value.status)
        assertEquals(testSnapshot(), coordinator.state.value.snapshot)
        assertEquals(testCatalog().asLocallyCached(), coordinator.state.value.projectCatalog)

        api.fetchFailure = testFailure(
            MetroraOperation.REFRESH,
            MetroraFailureCategory.IDENTITY_SECURITY,
            MetroraFailureReason.UNAUTHORIZED,
        )
        coordinator.refresh()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.REVOKED_OR_UNAUTHORIZED, coordinator.state.value.status)
        assertEquals(testCredentials(), store.credentials)
        coordinator.close()
    }

    @Test
    fun restored_credentials_without_identity_match_require_recovery() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot())
        val api = FakeApi().apply { identityMatches = false }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.RECOVERY_REQUIRED, coordinator.state.value.status)
        assertEquals(MetroraFailureReason.LOCAL_IDENTITY_CHANGED, coordinator.state.value.failure?.reason)
        assertFalse(coordinator.state.value.showingCachedData)
        coordinator.close()
    }

    @Test
    fun process_restart_with_credentials_but_no_snapshot_is_restored_without_a_network_check() = runTest {
        val store = FakeStore(credentials = testCredentials())
        val coordinator = coordinator(store, FakeApi())
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.RESTORED, coordinator.state.value.status)
        assertTrue(coordinator.state.value.paired)
        assertNull(coordinator.state.value.snapshot)
        coordinator.close()
    }

    @Test
    fun corrupted_snapshot_is_removed_without_discarding_valid_credentials() = runTest {
        val store = FakeStore(credentials = testCredentials()).apply {
            snapshotRead = StorageRead.Corrupted(eu.metrora.app.data.StorageIssue.CORRUPTED)
        }
        val coordinator = coordinator(store, FakeApi())
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.RESTORED, coordinator.state.value.status)
        assertEquals(MetroraNotice.SNAPSHOT_RECOVERED, coordinator.state.value.notice)
        assertEquals(testCredentials(), store.credentials)
        assertNull(store.snapshot)
        coordinator.close()
    }

    @Test
    fun successful_pairing_is_kept_distinct_when_first_usage_refresh_times_out() = runTest {
        val store = FakeStore()
        val api = FakeApi().apply {
            fetchFailure = testFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.CONNECTIVITY,
                MetroraFailureReason.TIMEOUT,
            )
        }
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        coordinator.pair("desktop.local", "7777")
        advanceUntilIdle()
        coordinator.confirmPairingCode()
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.PAIRED_NO_SNAPSHOT, coordinator.state.value.status)
        assertTrue(coordinator.state.value.paired)
        assertEquals(testCredentials(), store.credentials)
        assertNull(coordinator.state.value.snapshot)
        assertEquals(MetroraNotice.PAIRED_WITHOUT_USAGE, coordinator.state.value.notice)
        assertEquals(MetroraFailureReason.TIMEOUT, coordinator.state.value.failure?.reason)
        coordinator.close()
    }

    @Test
    fun snapshot_without_credentials_requires_bounded_recovery() = runTest {
        val store = FakeStore(snapshot = testSnapshot())
        val coordinator = coordinator(store, FakeApi())
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.RECOVERY_REQUIRED, coordinator.state.value.status)
        assertEquals(MetroraFailureReason.INCONSISTENT_LOCAL_STATE, coordinator.state.value.failure?.reason)
        assertFalse(coordinator.state.value.showingCachedData)
        coordinator.close()
    }

    @Test
    fun revoke_failure_does_not_clear_local_state_and_forget_is_separate() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot())
        val api = FakeApi()
        val coordinator = coordinator(store, api)
        advanceUntilIdle()

        api.revokeFailure = testFailure(
            MetroraOperation.REVOKE,
            MetroraFailureCategory.CONNECTIVITY,
            MetroraFailureReason.DESKTOP_UNREACHABLE,
        )
        coordinator.revoke()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.ERROR, coordinator.state.value.status)
        assertEquals(testCredentials(), store.credentials)

        coordinator.forgetLocal()
        advanceUntilIdle()
        assertEquals(MetroraConnectionState.UNPAIRED, coordinator.state.value.status)
        assertNull(store.credentials)
        assertNull(store.snapshot)
        coordinator.close()
    }

    @Test
    fun successful_revoke_clears_local_state_only_after_api_success() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot())
        val coordinator = coordinator(store, FakeApi())
        advanceUntilIdle()

        coordinator.revoke()
        advanceUntilIdle()

        assertEquals(MetroraConnectionState.UNPAIRED, coordinator.state.value.status)
        assertEquals(MetroraNotice.REMOTE_REVOCATION_COMPLETE, coordinator.state.value.notice)
        assertNull(store.credentials)
        assertNull(store.snapshot)
        coordinator.close()
    }

    private fun TestScope.coordinator(store: FakeStore, api: FakeApi): MetroraCoordinator {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        return MetroraCoordinator(store, api, scope, "Android test")
    }
}

private fun testFoundation(projectScopeId: String): MobileFoundationSnapshot = MobileFoundationSnapshot(
    desktopId = testCredentials().serverFingerprint,
    generatedAt = "2026-08-14T10:00:00.000Z",
    retrievedAtEpochMs = 1_700_000_000_000L,
    projectScopeId = projectScopeId,
    projectOptions = listOf(
        ProjectScopeOption("all", "All projects", "grid", "cyan", 2),
        ProjectScopeOption("mp_a", "Project A", "spark", "cyan", 1),
        ProjectScopeOption("mp_b", "Project B", "orbit", "violet", 1),
    ),
    sourceProjects = emptyList(),
    capabilities = CapabilityDiscovery.unavailable(),
    activitySessions = emptyList(),
    activityFreshness = CapabilityFreshness.LIVE,
    activityCoverage = eu.metrora.app.data.DetailCoverage.COMPLETE,
    analyzeModels = emptyList(),
    analyzeModelsFreshness = CapabilityFreshness.LIVE,
    spend = MobileSpendSummary(0L, 0L, 0L, emptyList()),
    analyzeSpendFreshness = CapabilityFreshness.LIVE,
    workspaceAvailable = false,
    periodLabel = "This month",
)

private fun activityCapabilities(): CapabilityDiscovery = CapabilityDiscovery(
    generatedAt = "2026-08-15T10:00:00.000Z",
    capabilities = listOf(
        CapabilityDescriptor(
            id = "activity.sessions",
            versions = listOf(1),
            availability = CapabilityAvailability.AVAILABLE,
            freshness = CapabilityFreshness.LIVE,
            periodScoped = true,
            projectScoped = true,
            workspaceScoped = false,
        ),
        CapabilityDescriptor(
            id = "activity.pullRequests",
            versions = listOf(1),
            availability = CapabilityAvailability.AVAILABLE,
            freshness = CapabilityFreshness.LIVE,
            periodScoped = true,
            projectScoped = true,
            workspaceScoped = false,
        ),
    ),
)

private fun capacityCapabilities(): CapabilityDiscovery = CapabilityDiscovery(
    generatedAt = "2026-08-15T10:00:00.000Z",
    capabilities = listOf(
        CapabilityDescriptor(
            id = "home.capacity",
            versions = listOf(1),
            availability = CapabilityAvailability.AVAILABLE,
            freshness = CapabilityFreshness.LIVE,
            periodScoped = false,
            projectScoped = false,
            workspaceScoped = false,
        ),
    ),
)

private fun testCapacity(): CapacitySnapshot = CapacitySnapshot(
    desktopId = testCredentials().serverFingerprint,
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
            windows = listOf(CapacityWindow("primary", "5 hour", 25.0, 75.0, null)),
            credits = null,
            source = null,
        ),
    ),
)

private fun testActivitySessionsPage(projectScopeId: String): ActivitySessionsPage {
    val snapshot = testActivity(projectScopeId)
    return ActivitySessionsPage(
        meta = ActivityPageMeta(
            desktopId = snapshot.desktopId,
            generatedAt = "2026-08-15T10:00:00.000Z",
            query = snapshot.query,
            freshness = CapabilityFreshness.LIVE,
            coverage = eu.metrora.app.data.DetailCoverage.COMPLETE,
            totalCount = snapshot.sessionTotalCount,
            availableCount = snapshot.sessionAvailableCount,
            hasMore = false,
            nextCursor = null,
        ),
        sessions = snapshot.sessions,
    )
}

private fun testCatalog(): ProjectCatalogSnapshot = ProjectCatalogSnapshot(
    desktopId = testCredentials().serverFingerprint,
    generatedAt = "2026-08-14T10:00:00.000Z",
    retrievedAtEpochMs = 1_700_000_000_000L,
    projectOptions = listOf(
        ProjectScopeOption("all", "All projects", "grid", "cyan", 2),
        ProjectScopeOption("unassigned", "Unassigned", "stack", "violet", 1),
        ProjectScopeOption("mp_a", "Project A", "spark", "cyan", 1),
        ProjectScopeOption("mp_b", "Project B", "orbit", "violet", 1),
    ),
    sourceProjects = emptyList(),
    freshness = CapabilityFreshness.LIVE,
)

private fun testActivity(projectScopeId: String): ActivitySnapshot {
    val query = ActivityQuery(period = "month", projectScopeId = projectScopeId)
    val sessionProjectId = if (projectScopeId == "all") "mp_a" else projectScopeId
    val session = ActivitySession(
        id = "session_a",
        projectId = sessionProjectId,
        sourceProjectId = "sp_" + "a".repeat(64),
        sourceProjectName = "metrora",
        title = "Session · 2026-08-14",
        sourceIds = listOf("claude"),
        routeIds = listOf("anthropic-api"),
        brandIds = listOf("anthropic"),
        models = listOf("claude-opus-4-6"),
        costMicrosUsd = 1_000_000L,
        estimatedCostMicrosUsd = null,
        calls = 1L,
        turns = 1L,
        totalTokens = 10L,
        tokenCoverage = eu.metrora.app.data.DetailCoverage.COMPLETE,
        pricingCoverage = eu.metrora.app.data.DetailCoverage.COMPLETE,
        startedAt = "2026-08-14T10:00:00.000Z",
        endedAt = "2026-08-14T10:01:00.000Z",
    )
    return ActivitySnapshot(
        desktopId = testCredentials().serverFingerprint,
        retrievedAtEpochMs = 1_700_000_000_000L,
        query = query,
        sessions = listOf(session),
        sessionNextCursor = null,
        sessionHasMore = false,
        sessionTotalCount = 1L,
        sessionAvailableCount = 1L,
        sessionCoverage = eu.metrora.app.data.DetailCoverage.COMPLETE,
        pullRequests = emptyList(),
        pullRequestNextCursor = null,
        pullRequestHasMore = false,
        pullRequestTotalCount = 0L,
        pullRequestAvailableCount = 0L,
        pullRequestCoverage = eu.metrora.app.data.DetailCoverage.UNAVAILABLE,
        attributedCostMicrosUsd = 0L,
        unattributedCostMicrosUsd = 0L,
        freshness = CapabilityFreshness.CACHED,
    )
}

private class FakeStore(
    var credentials: PairingCredentials? = null,
    var snapshot: UsageSnapshot? = null,
    var foundation: MobileFoundationSnapshot? = null,
    var projectCatalog: ProjectCatalogSnapshot? = null,
    var activity: ActivitySnapshot? = null,
    var capacity: CapacitySnapshot? = null,
) : MetroraStore {
    var credentialsRead: StorageRead<PairingCredentials>? = null
    var snapshotRead: StorageRead<UsageSnapshot>? = null
    var foundationRead: StorageRead<MobileFoundationSnapshot>? = null
    var projectCatalogRead: StorageRead<ProjectCatalogSnapshot>? = null
    var activityRead: StorageRead<ActivitySnapshot>? = null

    override suspend fun loadCredentials(): StorageRead<PairingCredentials> =
        credentialsRead ?: credentials?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveCredentials(credentials: PairingCredentials) {
        this.credentials = credentials
    }

    override suspend fun loadSnapshot(): StorageRead<UsageSnapshot> =
        snapshotRead ?: snapshot?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveSnapshot(snapshot: UsageSnapshot) {
        this.snapshot = snapshot
    }

    override suspend fun saveSnapshotAndFoundation(snapshot: UsageSnapshot, foundation: MobileFoundationSnapshot?) {
        this.snapshot = snapshot
        this.foundation = foundation
    }

    override suspend fun saveSnapshotFoundationAndCatalog(
        snapshot: UsageSnapshot,
        foundation: MobileFoundationSnapshot?,
        catalog: ProjectCatalogSnapshot?,
    ) {
        this.snapshot = snapshot
        this.foundation = foundation
        // A missing catalog means the endpoint was unavailable; the durable
        // catalog remains valid until a newer Desktop projection replaces it.
        if (catalog != null) this.projectCatalog = catalog
    }

    override suspend fun loadFoundation(): StorageRead<MobileFoundationSnapshot> =
        foundationRead ?: foundation?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveFoundation(foundation: MobileFoundationSnapshot) {
        this.foundation = foundation
    }

    override suspend fun loadCapacity(): StorageRead<CapacitySnapshot> =
        capacity?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveCapacity(snapshot: CapacitySnapshot) {
        capacity = snapshot
    }

    override suspend fun clearCapacity() {
        capacity = null
    }

    override suspend fun clearCredentials() {
        credentials = null
    }

    override suspend fun clearSnapshot() {
        snapshot = null
    }

    override suspend fun clearFoundation() {
        foundation = null
    }

    override suspend fun loadProjectCatalog(): StorageRead<ProjectCatalogSnapshot> =
        projectCatalogRead ?: projectCatalog?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveProjectCatalog(catalog: ProjectCatalogSnapshot) {
        projectCatalog = catalog
    }

    override suspend fun clearProjectCatalog() {
        projectCatalog = null
    }

    override suspend fun loadActivity(): StorageRead<ActivitySnapshot> =
        activityRead ?: activity?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveActivity(snapshot: ActivitySnapshot) {
        activity = snapshot
    }

    override suspend fun clearActivity() {
        activity = null
    }

    override suspend fun clearPairing() {
        credentials = null
        snapshot = null
        foundation = null
        capacity = null
        projectCatalog = null
        activity = null
    }
}

private class FakeApi : MetroraApi {
    private val serverFingerprint = "ab".repeat(32)
    private val desktop = DiscoveredDesktop("desktop.local", 7777, "Metrora Desktop", serverFingerprint)
    var pairingResult: CompletableDeferred<PairingCredentials>? = null
    var fetchResult: CompletableDeferred<UsageSnapshot>? = null
    var fetchFailure: MetroraException? = null
    val scopedResults = mutableMapOf<String, UsageSnapshot>()
    var foundationResult: MobileFoundationSnapshot? = null
    var foundationFailure: MetroraException? = null
    var capabilitiesResult: CapabilityDiscovery? = null
    var capabilitiesFailure: MetroraException? = null
    var capacityResult: CapacitySnapshot? = null
    var capacityFailure: MetroraException? = null
    var activityFailure: MetroraException? = null
    var activitySessionsResult: eu.metrora.app.data.ActivitySessionsPage? = null
    var revokeFailure: MetroraException? = null
    var identityMatches = true
    val pairCount = AtomicInteger()
    val fetchCount = AtomicInteger()
    val capacityCount = AtomicInteger()
    var lastPeriod: String? = null
    var lastTrendGranularity: String? = null
    var lastProjectScopeId: String? = null
    var lastFoundationScopeId: String? = null

    override suspend fun discover(host: String, port: Int): DiscoveredDesktop = desktop

    override fun pairingCode(desktop: DiscoveredDesktop): String = "123456"

    override suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials {
        pairCount.incrementAndGet()
        return pairingResult?.await() ?: testCredentials()
    }

    override suspend fun fetchUsage(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
    ): UsageSnapshot {
        return fetchUsageInternal(period, trendGranularity, null)
    }

    override suspend fun fetchUsageForScope(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ): UsageSnapshot = fetchUsageInternal(period, trendGranularity, projectScopeId)

    private suspend fun fetchUsageInternal(
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ): UsageSnapshot {
        fetchCount.incrementAndGet()
        lastPeriod = period
        lastTrendGranularity = trendGranularity
        val normalizedScope = projectScopeId?.trim()?.takeIf { it.isNotEmpty() } ?: "all"
        lastProjectScopeId = normalizedScope
        fetchFailure?.let { throw it }
        return scopedResults[normalizedScope] ?: fetchResult?.await() ?: testSnapshot(projectScopeId = normalizedScope)
    }

    override suspend fun fetchFoundation(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ): MobileFoundationSnapshot {
        lastFoundationScopeId = projectScopeId
        foundationFailure?.let { throw it }
        return foundationResult ?: MobileFoundationSnapshot.unavailable(credentials.serverFingerprint, projectScopeId ?: "all")
    }

    override suspend fun fetchCapabilities(credentials: PairingCredentials): CapabilityDiscovery {
        capabilitiesFailure?.let { throw it }
        return capabilitiesResult ?: CapabilityDiscovery.unavailable()
    }

    override suspend fun fetchCapacity(credentials: PairingCredentials): CapacitySnapshot {
        capacityCount.incrementAndGet()
        capacityFailure?.let { throw it }
        return capacityResult ?: CapacitySnapshot.unavailable(credentials.serverFingerprint)
    }

    override suspend fun fetchActivitySessions(
        credentials: PairingCredentials,
        query: ActivityQuery,
        cursor: String?,
    ): eu.metrora.app.data.ActivitySessionsPage {
        activityFailure?.let { throw it }
        return activitySessionsResult ?: throw MetroraException(
            MetroraFailure(
                MetroraOperation.REFRESH,
                MetroraFailureCategory.COMPATIBILITY,
                MetroraFailureReason.COMPANION_API_UNAVAILABLE,
                "Activity Sessions projection unavailable",
            ),
        )
    }

    override suspend fun revoke(credentials: PairingCredentials) {
        revokeFailure?.let { throw it }
    }

    override fun localIdentityMatches(credentials: PairingCredentials): Boolean = identityMatches
}
