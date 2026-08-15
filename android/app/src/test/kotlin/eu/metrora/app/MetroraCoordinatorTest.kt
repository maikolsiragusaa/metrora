package eu.metrora.app

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MetroraCoordinatorTest {
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
    fun connectivity_failure_keeps_cached_snapshot_but_unauthorized_enters_recovery_path() = runTest {
        val store = FakeStore(testCredentials(), testSnapshot())
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

private class FakeStore(
    var credentials: PairingCredentials? = null,
    var snapshot: UsageSnapshot? = null,
) : MetroraStore {
    var credentialsRead: StorageRead<PairingCredentials>? = null
    var snapshotRead: StorageRead<UsageSnapshot>? = null

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

    override suspend fun clearCredentials() {
        credentials = null
    }

    override suspend fun clearSnapshot() {
        snapshot = null
    }

    override suspend fun clearPairing() {
        credentials = null
        snapshot = null
    }
}

private class FakeApi : MetroraApi {
    private val serverFingerprint = "ab".repeat(32)
    private val desktop = DiscoveredDesktop("desktop.local", 7777, "Metrora Desktop", serverFingerprint)
    var pairingResult: CompletableDeferred<PairingCredentials>? = null
    var fetchResult: CompletableDeferred<UsageSnapshot>? = null
    var fetchFailure: MetroraException? = null
    var revokeFailure: MetroraException? = null
    var identityMatches = true
    val fetchCount = AtomicInteger()

    override suspend fun discover(host: String, port: Int): DiscoveredDesktop = desktop

    override fun pairingCode(desktop: DiscoveredDesktop): String = "123456"

    override suspend fun pair(
        desktop: DiscoveredDesktop,
        expectedCode: String,
        deviceName: String,
    ): PairingCredentials = pairingResult?.await() ?: testCredentials()

    override suspend fun fetchUsage(credentials: PairingCredentials, period: String): UsageSnapshot {
        fetchCount.incrementAndGet()
        fetchFailure?.let { throw it }
        return fetchResult?.await() ?: testSnapshot()
    }

    override suspend fun revoke(credentials: PairingCredentials) {
        revokeFailure?.let { throw it }
    }

    override fun localIdentityMatches(credentials: PairingCredentials): Boolean = identityMatches
}
