package eu.metrora.app

import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.AnalyzeModelUsage
import eu.metrora.app.data.MobileActivitySession
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.MobileSpendSummary
import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.ProjectScopeOption
import eu.metrora.app.data.SourceProjectContributor
import eu.metrora.app.data.SourceProjectSummary
import eu.metrora.app.data.SpendTrendPoint
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.network.DiscoveredDesktop
import eu.metrora.app.network.MetroraApi
import eu.metrora.app.security.MetroraStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MetroraCoordinatorRaceTest {
    @Test
    fun latest_requested_state_wins_over_seeded_out_of_order_responses() = runTest {
        val api = RaceApi()
        val store = RaceStore(testCredentials(), catalog())
        val dispatcher = StandardTestDispatcher(testScheduler)
        val coordinator = MetroraCoordinator(
            store = store,
            api = api,
            scope = CoroutineScope(SupervisorJob() + dispatcher),
            deviceName = "Android race test",
        )
        advanceUntilIdle()

        val seed = 0x5EED_183
        val periods = listOf("today", "week", "30days", "month", "all", "lifetime")
        val scopes = listOf("all", "unassigned", "mp_fixture")
        val granularities = listOf("day", "week", "month")
        var state = seed
        val requests = ArrayList<RaceRequestSpec>()
        repeat(32) { index ->
            state = next(state)
            val first = RaceRequestSpec(
                period = periods[(state ushr 1) % periods.size],
                scope = scopes[(state ushr 5) % scopes.size],
                granularity = granularities[(state ushr 9) % granularities.size],
            )
            state = next(state)
            val latest = RaceRequestSpec(
                period = periods[(state ushr 1) % periods.size],
                scope = scopes[(state ushr 5) % scopes.size],
                granularity = granularities[(state ushr 9) % granularities.size],
            )
            requests += first
            requests += latest

            coordinator.refresh(first.period, first.granularity, first.scope)
            runCurrent()
            coordinator.refresh(latest.period, latest.granularity, latest.scope)
            runCurrent()

            val firstPending = api.pending.removeAt(0)
            val latestPending = api.pending.removeAt(0)
            latestPending.result.complete(api.snapshotFor(latest))
            runCurrent()
            // Deliberately release the older response after the newer one.
            firstPending.result.complete(api.snapshotFor(first))
            advanceUntilIdle()

            assertEquals(latest.period, coordinator.state.value.selectedPeriod)
            assertEquals(latest.scope, coordinator.state.value.selectedProjectId)
            assertEquals(latest.scope, coordinator.state.value.snapshot?.projectScopeId)
            assertEquals(label(latest), coordinator.state.value.snapshot?.periodLabel)
            assertEquals(latest.granularity, coordinator.state.value.snapshot?.costTrendGranularity)
            assertEquals(3, coordinator.state.value.projectCatalog?.projectOption("all")?.sourceProjectCount)
            assertEquals(
                coordinator.state.value.projectCatalog?.sourceProjects,
                coordinator.state.value.foundation?.sourceProjects,
            )
        }

        assertEquals(64, api.startedRequests)
        assertTrue(requests.any { it.period == "today" })
        assertTrue(requests.any { it.period == "lifetime" })
        assertTrue(requests.any { it.scope == "unassigned" })
        assertTrue(requests.any { it.scope == "mp_fixture" })
        assertTrue(requests.any { it.granularity == "day" })
        assertTrue(requests.any { it.granularity == "week" })
        assertTrue(requests.any { it.granularity == "month" })
        coordinator.close()
    }

    @Test
    fun deterministic_state_machine_preserves_product_parity_across_72_transitions() = runTest {
        val api = RaceApi()
        val store = RaceStore(testCredentials(), catalog())
        val dispatcher = StandardTestDispatcher(testScheduler)
        val coordinator = MetroraCoordinator(
            store = store,
            api = api,
            scope = CoroutineScope(SupervisorJob() + dispatcher),
            deviceName = "Android state-machine test",
        )
        advanceUntilIdle()

        val required = listOf(
            RaceRequestSpec("today", "all", "day"),
            RaceRequestSpec("lifetime", "all", "month"),
            RaceRequestSpec("today", "all", "day"),
            RaceRequestSpec("all", "mp_fixture", "week"),
            RaceRequestSpec("all", "unassigned", "week"),
            RaceRequestSpec("all", "mp_fixture", "week"),
            RaceRequestSpec("week", "mp_fixture", "day"),
            RaceRequestSpec("month", "mp_fixture", "month"),
        )
        val periods = listOf("today", "week", "30days", "month", "all", "lifetime")
        val scopes = listOf("all", "unassigned", "mp_fixture")
        val granularities = listOf("day", "week", "month")
        var randomState = 0x5EED_183
        val transitions = ArrayList<RaceRequestSpec>(36)
        transitions += required
        repeat(36 - required.size) {
            randomState = next(randomState)
            transitions += RaceRequestSpec(
                period = periods[(randomState ushr 1) % periods.size],
                scope = scopes[(randomState ushr 5) % scopes.size],
                granularity = granularities[(randomState ushr 9) % granularities.size],
            )
        }
        // Repeat the matrix so period→scope, scope→period, trend→period,
        // period→trend, repeated selections, and refresh-like transitions all
        // exercise the same coordinator path.
        val sequence = transitions + transitions
        for (spec in sequence) {
            coordinator.refresh(spec.period, spec.granularity, spec.scope)
            runCurrent()
            val pending = api.pending.removeAt(0)
            pending.result.complete(api.snapshotFor(spec))
            advanceUntilIdle()

            val state = coordinator.state.value
            assertEquals(spec.period, state.selectedPeriod)
            assertEquals(spec.scope, state.selectedProjectId)
            assertEquals(spec.scope, state.snapshot?.projectScopeId)
            assertEquals(label(spec), state.snapshot?.periodLabel)
            assertEquals(spec.granularity, state.snapshot?.costTrendGranularity)
            assertEquals(spec.scope, state.foundation?.projectScopeId)
            assertEquals(label(spec), state.foundation?.periodLabel)
            assertEquals(spec.granularity, state.foundation?.trendGranularity)
            assertEquals("Foundation QA Renamed", state.projectCatalog?.projectOption("mp_fixture")?.name)
            assertEquals("spark", state.projectCatalog?.projectOption("mp_fixture")?.icon)
            assertEquals("cyan", state.projectCatalog?.projectOption("mp_fixture")?.color)
            assertEquals(2, state.projectCatalog?.projectOption("mp_fixture")?.sourceProjectCount)
            assertEquals(1, state.projectCatalog?.projectOption("unassigned")?.sourceProjectCount)
            assertTrue(state.foundation?.workspaceAvailable == false)
        }

        assertEquals(72, api.startedRequests)
        coordinator.close()
    }

    private fun next(value: Int): Int = value * 1_103_515_245 + 12_345

}

private data class RaceRequestSpec(val period: String, val scope: String, val granularity: String)

private data class PendingRequest(
    val period: String,
    val scope: String,
    val granularity: String,
    val result: CompletableDeferred<UsageSnapshot> = CompletableDeferred(),
)

private class RaceApi : MetroraApi {
    private val fingerprint = "ab".repeat(32)
    val pending = ArrayList<PendingRequest>()
    var startedRequests = 0

    override suspend fun discover(host: String, port: Int): DiscoveredDesktop =
        DiscoveredDesktop(host, port, "Metrora Desktop", fingerprint)

    override fun pairingCode(desktop: DiscoveredDesktop): String = "123456"

    override suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials = testCredentials()

    override suspend fun fetchUsage(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
    ): UsageSnapshot = fetchUsageForScope(credentials, period, trendGranularity, null)

    override suspend fun fetchUsageForScope(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ): UsageSnapshot {
        val spec = PendingRequest(period, projectScopeId ?: "all", trendGranularity ?: "day")
        pending += spec
        startedRequests += 1
        return withContext(NonCancellable) { spec.result.await() }
    }

    override suspend fun fetchFoundation(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ): MobileFoundationSnapshot {
        val scope = projectScopeId ?: "all"
        val granularity = trendGranularity ?: "day"
        return MobileFoundationSnapshot(
            desktopId = fingerprint,
            generatedAt = "2026-08-16T10:00:00.000Z",
            retrievedAtEpochMs = 1_700_000_000_000L,
            projectScopeId = scope,
            projectOptions = catalog().projectOptions,
            sourceProjects = catalog().sourceProjects,
            capabilities = CapabilityDiscovery.unavailable(),
            activitySessions = listOf(
                MobileActivitySession(
                    id = "session_fixture",
                    projectId = if (scope == "mp_fixture") "mp_fixture" else "unassigned",
                    sourceProjectId = "sp_" + "a".repeat(64),
                    sourceProjectName = "one",
                    title = "Session · 2026-08-16",
                    sourceIds = listOf("codex"),
                    routeIds = listOf("openai"),
                    brandIds = listOf("openai"),
                    models = listOf("duplicate-model"),
                    costMicrosUsd = 1_000_000L,
                    calls = 1L,
                    turns = 1L,
                    startedAt = "2026-08-16T10:00:00.000Z",
                    endedAt = "2026-08-16T10:01:00.000Z",
                ),
            ),
            activityFreshness = CapabilityFreshness.LIVE,
            activityCoverage = DetailCoverage.UNAVAILABLE,
            analyzeModels = listOf(
                AnalyzeModelUsage("duplicate-model", "openai", listOf("codex"), "openai", 1L, 600_000L, 10L, 20L, 0L, 0L),
                AnalyzeModelUsage("duplicate-model", "anthropic-api", listOf("claude-cli"), "anthropic", 1L, 400_000L, 30L, 40L, 0L, 0L),
            ),
            analyzeModelsFreshness = CapabilityFreshness.LIVE,
            analyzeModelsCoverage = DetailCoverage.UNAVAILABLE,
            analyzeTokensCoverage = DetailCoverage.UNAVAILABLE,
            spend = MobileSpendSummary(1_000_000L, 1L, 1L, listOf(SpendTrendPoint("2026-08-16", 1_000_000L))),
            analyzeSpendFreshness = CapabilityFreshness.LIVE,
            workspaceAvailable = false,
            periodLabel = label(RaceRequestSpec(period, scope, granularity)),
            trendGranularity = granularity,
        )
    }

    override suspend fun fetchProjectCatalog(credentials: PairingCredentials): ProjectCatalogSnapshot = catalog()

    override suspend fun revoke(credentials: PairingCredentials) = Unit

    override fun localIdentityMatches(credentials: PairingCredentials): Boolean = true

    fun snapshotFor(spec: RaceRequestSpec): UsageSnapshot = UsageSnapshot(
        desktopId = fingerprint,
        desktopName = "Metrora Desktop",
        projectScopeId = spec.scope,
        generatedAtEpochMs = 1_700_000_000_000L,
        periodLabel = label(spec),
        costMicrosUsd = 1_000_000L,
        calls = 1L,
        sessions = 1L,
        inputTokens = 1L,
        outputTokens = 1L,
        cacheReadTokens = 0L,
        cacheWriteTokens = 0L,
        cacheHitPercent = 0.0,
        topModels = listOf(
            ModelUsage("duplicate-model", 1L, 600_000L, providerId = "openai", brandId = "openai"),
            ModelUsage("duplicate-model", 1L, 400_000L, providerId = "anthropic-api", brandId = "anthropic"),
        ),
        models = listOf(
            ModelUsage("duplicate-model", 1L, 600_000L, providerId = "openai", brandId = "openai"),
            ModelUsage("duplicate-model", 1L, 400_000L, providerId = "anthropic-api", brandId = "anthropic"),
        ),
        pricingCoverage = 1.0,
        costTrendGranularity = spec.granularity,
        costTrendPeriodLabel = label(spec),
    )
}

private class RaceStore(
    private var credentials: PairingCredentials?,
    private var projectCatalog: ProjectCatalogSnapshot?,
) : MetroraStore {
    override suspend fun loadCredentials(): StorageRead<PairingCredentials> =
        credentials?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveCredentials(credentials: PairingCredentials) {
        this.credentials = credentials
    }

    override suspend fun loadSnapshot(): StorageRead<UsageSnapshot> = StorageRead.Missing

    override suspend fun saveSnapshot(snapshot: UsageSnapshot) = Unit

    override suspend fun saveSnapshotFoundationAndCatalog(
        snapshot: UsageSnapshot,
        foundation: MobileFoundationSnapshot?,
        catalog: ProjectCatalogSnapshot?,
    ) {
        if (catalog != null) projectCatalog = catalog
    }

    override suspend fun loadFoundation(): StorageRead<MobileFoundationSnapshot> = StorageRead.Missing

    override suspend fun loadProjectCatalog(): StorageRead<ProjectCatalogSnapshot> =
        projectCatalog?.let { StorageRead.Present(it) } ?: StorageRead.Missing

    override suspend fun saveProjectCatalog(catalog: ProjectCatalogSnapshot) {
        projectCatalog = catalog
    }

    override suspend fun clearCredentials() {
        credentials = null
    }

    override suspend fun clearSnapshot() = Unit

    override suspend fun clearFoundation() = Unit

    override suspend fun clearProjectCatalog() {
        projectCatalog = null
    }

    override suspend fun clearPairing() {
        credentials = null
        projectCatalog = null
    }
}

private fun testCredentials(): PairingCredentials = PairingCredentials(
    host = "desktop.local",
    port = 7777,
    desktopName = "Metrora Desktop",
    serverFingerprint = "ab".repeat(32),
    clientFingerprint = "cd".repeat(32),
    token = "token",
    pairedAtEpochMs = 1_700_000_000_000L,
)

private fun catalog(): ProjectCatalogSnapshot = ProjectCatalogSnapshot(
    desktopId = "ab".repeat(32),
    generatedAt = "2026-08-16T10:00:00.000Z",
    retrievedAtEpochMs = 1_700_000_000_000L,
    projectOptions = listOf(
        ProjectScopeOption("all", "All projects", "grid", "cyan", 3),
        ProjectScopeOption("unassigned", "Unassigned", "stack", "violet", 1),
        ProjectScopeOption("mp_fixture", "Foundation QA Renamed", "spark", "cyan", 2),
    ),
    sourceProjects = listOf(
        SourceProjectSummary(
            id = "sp_one",
            name = "one",
            contributors = listOf(SourceProjectContributor("codex", listOf("openai"))),
            assignedProjectId = "mp_fixture",
        ),
        SourceProjectSummary(
            id = "sp_two",
            name = "two",
            contributors = listOf(SourceProjectContributor("claude-cli", listOf("anthropic-api"))),
            assignedProjectId = "mp_fixture",
        ),
        SourceProjectSummary(
            id = "sp_three",
            name = "three",
            contributors = listOf(SourceProjectContributor("cursor", listOf("openai"))),
            assignedProjectId = null,
        ),
    ),
)

private fun label(spec: RaceRequestSpec): String = "${spec.period} · ${spec.scope}"
