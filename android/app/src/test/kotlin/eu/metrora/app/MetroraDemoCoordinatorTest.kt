package eu.metrora.app

import eu.metrora.app.data.ActivityPullRequestsPage
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySessionDetail
import eu.metrora.app.data.ActivitySessionsPage
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.demo.MetroraDemoLaunchSpec
import eu.metrora.app.network.DiscoveredDesktop
import eu.metrora.app.network.MetroraApi
import eu.metrora.app.security.MetroraStore
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MetroraDemoCoordinatorTest {
    @Test
    fun full_demo_interaction_flow_is_local_and_never_creates_real_state() = runTest {
        val store = CountingStore()
        val api = CountingApi()
        val coordinator = coordinator(store, api, StandardTestDispatcher(testScheduler))
        advanceUntilIdle()

        coordinator.enterDemo()
        val allCost = coordinator.state.value.snapshot?.costMicrosUsd ?: 0L
        assertEquals(MetroraDataMode.DEMO, coordinator.state.value.dataMode)
        assertTrue(coordinator.state.value.isDemo)
        assertFalse(coordinator.state.value.paired)
        assertEquals(MetroraConnectionState.DEMO, coordinator.state.value.status)
        assertEquals("v1", coordinator.state.value.demoDatasetVersion)
        assertTrue(coordinator.state.value.demoToday != null)

        coordinator.selectPeriod("week")
        coordinator.selectTrendGranularity("week")
        coordinator.selectProject("mp_atlas")
        val atlasState = coordinator.state.value
        assertEquals("week", atlasState.selectedPeriod)
        assertEquals("mp_atlas", atlasState.selectedProjectId)
        assertEquals("mp_atlas", atlasState.snapshot?.projectScopeId)
        assertEquals("mp_atlas", atlasState.foundation?.projectScopeId)
        assertTrue((atlasState.snapshot?.costMicrosUsd ?: allCost) < allCost)

        coordinator.setActivityQuery(
            ActivityQuery(
                period = "month",
                projectScopeId = "all",
                provider = "codex",
            ),
        )
        val activity = coordinator.state.value.activity
        assertNotNull(activity)
        assertTrue(activity?.sessions?.all { it.sourceIds.contains("codex") } == true)
        val sessionId = activity?.sessions?.firstOrNull()?.id
        if (sessionId != null) {
            coordinator.openActivitySession(sessionId)
            assertNotNull(coordinator.state.value.activity?.selectedSession)
            coordinator.closeActivityDetail()
            assertTrue(coordinator.state.value.activity?.selectedSession == null)
        }
        val pullRequestId = coordinator.state.value.activity?.pullRequests?.firstOrNull()?.id
        if (pullRequestId != null) {
            coordinator.openActivityPullRequest(pullRequestId)
            assertNotNull(coordinator.state.value.activity?.selectedPullRequest)
            coordinator.closeActivityDetail()
        }
        coordinator.refresh(period = "month", trendGranularity = "day", projectScopeId = "all")
        assertEquals(MetroraDataMode.DEMO, coordinator.state.value.dataMode)

        coordinator.exitDemo()
        assertEquals(MetroraDataMode.REAL, coordinator.state.value.dataMode)
        assertEquals(MetroraConnectionState.UNPAIRED, coordinator.state.value.status)
        assertFalse(coordinator.state.value.paired)
        assertTrue(coordinator.state.value.snapshot == null)
        assertTrue(coordinator.state.value.activity == null)
        assertEquals(0, api.calls.get())
        assertEquals(0, store.writes)
        assertEquals(0, store.clears)
        coordinator.close()
    }

    @Test
    fun deterministic_launch_enters_demo_only_with_an_empty_real_store() = runTest {
        val store = CountingStore()
        val dispatcher = StandardTestDispatcher(testScheduler)
        val spec = MetroraDemoLaunchSpec.parse(true, "v1", "2026-08-25", "analyze")
            ?: error("valid test spec")
        val coordinator = MetroraCoordinator(
            store = store,
            api = CountingApi(),
            scope = CoroutineScope(SupervisorJob() + dispatcher),
            deviceName = "Demo test",
            demoLaunchSpec = spec,
        )
        advanceUntilIdle()

        assertTrue(coordinator.state.value.isDemo)
        assertEquals("2026-08-25", coordinator.state.value.demoToday)
        assertFalse(coordinator.state.value.paired)
        assertEquals(0, store.writes)
        coordinator.close()
    }

    private fun coordinator(
        store: CountingStore,
        api: CountingApi,
        dispatcher: TestDispatcher,
    ): MetroraCoordinator =
        MetroraCoordinator(
            store = store,
            api = api,
            scope = CoroutineScope(SupervisorJob() + dispatcher),
            deviceName = "Demo test",
        )
}

private class CountingStore : MetroraStore {
    var writes: Int = 0
    var clears: Int = 0

    override suspend fun loadCredentials(): StorageRead<PairingCredentials> = StorageRead.Missing
    override suspend fun saveCredentials(credentials: PairingCredentials) { writes += 1 }
    override suspend fun loadSnapshot(): StorageRead<UsageSnapshot> = StorageRead.Missing
    override suspend fun saveSnapshot(snapshot: UsageSnapshot) { writes += 1 }
    override suspend fun saveSnapshotFoundationAndCatalog(
        snapshot: UsageSnapshot,
        foundation: MobileFoundationSnapshot?,
        catalog: ProjectCatalogSnapshot?,
    ) { writes += 1 }
    override suspend fun loadFoundation(): StorageRead<MobileFoundationSnapshot> = StorageRead.Missing
    override suspend fun saveFoundation(foundation: MobileFoundationSnapshot) { writes += 1 }
    override suspend fun loadProjectCatalog(): StorageRead<ProjectCatalogSnapshot> = StorageRead.Missing
    override suspend fun saveProjectCatalog(catalog: ProjectCatalogSnapshot) { writes += 1 }
    override suspend fun loadActivity(): StorageRead<eu.metrora.app.data.ActivitySnapshot> = StorageRead.Missing
    override suspend fun saveActivity(snapshot: eu.metrora.app.data.ActivitySnapshot) { writes += 1 }
    override suspend fun clearCredentials() { clears += 1 }
    override suspend fun clearSnapshot() { clears += 1 }
    override suspend fun clearFoundation() { clears += 1 }
    override suspend fun clearProjectCatalog() { clears += 1 }
    override suspend fun clearActivity() { clears += 1 }
    override suspend fun clearPairing() { clears += 1 }
}

private class CountingApi : MetroraApi {
    val calls = AtomicInteger(0)

    private fun network(): Nothing {
        calls.incrementAndGet()
        error("Demo Mode must not call the API")
    }

    override suspend fun discover(host: String, port: Int): DiscoveredDesktop = network()
    override fun pairingCode(desktop: DiscoveredDesktop): String = network()
    override suspend fun pair(desktop: DiscoveredDesktop, expectedCode: String, deviceName: String): PairingCredentials = network()
    override suspend fun fetchUsage(credentials: PairingCredentials, period: String, trendGranularity: String?): UsageSnapshot = network()
    override suspend fun fetchUsageForScope(credentials: PairingCredentials, period: String, trendGranularity: String?, projectScopeId: String?): UsageSnapshot = network()
    override suspend fun fetchCapabilities(credentials: PairingCredentials): CapabilityDiscovery = network()
    override suspend fun fetchFoundation(credentials: PairingCredentials, period: String, trendGranularity: String?, projectScopeId: String?): MobileFoundationSnapshot = network()
    override suspend fun fetchProjectCatalog(credentials: PairingCredentials): ProjectCatalogSnapshot = network()
    override suspend fun fetchActivitySessions(credentials: PairingCredentials, query: ActivityQuery, cursor: String?): ActivitySessionsPage = network()
    override suspend fun fetchActivitySessionDetail(credentials: PairingCredentials, query: ActivityQuery, id: String): ActivitySessionDetail = network()
    override suspend fun fetchActivityPullRequests(credentials: PairingCredentials, query: ActivityQuery, cursor: String?): ActivityPullRequestsPage = network()
    override suspend fun revoke(credentials: PairingCredentials) { network() }
    override fun localIdentityMatches(credentials: PairingCredentials): Boolean = network()
}
