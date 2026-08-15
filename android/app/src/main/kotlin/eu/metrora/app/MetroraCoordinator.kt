package eu.metrora.app

import android.content.Context
import android.os.Build
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.StorageIssue
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.network.MetroraApi
import eu.metrora.app.network.MetroraApiClient
import eu.metrora.app.network.DiscoveredDesktop
import eu.metrora.app.network.MetroraProtocol
import eu.metrora.app.security.MetroraStore
import eu.metrora.app.security.SecureStore
import java.io.Closeable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class MetroraCoordinator internal constructor(
    private val store: MetroraStore,
    private val api: MetroraApi,
    private val scope: CoroutineScope,
    private val deviceName: String,
) : Closeable {
    constructor(context: Context) : this(
        store = SecureStore(context.applicationContext),
        api = MetroraApiClient(),
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
        deviceName = androidDeviceName(),
    )

    private val mutableState = MutableStateFlow(MetroraUiState())
    private var operationJob: Job? = null
    private var pendingPairResult: Deferred<PairingCredentials>? = null
    private var pendingDesktop: DiscoveredDesktop? = null

    val state: StateFlow<MetroraUiState> = mutableState.asStateFlow()

    init {
        scope.launch { restoreState() }
    }

    fun pair(host: String, portText: String) {
        val current = mutableState.value
        if (current.initializing || current.busy || current.paired) return

        val normalizedHost = try {
            MetroraProtocol.normalizeHost(host)
        } catch (error: IllegalArgumentException) {
            showFailure(
                MetroraFailure(
                    MetroraOperation.DISCOVER,
                    MetroraFailureCategory.COMPATIBILITY,
                    MetroraFailureReason.INVALID_HOST,
                    "Desktop address validation failed",
                ),
            )
            return
        }
        val port = portText.trim().toIntOrNull()?.let { candidate ->
            runCatching { MetroraProtocol.validatePort(candidate) }.getOrNull()
        }
        if (port == null) {
            showFailure(
                MetroraFailure(
                    MetroraOperation.DISCOVER,
                    MetroraFailureCategory.COMPATIBILITY,
                    MetroraFailureReason.INVALID_PORT,
                    "Desktop port validation failed",
                ),
            )
            return
        }

        mutableState.update {
            MetroraUiState(
                initializing = false,
                status = MetroraConnectionState.PAIRING,
            )
        }
        operationJob = scope.launch {
            try {
                val desktop = api.discover(normalizedHost, port)
                currentCoroutineContext().ensureActive()
                val code = api.pairingCode(desktop)
                pendingDesktop = desktop
                mutableState.update {
                    it.copy(
                        status = MetroraConnectionState.VERIFYING_SAS,
                        pairingCode = code,
                        pairingDesktopName = desktop.name,
                        notice = null,
                        failure = null,
                    )
                }
                // Start the approved pairing request as soon as the phone has
                // verified the pinned Desktop identity. Desktop can now show
                // the same SAS while this screen is visible, but no
                // credential is saved until Desktop approves and the phone
                // user confirms the code.
                val pairingResult = scope.async {
                    api.pair(desktop, code, deviceName)
                }
                pendingPairResult = pairingResult
                pairingResult.invokeOnCompletion { error ->
                    if (error == null || error is CancellationException) return@invokeOnCompletion
                    scope.launch {
                        val stillPairing = mutableState.value.status == MetroraConnectionState.VERIFYING_SAS ||
                            mutableState.value.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
                        if (!stillPairing) return@launch
                        when (error) {
                            is MetroraException -> applyFailure(error.failure, allowOfflineFallback = false)
                            else -> applyFailure(
                                MetroraFailure(
                                    MetroraOperation.PAIR,
                                    MetroraFailureCategory.UNEXPECTED,
                                    MetroraFailureReason.UNKNOWN,
                                    error.javaClass.simpleName,
                                ),
                                allowOfflineFallback = false,
                            )
                        }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: MetroraException) {
                applyFailure(error.failure, allowOfflineFallback = false)
            } catch (error: Exception) {
                applyFailure(
                    MetroraFailure(
                        MetroraOperation.PAIR,
                        MetroraFailureCategory.UNEXPECTED,
                        MetroraFailureReason.UNKNOWN,
                        error.javaClass.simpleName,
                    ),
                    allowOfflineFallback = false,
                )
            } finally {
                operationJob = null
            }
        }
    }

    /** Continue only after the user has compared the SAS with Desktop. */
    fun confirmPairingCode() {
        val current = mutableState.value
        if (pendingDesktop == null || current.pairingCode == null) return
        val pairingResult = pendingPairResult ?: return
        if (current.status != MetroraConnectionState.VERIFYING_SAS || current.busy) return

        mutableState.update {
            it.copy(
                status = MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL,
                notice = null,
                failure = null,
            )
        }
        operationJob = scope.launch {
            try {
                val credentials = pairingResult.await()
                currentCoroutineContext().ensureActive()
                store.saveCredentials(credentials)
                pendingPairResult = null
                pendingDesktop = null
                mutableState.update {
                    it.copy(
                        status = MetroraConnectionState.REFRESHING,
                        credentials = credentials,
                        pairingCode = null,
                        pairingDesktopName = null,
                        notice = null,
                        failure = null,
                    )
                }
                refreshAndApply(
                    credentials,
                    MetroraNotice.PAIRING_COMPLETE,
                    allowOfflineFallback = true,
                    preservePairingSuccess = true,
                    period = current.selectedPeriod,
                    projectScopeId = current.selectedProjectId,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: MetroraException) {
                pendingPairResult = null
                pendingDesktop = null
                applyFailure(error.failure, allowOfflineFallback = false)
            } catch (error: Exception) {
                pendingPairResult = null
                pendingDesktop = null
                applyFailure(
                    MetroraFailure(
                        MetroraOperation.PAIR,
                        MetroraFailureCategory.UNEXPECTED,
                        MetroraFailureReason.UNKNOWN,
                        error.javaClass.simpleName,
                    ),
                    allowOfflineFallback = false,
                )
            } finally {
                operationJob = null
            }
        }
    }

    fun cancelPairing() {
        val current = mutableState.value
        if (current.status != MetroraConnectionState.PAIRING &&
            current.status != MetroraConnectionState.VERIFYING_SAS &&
            current.status != MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
        ) return
        operationJob?.cancel()
        pendingPairResult?.cancel()
        pendingPairResult = null
        operationJob = null
        pendingDesktop = null
        mutableState.value = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.UNPAIRED,
            notice = MetroraNotice.PAIRING_CANCELLED,
        )
    }

    fun refresh(
        period: String = mutableState.value.selectedPeriod,
        trendGranularity: String? = null,
        projectScopeId: String? = mutableState.value.selectedProjectId,
    ) {
        val current = mutableState.value
        val credentials = current.credentials ?: return
        if (current.initializing || current.busy ||
            current.status == MetroraConnectionState.REVOKED_OR_UNAUTHORIZED ||
            current.status == MetroraConnectionState.RECOVERY_REQUIRED
        ) return

        mutableState.update {
            it.copy(
                status = MetroraConnectionState.REFRESHING,
                notice = null,
                failure = null,
            )
        }
        operationJob = scope.launch {
            try {
                refreshAndApply(
                    credentials,
                    MetroraNotice.USAGE_REFRESHED,
                    allowOfflineFallback = true,
                    period = period,
                    trendGranularity = trendGranularity,
                    projectScopeId = projectScopeId,
                )
            } catch (error: CancellationException) {
                throw error
            } finally {
                operationJob = null
            }
        }
    }

    fun selectPeriod(period: String) {
        if (period !in SUPPORTED_PERIODS) return
        refresh(period)
    }

    /** Project scope is a canonical Desktop selection, not a local filter. */
    fun selectProject(projectId: String) {
        val current = mutableState.value
        if (current.initializing || current.busy || current.credentials == null) return
        if (projectId != "all" && current.foundation?.projectOption(projectId) == null) return
        if (projectId == current.selectedProjectId) return
        refresh(
            period = current.selectedPeriod,
            trendGranularity = current.snapshot?.costTrendGranularity,
            projectScopeId = projectId,
        )
    }

    fun selectTrendGranularity(granularity: String) {
        if (granularity !in SUPPORTED_TREND_GRANULARITIES) return
        val current = mutableState.value
        if (current.credentials == null || current.snapshot?.costTrendGranularity == granularity) return
        refresh(current.selectedPeriod, granularity)
    }

    fun revoke() {
        val current = mutableState.value
        val credentials = current.credentials ?: return
        if (current.initializing || current.busy) return
        mutableState.update {
            it.copy(
                status = MetroraConnectionState.REVOKING,
                notice = null,
                failure = null,
            )
        }
        operationJob = scope.launch {
            try {
                api.revoke(credentials)
                currentCoroutineContext().ensureActive()
                try {
                    store.clearPairing()
                } catch (error: Exception) {
                    mutableState.update {
                        it.copy(
                            status = MetroraConnectionState.RECOVERY_REQUIRED,
                            notice = MetroraNotice.REMOTE_REVOCATION_CONFIRMED_LOCAL_CLEANUP_NEEDED,
                            failure = localFailure(
                                MetroraFailureReason.STORAGE_CORRUPTED,
                                "Desktop access was revoked, but local cleanup needs attention",
                            ),
                        )
                    }
                    return@launch
                }
                mutableState.value = MetroraUiState(
                    initializing = false,
                    status = MetroraConnectionState.UNPAIRED,
                    notice = MetroraNotice.REMOTE_REVOCATION_COMPLETE,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: MetroraException) {
                applyFailure(error.failure, allowOfflineFallback = false)
            } catch (error: Exception) {
                applyFailure(
                    localFailure(MetroraFailureReason.UNKNOWN, error.javaClass.simpleName),
                    allowOfflineFallback = false,
                )
            } finally {
                operationJob = null
            }
        }
    }

    /** Local cleanup is intentionally separate from remote revoke. */
    fun forgetLocal() {
        val current = mutableState.value
        if (current.initializing || current.busy || !current.hasLocalState) return
        mutableState.update {
            it.copy(
                status = MetroraConnectionState.FORGETTING,
                notice = null,
                failure = null,
            )
        }
        operationJob = scope.launch {
            try {
                store.clearPairing()
                mutableState.value = MetroraUiState(
                    initializing = false,
                    status = MetroraConnectionState.UNPAIRED,
                    notice = MetroraNotice.LOCAL_PAIRING_FORGOTTEN,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        status = MetroraConnectionState.RECOVERY_REQUIRED,
                        failure = localFailure(
                            MetroraFailureReason.STORAGE_CORRUPTED,
                            "Local pairing data could not be removed",
                        ),
                    )
                }
            } finally {
                operationJob = null
            }
        }
    }

    /** Kept as a source-compatible name for the foundation UI/tests. */
    fun disconnect() = revoke()

    override fun close() {
        operationJob?.cancel()
        pendingPairResult?.cancel()
        pendingPairResult = null
        operationJob = null
        pendingDesktop = null
        scope.cancel()
    }

    private suspend fun restoreState() {
        try {
            val credentials = store.loadCredentials()
            val snapshot = store.loadSnapshot()
            val foundation = store.loadFoundation()
            when (credentials) {
                StorageRead.Missing -> restoreWithoutCredentials(snapshot, foundation)
                is StorageRead.Corrupted -> {
                    mutableState.value = recoveryState(
                        credentials = null,
                        snapshot = null,
                        reason = when (credentials.issue) {
                            StorageIssue.KEY_UNAVAILABLE -> MetroraFailureReason.KEY_UNAVAILABLE
                            else -> MetroraFailureReason.STORAGE_CORRUPTED
                        },
                        detail = "Saved pairing credentials need recovery",
                    )
                }
                is StorageRead.Present -> restorePaired(credentials.value, snapshot, foundation)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            mutableState.value = recoveryState(
                credentials = null,
                snapshot = null,
                reason = MetroraFailureReason.STORAGE_CORRUPTED,
                detail = "Encrypted local state could not be read",
            )
        }
    }

    private fun restoreWithoutCredentials(
        snapshot: StorageRead<UsageSnapshot>,
        foundation: StorageRead<MobileFoundationSnapshot>,
    ) {
        mutableState.value = when (snapshot) {
            StorageRead.Missing -> when (foundation) {
                StorageRead.Missing -> MetroraUiState(initializing = false)
                is StorageRead.Present -> recoveryState(
                    credentials = null,
                    snapshot = null,
                    reason = MetroraFailureReason.INCONSISTENT_LOCAL_STATE,
                    detail = "A saved mobile foundation exists without a saved pairing",
                )
                is StorageRead.Corrupted -> recoveryState(
                    credentials = null,
                    snapshot = null,
                    reason = MetroraFailureReason.STORAGE_CORRUPTED,
                    detail = "Saved mobile data needs recovery",
                )
            }
            is StorageRead.Present -> recoveryState(
                credentials = null,
                snapshot = null,
                reason = MetroraFailureReason.INCONSISTENT_LOCAL_STATE,
                detail = "A saved snapshot exists without a saved pairing",
            )
            is StorageRead.Corrupted -> recoveryState(
                credentials = null,
                snapshot = null,
                reason = MetroraFailureReason.STORAGE_CORRUPTED,
                detail = "Saved local data needs recovery",
            )
        }
    }

    private suspend fun restorePaired(
        credentials: PairingCredentials,
        snapshot: StorageRead<UsageSnapshot>,
        foundation: StorageRead<MobileFoundationSnapshot>,
    ) {
        if (!api.localIdentityMatches(credentials)) {
            mutableState.value = recoveryState(
                credentials = credentials,
                snapshot = null,
                reason = MetroraFailureReason.LOCAL_IDENTITY_CHANGED,
                detail = "This phone no longer has the identity used for this pairing",
            )
            return
        }
        val persistedSnapshot = (snapshot as? StorageRead.Present<UsageSnapshot>)?.value
            ?.takeIf { it.desktopId == credentials.serverFingerprint }
        val usableFoundation = when (foundation) {
            StorageRead.Missing -> null
            is StorageRead.Present -> foundation.value.takeIf {
                persistedSnapshot == null || foundationMatches(
                    it,
                    credentials,
                    persistedSnapshot.projectScopeId,
                    persistedSnapshot,
                    requestedTrendGranularity = null,
                )
            }
            is StorageRead.Corrupted -> {
                runCatching { store.clearFoundation() }
                null
            }
        }
        when (snapshot) {
            StorageRead.Missing -> mutableState.value = restoredState(credentials, null, usableFoundation)
            is StorageRead.Present -> {
                val usable = snapshot.value.takeIf { it.desktopId == credentials.serverFingerprint }
                mutableState.value = restoredState(credentials, usable, usableFoundation)
            }
            is StorageRead.Corrupted -> {
                val cleanupFailure = runCatching { store.clearSnapshot() }.exceptionOrNull()
                mutableState.value = if (cleanupFailure == null) {
                    restoredState(credentials, null, usableFoundation).copy(notice = MetroraNotice.SNAPSHOT_RECOVERED)
                } else {
                    restoredState(credentials, null, usableFoundation).copy(
                        status = MetroraConnectionState.ERROR,
                        failure = localFailure(
                            MetroraFailureReason.STORAGE_CORRUPTED,
                            "The saved usage snapshot is unreadable",
                        ),
                    )
                }
            }
        }
    }

    private fun restoredState(
        credentials: PairingCredentials,
        snapshot: UsageSnapshot?,
        foundation: MobileFoundationSnapshot? = null,
    ): MetroraUiState =
        MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.RESTORED,
            credentials = credentials,
            snapshot = snapshot,
            foundation = foundation,
            capabilities = foundation?.capabilities ?: CapabilityDiscovery.unavailable(),
            selectedProjectId = foundation?.projectScopeId?.takeIf { foundation.projectOption(it) != null } ?: "all",
        )

    private suspend fun refreshAndApply(
        credentials: PairingCredentials,
        successNotice: MetroraNotice,
        allowOfflineFallback: Boolean,
        preservePairingSuccess: Boolean = false,
        period: String = mutableState.value.selectedPeriod,
        trendGranularity: String? = null,
        projectScopeId: String? = mutableState.value.selectedProjectId,
    ) {
        try {
            val requestedScopeId = normalizedProjectScopeId(projectScopeId)
            val snapshot = api.fetchUsageForScope(credentials, period, trendGranularity, requestedScopeId)
            currentCoroutineContext().ensureActive()
            if (snapshot.desktopId != credentials.serverFingerprint || snapshot.projectScopeId != requestedScopeId) {
                throw MetroraException(
                    MetroraFailure(
                        MetroraOperation.REFRESH,
                        MetroraFailureCategory.MALFORMED_RESPONSE,
                        MetroraFailureReason.MALFORMED_RESPONSE,
                        "Desktop returned a usage scope that does not match the request",
                    ),
                )
            }
            val current = mutableState.value
            val capabilities = optionalCapabilities(credentials, current.capabilities)
            val foundation = resolveFoundation(
                credentials = credentials,
                period = period,
                trendGranularity = trendGranularity,
                projectScopeId = requestedScopeId,
                snapshot = snapshot,
                fallback = current.foundation,
                requestedTrendGranularity = trendGranularity,
            )
            currentCoroutineContext().ensureActive()
            // Usage and foundation are committed together only after both have
            // been proven to describe the same Desktop, period and Project.
            store.saveSnapshotAndFoundation(snapshot, foundation)
            val selected = foundation?.projectScopeId
                ?.takeIf { id -> id == "all" || foundation.projectOption(id) != null }
                ?: requestedScopeId
            mutableState.update {
                it.copy(
                    initializing = false,
                    status = MetroraConnectionState.CONNECTED,
                    selectedPeriod = period,
                    snapshot = snapshot,
                    foundation = foundation,
                    capabilities = capabilities,
                    selectedProjectId = selected,
                    notice = successNotice,
                    failure = null,
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: MetroraException) {
            applyFailure(error.failure, allowOfflineFallback, preservePairingSuccess)
        } catch (error: Exception) {
            applyFailure(
                localFailure(MetroraFailureReason.STORAGE_CORRUPTED, error.javaClass.simpleName),
                allowOfflineFallback,
                preservePairingSuccess,
            )
        }
    }

    private suspend fun optionalCapabilities(
        credentials: PairingCredentials,
        fallback: CapabilityDiscovery,
    ): CapabilityDiscovery = try {
        api.fetchCapabilities(credentials)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        fallback
    }

    private suspend fun resolveFoundation(
        credentials: PairingCredentials,
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
        snapshot: UsageSnapshot,
        fallback: MobileFoundationSnapshot?,
        requestedTrendGranularity: String?,
    ): MobileFoundationSnapshot? = try {
        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        val compatibleFallback = fallback?.takeIf {
            foundationMatches(it, credentials, requestedScopeId, snapshot, requestedTrendGranularity)
        }
        val candidate = api.fetchFoundation(credentials, period, trendGranularity, requestedScopeId)
        when {
            candidate.available && foundationMatches(candidate, credentials, requestedScopeId, snapshot, requestedTrendGranularity) -> candidate
            compatibleFallback != null -> compatibleFallback
            requestedScopeId == "all" -> null
            else -> throw foundationScopeFailure()
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: MetroraException) {
        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        if (fallback?.let {
                foundationMatches(it, credentials, requestedScopeId, snapshot, requestedTrendGranularity)
            } == true) {
            fallback
        } else if (requestedScopeId == "all") {
            null
        } else {
            throw error
        }
    } catch (error: Exception) {
        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        if (fallback?.let {
                foundationMatches(it, credentials, requestedScopeId, snapshot, requestedTrendGranularity)
            } == true) {
            fallback
        } else if (requestedScopeId == "all") {
            null
        } else {
            throw MetroraException(
                MetroraFailure(
                    MetroraOperation.REFRESH,
                    MetroraFailureCategory.CONNECTIVITY,
                    MetroraFailureReason.COMPANION_API_UNAVAILABLE,
                    "Project-scoped foundation could not be refreshed",
                ),
                error,
            )
        }
    }

    private fun foundationMatches(
        foundation: MobileFoundationSnapshot,
        credentials: PairingCredentials,
        projectScopeId: String,
        snapshot: UsageSnapshot,
        requestedTrendGranularity: String?,
    ): Boolean {
        if (!foundation.available || foundation.desktopId != credentials.serverFingerprint) return false
        if (foundation.projectScopeId != projectScopeId || snapshot.projectScopeId != projectScopeId) return false
        if (foundation.periodLabel == "unknown" || foundation.periodLabel != snapshot.periodLabel) return false
        return foundation.trendGranularity == snapshot.costTrendGranularity ||
            (foundation.trendGranularity == null && requestedTrendGranularity == null && snapshot.costTrendGranularity == "day")
    }

    private fun foundationScopeFailure(): MetroraException = MetroraException(
        MetroraFailure(
            MetroraOperation.REFRESH,
            MetroraFailureCategory.COMPATIBILITY,
            MetroraFailureReason.COMPANION_API_UNAVAILABLE,
            "Project-scoped foundation is unavailable for this Desktop",
        ),
    )

    private fun normalizedProjectScopeId(value: String?): String = value?.trim()?.takeIf { it.isNotEmpty() } ?: "all"

    private fun applyFailure(
        failure: MetroraFailure,
        allowOfflineFallback: Boolean,
        preservePairingSuccess: Boolean = false,
    ) {
        val current = mutableState.value
        val nextStatus = when {
            failure.reason == MetroraFailureReason.UNAUTHORIZED ||
                failure.reason == MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED ->
                MetroraConnectionState.REVOKED_OR_UNAUTHORIZED
            failure.reason == MetroraFailureReason.LOCAL_IDENTITY_CHANGED ||
                failure.reason == MetroraFailureReason.KEY_UNAVAILABLE ||
                failure.reason == MetroraFailureReason.INCONSISTENT_LOCAL_STATE ->
                MetroraConnectionState.RECOVERY_REQUIRED
            preservePairingSuccess && allowOfflineFallback &&
                failure.category == MetroraFailureCategory.CONNECTIVITY &&
                current.paired && current.snapshot == null ->
                MetroraConnectionState.PAIRED_NO_SNAPSHOT
            allowOfflineFallback && failure.category == MetroraFailureCategory.CONNECTIVITY && current.paired ->
                if (current.snapshot == null) {
                    MetroraConnectionState.OFFLINE_NO_SNAPSHOT
                } else {
                    MetroraConnectionState.OFFLINE_WITH_SNAPSHOT
                }
            else -> MetroraConnectionState.ERROR
        }
        mutableState.update {
            it.copy(
                initializing = false,
                status = nextStatus,
                failure = failure,
                notice = if (nextStatus == MetroraConnectionState.OFFLINE_NO_SNAPSHOT ||
                    nextStatus == MetroraConnectionState.PAIRED_NO_SNAPSHOT
                ) {
                    MetroraNotice.PAIRED_WITHOUT_USAGE
                } else {
                    null
                },
            )
        }
    }

    private fun showFailure(failure: MetroraFailure) {
        mutableState.update {
            it.copy(
                initializing = false,
                status = MetroraConnectionState.ERROR,
                pairingCode = null,
                pairingDesktopName = null,
                failure = failure,
                notice = null,
            )
        }
    }

    private fun recoveryState(
        credentials: PairingCredentials?,
        snapshot: UsageSnapshot?,
        reason: MetroraFailureReason,
        detail: String,
    ): MetroraUiState = MetroraUiState(
        initializing = false,
        status = MetroraConnectionState.RECOVERY_REQUIRED,
        credentials = credentials,
        snapshot = snapshot,
        failure = localFailure(reason, detail),
    )

    private fun localFailure(reason: MetroraFailureReason, detail: String): MetroraFailure = MetroraFailure(
        operation = MetroraOperation.LOCAL_ACTION,
        category = MetroraFailureCategory.LOCAL_STATE,
        reason = reason,
        technicalDetail = detail,
    )

    private companion object {
        val SUPPORTED_PERIODS = setOf("today", "week", "30days", "month", "all", "lifetime")
        val SUPPORTED_TREND_GRANULARITIES = setOf("day", "week", "month")
    }
}

private fun androidDeviceName(): String = listOf(Build.MANUFACTURER, Build.MODEL)
    .map(String::trim)
    .filter(String::isNotBlank)
    .distinct()
    .joinToString(" ")
    .ifBlank { "Android" }
    .take(80)
