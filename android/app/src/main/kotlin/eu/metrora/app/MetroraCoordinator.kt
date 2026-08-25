package eu.metrora.app

import android.content.Context
import android.os.Build
import eu.metrora.app.demo.MetroraDemoDataSource
import eu.metrora.app.demo.MetroraDemoDatasetV1
import eu.metrora.app.demo.MetroraDemoLifecycleState
import eu.metrora.app.demo.MetroraDemoLaunchSpec
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.StorageIssue
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.ActivityPullRequestsPage
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySessionDetail
import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.ActivityTab
import eu.metrora.app.data.ActivitySessionsPage
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
    private val demoLaunchSpec: MetroraDemoLaunchSpec? = null,
    private val demoLifecycleState: MetroraDemoLifecycleState? = null,
) : Closeable {
    constructor(
        context: Context,
        demoLaunchSpec: MetroraDemoLaunchSpec? = null,
        demoLifecycleState: MetroraDemoLifecycleState? = null,
    ) : this(
        store = SecureStore(context.applicationContext),
        api = MetroraApiClient(),
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
        deviceName = androidDeviceName(),
        demoLaunchSpec = demoLaunchSpec,
        demoLifecycleState = demoLifecycleState,
    )

    private val mutableState = MutableStateFlow(MetroraUiState())
    private var operationJob: Job? = null
    private var activityJob: Job? = null
    private var requestGeneration: Long = 0L
    private var activityRequestGeneration: Long = 0L
    private var pendingPairResult: Deferred<PairingCredentials>? = null
    private var pendingDesktop: DiscoveredDesktop? = null
    private var demoDataSource: MetroraDemoDataSource? = null

    val state: StateFlow<MetroraUiState> = mutableState.asStateFlow()

    init {
        scope.launch { restoreState() }
    }

    fun pair(host: String, portText: String) {
        val current = mutableState.value
        if (current.initializing || current.busy || current.paired || current.isDemo) return

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

    /** Enter the built-in fixture without creating a pairing or touching persistence. */
    fun enterDemo() {
        val current = mutableState.value
        if (current.initializing || current.paired || current.isDemo || current.status != MetroraConnectionState.UNPAIRED) return
        enterDemo(MetroraDemoLaunchSpec.forExploreDemo())
    }

    /** Return to the untouched unpaired real state; Demo Mode has no store cleanup. */
    fun exitDemo() {
        if (!mutableState.value.isDemo) return
        requestGeneration += 1
        activityRequestGeneration += 1
        operationJob?.cancel()
        activityJob?.cancel()
        operationJob = null
        activityJob = null
        demoDataSource = null
        mutableState.value = MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.UNPAIRED,
        )
    }

    fun refresh(
        period: String = mutableState.value.selectedPeriod,
        trendGranularity: String? = null,
        projectScopeId: String? = mutableState.value.selectedProjectId,
    ) {
        val current = mutableState.value
        if (current.isDemo) {
            refreshDemo(period, trendGranularity, projectScopeId)
            return
        }
        val credentials = current.credentials ?: return
        if (current.initializing || current.status in setOf(
                MetroraConnectionState.PAIRING,
                MetroraConnectionState.VERIFYING_SAS,
                MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL,
                MetroraConnectionState.REVOKED_OR_UNAUTHORIZED,
                MetroraConnectionState.RECOVERY_REQUIRED,
                MetroraConnectionState.REVOKING,
                MetroraConnectionState.FORGETTING,
            )
        ) return

        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        val generation = ++requestGeneration
        operationJob?.cancel()
        val activityGeneration = ++activityRequestGeneration
        activityJob?.cancel()
        val domainChanged = current.selectedProjectId != requestedScopeId ||
            current.selectedPeriod != period ||
            current.snapshot?.let { trendGranularity != null && it.costTrendGranularity != trendGranularity } == true

        mutableState.update {
            it.copy(
                status = MetroraConnectionState.REFRESHING,
                selectedPeriod = period,
                selectedProjectId = requestedScopeId,
                snapshot = if (domainChanged) null else it.snapshot,
                foundation = if (domainChanged) null else it.foundation,
                activity = if (domainChanged) null else it.activity,
                activityFailure = if (domainChanged) null else it.activityFailure,
                notice = null,
                failure = null,
            )
        }
        val foundationFallback = current.foundation
        val activityFallback = current.activity
        operationJob = scope.launch {
            try {
                refreshAndApply(
                    credentials,
                    MetroraNotice.USAGE_REFRESHED,
                    allowOfflineFallback = true,
                    period = period,
                    trendGranularity = trendGranularity,
                    projectScopeId = requestedScopeId,
                    foundationFallback = foundationFallback,
                    activityFallback = activityFallback,
                    activityGeneration = activityGeneration,
                    generation = generation,
                )
            } catch (error: CancellationException) {
                throw error
            } finally {
                if (requestGeneration == generation) operationJob = null
            }
        }
    }

    fun selectPeriod(period: String) {
        if (period !in SUPPORTED_PERIODS) return
        if (mutableState.value.isDemo && !MetroraDemoDatasetV1.supportsPeriod(period)) return
        refresh(period)
    }

    /** Project scope is a canonical Desktop selection, not a local filter. */
    fun selectProject(projectId: String) {
        val current = mutableState.value
        if (current.initializing || (!current.isDemo && current.credentials == null) || current.status in setOf(
                MetroraConnectionState.PAIRING,
                MetroraConnectionState.VERIFYING_SAS,
                MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL,
                MetroraConnectionState.REVOKING,
                MetroraConnectionState.FORGETTING,
            )
        ) return
        if (projectId != "all") {
            val projectKnown = if (current.projectCatalog?.available == true) {
                // Once the independent catalog is available it is the sole
                // authority for existence. A period-scoped Foundation must
                // not resurrect a Project deleted by Desktop.
                current.projectCatalog.projectOption(projectId) != null
            } else {
                current.projectCatalog?.projectOption(projectId) != null ||
                    current.foundation?.projectOption(projectId) != null
            }
            if (!projectKnown) return
        }
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
        if ((!current.isDemo && current.credentials == null) || current.snapshot?.costTrendGranularity == granularity) return
        refresh(current.selectedPeriod, granularity, current.selectedProjectId)
    }

    /** Refresh only the bounded Activity query; Overview domains remain stable while filters change. */
    fun setActivityQuery(query: ActivityQuery) {
        val current = mutableState.value
        if (current.isDemo) {
            setDemoActivityQuery(query)
            return
        }
        val credentials = current.credentials ?: return
        if (current.initializing || current.status in setOf(
                MetroraConnectionState.REVOKED_OR_UNAUTHORIZED,
                MetroraConnectionState.RECOVERY_REQUIRED,
                MetroraConnectionState.REVOKING,
                MetroraConnectionState.FORGETTING,
            )
        ) return
        val normalized = query.copy(
            period = current.selectedPeriod,
            projectScopeId = current.selectedProjectId,
        )
        if (current.activity?.query == normalized) return
        val generation = ++activityRequestGeneration
        activityJob?.cancel()
        mutableState.update { it.copy(activity = null, activityFailure = null, notice = null) }
        activityJob = scope.launch {
            try {
                val loaded = fetchActivitySnapshot(credentials, normalized, generation)
                if (activityRequestGeneration != generation) return@launch
                store.saveActivity(loaded)
                mutableState.update { it.copy(activity = loaded, activityFailure = null, failure = null) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (activityRequestGeneration == generation) {
                    mutableState.update { state ->
                        state.copy(
                            activity = null,
                            activityFailure = boundedActivityFailure(error),
                        )
                    }
                }
            } finally {
                if (activityRequestGeneration == generation) activityJob = null
            }
        }
    }

    fun loadMoreActivity(tab: ActivityTab) {
        val current = mutableState.value
        if (current.isDemo) return
        val credentials = current.credentials ?: return
        val activity = current.activity ?: return
        val cursor = when (tab) {
            ActivityTab.SESSIONS -> activity.sessionNextCursor
            ActivityTab.PULL_REQUESTS -> activity.pullRequestNextCursor
        } ?: return
        val generation = ++activityRequestGeneration
        activityJob?.cancel()
        activityJob = scope.launch {
            try {
                val next = when (tab) {
                    ActivityTab.SESSIONS -> api.fetchActivitySessions(credentials, activity.query, cursor)
                    ActivityTab.PULL_REQUESTS -> api.fetchActivityPullRequests(credentials, activity.query, cursor)
                }
                if (activityRequestGeneration != generation) return@launch
                val before = mutableState.value.activity?.takeIf { it.query == activity.query } ?: return@launch
                val merged = when (tab) {
                    ActivityTab.SESSIONS -> mergeActivitySessions(before, next as ActivitySessionsPage)
                    ActivityTab.PULL_REQUESTS -> mergeActivityPullRequests(before, next as ActivityPullRequestsPage)
                }
                store.saveActivity(merged)
                mutableState.update { it.copy(activity = merged, failure = null) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // A page failure leaves already fetched safe rows intact, but
                // an advertised V1 failure must remain observable.
                if (activityRequestGeneration == generation && mutableState.value.capabilities.isAvailable("activity.sessions")) {
                    mutableState.update { it.copy(activityFailure = boundedActivityFailure(error)) }
                }
            } finally {
                if (activityRequestGeneration == generation) activityJob = null
            }
        }
    }

    fun openActivitySession(id: String) {
        val current = mutableState.value
        if (current.isDemo) {
            val activity = current.activity ?: return
            val detail = demoDataSource?.activitySessionDetail(activity.query, id) ?: return
            mutableState.update { it.copy(activity = it.activity?.copy(selectedSession = detail), status = MetroraConnectionState.DEMO) }
            return
        }
        val credentials = current.credentials ?: return
        val activity = current.activity ?: return
        val session = activity.sessions.firstOrNull { it.id == id } ?: return
        val fallback = ActivitySessionDetail(
            session = session,
            durationMs = null,
            inputTokens = null,
            outputTokens = null,
            reasoningTokens = null,
            cacheReadTokens = null,
            cacheWriteTokens = null,
            cacheReusePercent = null,
            reasoningSemantics = "unavailable",
            detailCoverage = eu.metrora.app.data.DetailCoverage.UNAVAILABLE,
        )
        mutableState.update { it.copy(activity = it.activity?.copy(selectedSession = fallback)) }
        val generation = ++activityRequestGeneration
        activityJob?.cancel()
        activityJob = scope.launch {
            try {
                val detail = api.fetchActivitySessionDetail(credentials, activity.query, id)
                if (activityRequestGeneration != generation) return@launch
                require(detail.session.id == id && activityProjectMatches(detail.session.projectId, activity.query.projectScopeId)) {
                    "Desktop returned Activity detail for a different session or Project scope"
                }
                val next = mutableState.value.activity?.takeIf { it.query == activity.query }?.copy(selectedSession = detail) ?: return@launch
                store.saveActivity(next)
                mutableState.update { it.copy(activity = next) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // The bounded summary remains available offline; unavailable
                // detail is presented explicitly by the sheet.
            } finally {
                if (activityRequestGeneration == generation) activityJob = null
            }
        }
    }

    fun openActivityPullRequest(id: String) {
        mutableState.update { state ->
            state.copy(activity = state.activity?.copy(selectedPullRequest = state.activity.pullRequests.firstOrNull { it.id == id }))
        }
    }

    fun closeActivityDetail() {
        mutableState.update { state -> state.copy(activity = state.activity?.copy(selectedSession = null, selectedPullRequest = null)) }
    }

    fun revoke() {
        val current = mutableState.value
        if (current.isDemo) return
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
        if (current.isDemo) return
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
        requestGeneration += 1
        activityRequestGeneration += 1
        operationJob?.cancel()
        activityJob?.cancel()
        pendingPairResult?.cancel()
        pendingPairResult = null
        operationJob = null
        pendingDesktop = null
        scope.cancel()
    }

    private fun enterDemo(spec: MetroraDemoLaunchSpec) {
        enterDemo(
            session = spec.session,
            period = "month",
            projectScopeId = "all",
        )
    }

    private fun enterDemo(
        session: eu.metrora.app.demo.MetroraDemoSession,
        period: String,
        projectScopeId: String,
    ) {
        val source = MetroraDemoDatasetV1.source(session.today)
        val safePeriod = period.takeIf(MetroraDemoDatasetV1::supportsPeriod) ?: "month"
        val safeProjectScopeId = projectScopeId.takeIf { id ->
            source.load().projectCatalog.projectOption(id) != null
        } ?: "all"
        val payload = source.load(
            period = safePeriod,
            trendGranularity = "day",
            projectScopeId = safeProjectScopeId,
        )
        demoDataSource = source
        mutableState.value = demoState(source, payload, safePeriod)
    }

    private fun refreshDemo(
        period: String,
        trendGranularity: String?,
        projectScopeId: String?,
    ) {
        val current = mutableState.value
        if (!current.isDemo || !MetroraDemoDatasetV1.supportsPeriod(period)) return
        val source = demoDataSource ?: return
        val scopeId = normalizedProjectScopeId(projectScopeId)
        if (source.load().projectCatalog.projectOption(scopeId) == null) return
        val query = current.activity?.query?.copy(
            period = period,
            projectScopeId = scopeId,
            effectiveFrom = null,
            effectiveTo = null,
        )
        val payload = source.load(
            period = period,
            trendGranularity = trendGranularity ?: current.snapshot?.costTrendGranularity ?: "day",
            projectScopeId = scopeId,
            activityQuery = query,
        )
        mutableState.value = demoState(source, payload, period)
    }

    private fun setDemoActivityQuery(query: ActivityQuery) {
        val current = mutableState.value
        val source = demoDataSource ?: return
        val normalized = query.copy(
            period = current.selectedPeriod,
            projectScopeId = current.selectedProjectId,
            effectiveFrom = null,
            effectiveTo = null,
        )
        val currentQuery = current.activity?.query
        if (currentQuery?.matchesRequest(normalized) == true &&
            currentQuery.provider == normalized.provider &&
            currentQuery.route == normalized.route &&
            currentQuery.model == normalized.model &&
            currentQuery.source == normalized.source
        ) return
        val loaded = source.load(
            period = current.selectedPeriod,
            trendGranularity = current.snapshot?.costTrendGranularity ?: "day",
            projectScopeId = current.selectedProjectId,
            activityQuery = normalized,
        ).activity
        mutableState.update {
            it.copy(
                status = MetroraConnectionState.DEMO,
                activity = loaded,
                activityFailure = null,
                failure = null,
                notice = null,
            )
        }
    }

    private fun demoState(
        source: MetroraDemoDataSource,
        payload: eu.metrora.app.demo.MetroraDemoPayload,
        selectedPeriod: String = periodKeyFromLabel(payload.snapshot.periodLabel),
    ): MetroraUiState =
        MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.DEMO,
            dataMode = MetroraDataMode.DEMO,
            demoDatasetVersion = source.datasetVersion,
            demoToday = source.today.toString(),
            selectedPeriod = selectedPeriod,
            selectedProjectId = payload.snapshot.projectScopeId,
            snapshot = payload.snapshot,
            foundation = payload.foundation,
            projectCatalog = payload.projectCatalog,
            activity = payload.activity,
            capabilities = payload.capabilities,
            notice = null,
            failure = null,
        )

    private suspend fun restoreState() {
        try {
            val credentials = store.loadCredentials()
            val snapshot = store.loadSnapshot()
            val foundation = store.loadFoundation()
            val projectCatalog = store.loadProjectCatalog()
            val activity = store.loadActivity()
            if (credentials is StorageRead.Missing &&
                snapshot is StorageRead.Missing &&
                foundation is StorageRead.Missing &&
                projectCatalog is StorageRead.Missing &&
                activity is StorageRead.Missing
            ) {
                when {
                    demoLaunchSpec != null -> enterDemo(demoLaunchSpec)
                    demoLifecycleState != null -> enterDemo(
                        session = demoLifecycleState.session,
                        period = demoLifecycleState.selectedPeriod,
                        projectScopeId = demoLifecycleState.selectedProjectId,
                    )
                    else -> restoreWithoutCredentials(snapshot, foundation, projectCatalog, activity)
                }
                return
            }
            when (credentials) {
                StorageRead.Missing -> restoreWithoutCredentials(snapshot, foundation, projectCatalog, activity)
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
                is StorageRead.Present -> restorePaired(credentials.value, snapshot, foundation, projectCatalog, activity)
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
        projectCatalog: StorageRead<ProjectCatalogSnapshot>,
        activity: StorageRead<ActivitySnapshot>,
    ) {
        if (activity is StorageRead.Present) {
            mutableState.value = recoveryState(
                credentials = null,
                snapshot = null,
                reason = MetroraFailureReason.INCONSISTENT_LOCAL_STATE,
                detail = "A saved Activity projection exists without a saved pairing",
            )
            return
        }
        mutableState.value = when (snapshot) {
            StorageRead.Missing -> when (foundation) {
                StorageRead.Missing -> when (projectCatalog) {
                    StorageRead.Missing -> MetroraUiState(initializing = false)
                    is StorageRead.Present -> recoveryState(
                        credentials = null,
                        snapshot = null,
                        reason = MetroraFailureReason.INCONSISTENT_LOCAL_STATE,
                        detail = "A saved Project catalog exists without a saved pairing",
                    )
                    is StorageRead.Corrupted -> recoveryState(
                        credentials = null,
                        snapshot = null,
                        reason = MetroraFailureReason.STORAGE_CORRUPTED,
                        detail = "Saved Project data needs recovery",
                    )
                }
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
        projectCatalog: StorageRead<ProjectCatalogSnapshot>,
        activity: StorageRead<ActivitySnapshot>,
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
        val usableProjectCatalog = when (projectCatalog) {
            StorageRead.Missing -> null
            is StorageRead.Present -> projectCatalog.value.takeIf { it.desktopId == credentials.serverFingerprint }
            is StorageRead.Corrupted -> {
                runCatching { store.clearProjectCatalog() }
                null
            }
        }
        val usableActivity = when (activity) {
            StorageRead.Missing -> null
            is StorageRead.Present -> activity.value.takeIf { value ->
                value.desktopId == credentials.serverFingerprint &&
                    persistedSnapshot?.let { snapshotValue ->
                        value.query.projectScopeId == snapshotValue.projectScopeId &&
                            value.query.period == periodKeyFromLabel(snapshotValue.periodLabel)
                    } != false
            }
            is StorageRead.Corrupted -> {
                runCatching { store.clearActivity() }
                null
            }
        }
        when (snapshot) {
            StorageRead.Missing -> mutableState.value = restoredState(credentials, null, usableFoundation, usableProjectCatalog, usableActivity)
            is StorageRead.Present -> {
                val usable = snapshot.value.takeIf { it.desktopId == credentials.serverFingerprint }
                mutableState.value = restoredState(credentials, usable, usableFoundation, usableProjectCatalog, usableActivity)
            }
            is StorageRead.Corrupted -> {
                val cleanupFailure = runCatching { store.clearSnapshot() }.exceptionOrNull()
                mutableState.value = if (cleanupFailure == null) {
                    restoredState(credentials, null, usableFoundation, usableProjectCatalog, usableActivity).copy(notice = MetroraNotice.SNAPSHOT_RECOVERED)
                } else {
                    restoredState(credentials, null, usableFoundation, usableProjectCatalog, usableActivity).copy(
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
        projectCatalog: ProjectCatalogSnapshot? = null,
        activity: ActivitySnapshot? = null,
    ): MetroraUiState =
        MetroraUiState(
            initializing = false,
            status = MetroraConnectionState.RESTORED,
            selectedPeriod = (snapshot?.periodLabel ?: foundation?.periodLabel)?.let(::periodKeyFromLabel)
                ?: activity?.query?.period
                ?: "month",
            credentials = credentials,
            snapshot = snapshot,
            foundation = foundation,
            projectCatalog = projectCatalog,
            activity = activity,
            // Capability discovery is not persisted in Foundation. Until the
            // paired Desktop answers the live V1 capability request, Activity
            // must remain on the genuine legacy/unknown path.
            capabilities = CapabilityDiscovery.unavailable(),
            selectedProjectId = listOfNotNull(
                foundation?.projectScopeId,
                snapshot?.projectScopeId,
                activity?.query?.projectScopeId,
            ).firstOrNull { id ->
                when {
                    id == "all" -> true
                    projectCatalog?.available == true -> projectCatalog.projectOption(id) != null
                    else -> projectCatalog?.projectOption(id) != null || foundation?.projectOption(id) != null
                }
            } ?: "all",
        )

    private suspend fun refreshAndApply(
        credentials: PairingCredentials,
        successNotice: MetroraNotice,
        allowOfflineFallback: Boolean,
        preservePairingSuccess: Boolean = false,
        period: String = mutableState.value.selectedPeriod,
        trendGranularity: String? = null,
        projectScopeId: String? = mutableState.value.selectedProjectId,
        foundationFallback: MobileFoundationSnapshot? = mutableState.value.foundation,
        activityFallback: ActivitySnapshot? = mutableState.value.activity,
        activityGeneration: Long = activityRequestGeneration,
        generation: Long = requestGeneration,
    ) {
        try {
            ensureLatest(generation)
            val beforeCatalog = mutableState.value.projectCatalog
            val catalog = resolveProjectCatalog(
                credentials,
                beforeCatalog,
                foundationFallback,
            )
            ensureLatest(generation)
            if (catalog != null && catalog != beforeCatalog) {
                store.saveProjectCatalog(catalog)
                mutableState.update { state ->
                    state.copy(
                        projectCatalog = catalog,
                        selectedProjectId = state.selectedProjectId.takeIf { id ->
                            id == "all" || catalog.projectOption(id) != null
                        } ?: "all",
                    )
                }
            }
            val requestedScopeId = normalizedProjectScopeId(projectScopeId)
            val effectiveScopeId = if (requestedScopeId != "all" && catalog?.available == true) {
                requestedScopeId.takeIf { catalog.projectOption(it) != null } ?: "all"
            } else {
                requestedScopeId
            }
            val snapshot = api.fetchUsageForScope(credentials, period, trendGranularity, effectiveScopeId)
            ensureLatest(generation)
            if (snapshot.desktopId != credentials.serverFingerprint || snapshot.projectScopeId != effectiveScopeId) {
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
            ensureLatest(generation)
            val foundation = resolveFoundation(
                credentials = credentials,
                period = period,
                trendGranularity = trendGranularity,
                projectScopeId = effectiveScopeId,
                snapshot = snapshot,
                fallback = current.foundation,
                requestedTrendGranularity = trendGranularity,
            )
            ensureLatest(generation)
            val activityResolution = resolveActivity(
                credentials = credentials,
                period = period,
                projectScopeId = effectiveScopeId,
                fallback = activityFallback,
                activityGeneration = activityGeneration,
                capabilities = capabilities,
            )
            ensureLatest(generation)
            // Usage and the period-scoped Foundation are committed together;
            // the catalog was already persisted independently above so a
            // period-domain failure cannot erase Project identity.
            store.saveSnapshotFoundationAndCatalog(snapshot, foundation, catalog)
            if (activityRequestGeneration == activityGeneration && activityResolution.snapshot != null) {
                store.saveActivity(activityResolution.snapshot)
            }
            ensureLatest(generation)
            mutableState.update {
                it.copy(
                    initializing = false,
                    status = MetroraConnectionState.CONNECTED,
                    selectedPeriod = period,
                    snapshot = snapshot,
                    foundation = foundation,
                    // An Activity-only filter/query may have started while the
                    // broader refresh was in flight. Do not let the older
                    // refresh overwrite that newer query with stale rows or an
                    // unavailable sentinel.
                    activity = if (activityRequestGeneration == activityGeneration) activityResolution.snapshot else it.activity,
                    activityFailure = if (activityRequestGeneration == activityGeneration) activityResolution.failure else it.activityFailure,
                    projectCatalog = catalog,
                    capabilities = capabilities,
                    selectedProjectId = snapshot.projectScopeId,
                    notice = successNotice,
                    failure = null,
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: MetroraException) {
            if (requestGeneration != generation) return
            applyFailure(error.failure, allowOfflineFallback, preservePairingSuccess)
        } catch (error: Exception) {
            if (requestGeneration != generation) return
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

    private suspend fun resolveProjectCatalog(
        credentials: PairingCredentials,
        fallback: ProjectCatalogSnapshot?,
        foundationFallback: MobileFoundationSnapshot?,
    ): ProjectCatalogSnapshot? = try {
        val candidate = api.fetchProjectCatalog(credentials)
        when {
            candidate.available && candidate.desktopId == credentials.serverFingerprint -> candidate
            else -> projectCatalogFallback(credentials, fallback, foundationFallback)
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        projectCatalogFallback(credentials, fallback, foundationFallback)
    }

    private fun projectCatalogFallback(
        credentials: PairingCredentials,
        fallback: ProjectCatalogSnapshot?,
        foundationFallback: MobileFoundationSnapshot?,
    ): ProjectCatalogSnapshot? {
        fallback?.takeIf { it.available && it.desktopId == credentials.serverFingerprint }?.let {
            return it.asLocallyCached()
        }
        foundationFallback?.takeIf {
            it.available && it.desktopId == credentials.serverFingerprint && it.projectOptions.isNotEmpty()
        }?.let { foundation ->
            return ProjectCatalogSnapshot(
                desktopId = foundation.desktopId,
                generatedAt = foundation.generatedAt,
                retrievedAtEpochMs = foundation.retrievedAtEpochMs,
                projectOptions = foundation.projectOptions,
                sourceProjects = foundation.sourceProjects,
                freshness = when (foundation.activityFreshness) {
                    CapabilityFreshness.LIVE -> CapabilityFreshness.CACHED
                    CapabilityFreshness.CACHED -> CapabilityFreshness.CACHED
                    CapabilityFreshness.UNKNOWN -> CapabilityFreshness.UNKNOWN
                },
                available = true,
            )
        }
        return null
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
            compatibleFallback != null -> compatibleFallback.asLocallyCached()
            else -> null
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: MetroraException) {
        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        if (fallback?.let {
            foundationMatches(it, credentials, requestedScopeId, snapshot, requestedTrendGranularity)
        } == true) {
            fallback.asLocallyCached()
        } else {
            null
        }
    } catch (error: Exception) {
        val requestedScopeId = normalizedProjectScopeId(projectScopeId)
        if (fallback?.let {
            foundationMatches(it, credentials, requestedScopeId, snapshot, requestedTrendGranularity)
        } == true) {
            fallback.asLocallyCached()
        } else {
            null
        }
    }

    private data class ActivityResolution(
        val snapshot: ActivitySnapshot?,
        val failure: MetroraFailure?,
    )

    private suspend fun resolveActivity(
        credentials: PairingCredentials,
        period: String,
        projectScopeId: String,
        fallback: ActivitySnapshot?,
        activityGeneration: Long,
        capabilities: CapabilityDiscovery,
    ): ActivityResolution {
        val query = ActivityQuery(period = period, projectScopeId = projectScopeId)
        val compatibleFallback = fallback?.takeIf { activityMatches(it, credentials, query) }
        val activityV1Advertised = capabilities.isAvailable("activity.sessions")
        return try {
            ActivityResolution(fetchActivitySnapshot(credentials, query, activityGeneration).also { loaded ->
                if (loaded.desktopId != credentials.serverFingerprint || !loaded.query.matchesRequest(query)) {
                    throw MetroraException(
                        MetroraFailure(
                            MetroraOperation.REFRESH,
                            MetroraFailureCategory.MALFORMED_RESPONSE,
                            MetroraFailureReason.MALFORMED_RESPONSE,
                            "Desktop returned an Activity query that does not match the request",
                        ),
                    )
                }
            }, null)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (activityV1Advertised) {
                // A current Desktop that advertised Activity V1 is not a
                // legacy peer when its bounded request fails. Retain only a
                // query-compatible cached Activity snapshot, and expose the
                // failure separately so the UI never falls back to Foundation.
                ActivityResolution(
                    snapshot = compatibleFallback?.asLocallyCached(),
                    failure = boundedActivityFailure(error),
                )
            } else {
                // An older Desktop without live Activity capability keeps the
                // accepted Foundation compatibility path.
                ActivityResolution(compatibleFallback?.asLocallyCached(), null)
            }
        }
    }

    private suspend fun fetchActivitySnapshot(
        credentials: PairingCredentials,
        query: ActivityQuery,
        activityGeneration: Long,
    ): ActivitySnapshot {
        val sessions = api.fetchActivitySessions(credentials, query, null)
        if (activityRequestGeneration != activityGeneration) return ActivitySnapshot.unavailable(credentials.serverFingerprint, query)
        val pullRequests = try {
            api.fetchActivityPullRequests(credentials, query, null)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }
        if (activityRequestGeneration != activityGeneration) return ActivitySnapshot.unavailable(credentials.serverFingerprint, query)
        val pullMeta = pullRequests?.meta ?: sessions.meta.copy(
            coverage = eu.metrora.app.data.DetailCoverage.UNAVAILABLE,
            totalCount = 0L,
            availableCount = 0L,
            hasMore = false,
            nextCursor = null,
        )
        return ActivitySnapshot(
            desktopId = sessions.meta.desktopId,
            retrievedAtEpochMs = System.currentTimeMillis(),
            query = sessions.meta.query,
            sessions = sessions.sessions,
            sessionNextCursor = sessions.meta.nextCursor,
            sessionHasMore = sessions.meta.hasMore,
            sessionTotalCount = sessions.meta.totalCount,
            sessionAvailableCount = sessions.meta.availableCount,
            sessionCoverage = sessions.meta.coverage,
            pullRequests = pullRequests?.pullRequests.orEmpty(),
            pullRequestNextCursor = pullMeta.nextCursor,
            pullRequestHasMore = pullMeta.hasMore,
            pullRequestTotalCount = pullMeta.totalCount ?: 0L,
            pullRequestAvailableCount = pullMeta.availableCount,
            pullRequestCoverage = pullMeta.coverage,
            attributedCostMicrosUsd = pullRequests?.attributedCostMicrosUsd ?: 0L,
            unattributedCostMicrosUsd = pullRequests?.unattributedCostMicrosUsd ?: 0L,
            freshness = when {
                sessions.meta.freshness == CapabilityFreshness.LIVE || pullMeta.freshness == CapabilityFreshness.LIVE -> CapabilityFreshness.LIVE
                sessions.meta.freshness == CapabilityFreshness.CACHED || pullMeta.freshness == CapabilityFreshness.CACHED -> CapabilityFreshness.CACHED
                else -> CapabilityFreshness.UNKNOWN
            },
        )
    }

    private fun mergeActivitySessions(current: ActivitySnapshot, next: ActivitySessionsPage): ActivitySnapshot {
        val seen = current.sessions.mapTo(mutableSetOf()) { it.id }
        val merged = (current.sessions + next.sessions.filter { seen.add(it.id) }).take(500)
        return current.copy(
            sessions = merged,
            sessionNextCursor = next.meta.nextCursor,
            sessionHasMore = next.meta.hasMore,
            sessionTotalCount = next.meta.totalCount,
            sessionAvailableCount = maxOf(current.sessionAvailableCount, next.meta.availableCount),
            sessionCoverage = next.meta.coverage,
            freshness = next.meta.freshness,
        )
    }

    private fun mergeActivityPullRequests(current: ActivitySnapshot, next: ActivityPullRequestsPage): ActivitySnapshot {
        val seen = current.pullRequests.mapTo(mutableSetOf()) { it.id }
        val merged = (current.pullRequests + next.pullRequests.filter { seen.add(it.id) }).take(500)
        return current.copy(
            pullRequests = merged,
            pullRequestNextCursor = next.meta.nextCursor,
            pullRequestHasMore = next.meta.hasMore,
            pullRequestTotalCount = next.meta.totalCount ?: current.pullRequestTotalCount,
            pullRequestAvailableCount = maxOf(current.pullRequestAvailableCount, next.meta.availableCount),
            pullRequestCoverage = next.meta.coverage,
            attributedCostMicrosUsd = next.attributedCostMicrosUsd,
            unattributedCostMicrosUsd = next.unattributedCostMicrosUsd,
            freshness = next.meta.freshness,
        )
    }

    private fun activityMatches(snapshot: ActivitySnapshot, credentials: PairingCredentials, query: ActivityQuery): Boolean =
        snapshot.desktopId == credentials.serverFingerprint && snapshot.query.matchesRequest(query)

    private fun activityProjectMatches(projectId: String, scopeId: String): Boolean = when (scopeId) {
        "all" -> projectId == "unassigned" || projectId.startsWith("mp_")
        "unassigned" -> projectId == "unassigned"
        else -> projectId == scopeId
    }

    private fun ensureLatest(generation: Long) {
        if (requestGeneration != generation) throw CancellationException("stale refresh request")
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
            (foundation.trendGranularity == null && requestedTrendGranularity == null &&
                snapshot.costTrendGranularity == "day" && legacyImplicitDayPeriod(snapshot.periodLabel))
    }

    /**
     * Older Desktops omitted trend metadata. Their implicit day contract is
     * safe only for short/default periods; Lifetime and All have canonical
     * period-dependent dimensions and must remain unavailable until the
     * authority communicates them explicitly.
     */
    private fun legacyImplicitDayPeriod(periodLabel: String): Boolean {
        val normalized = periodLabel.trim().lowercase()
        return !normalized.contains("lifetime") && !normalized.contains("6 month")
    }

    private fun normalizedProjectScopeId(value: String?): String = value?.trim()?.takeIf { it.isNotEmpty() } ?: "all"

    /** Recover the bounded Android preset from the canonical Desktop label. */
    private fun periodKeyFromLabel(label: String): String = when (label.trim().lowercase()) {
        "today" -> "today"
        "last 7 days", "week" -> "week"
        "last 30 days", "30 days" -> "30days"
        "this month", "month" -> "month"
        "last 6 months", "6 months", "all" -> "all"
        "lifetime" -> "lifetime"
        else -> "month"
    }

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

    /** Convert any Activity failure to the bounded, non-sensitive UI signal. */
    private fun boundedActivityFailure(error: Throwable): MetroraFailure = when (error) {
        is MetroraException -> error.failure.copy(
            operation = MetroraOperation.REFRESH,
            technicalDetail = null,
        )
        else -> MetroraFailure(
            operation = MetroraOperation.REFRESH,
            category = MetroraFailureCategory.MALFORMED_RESPONSE,
            reason = MetroraFailureReason.MALFORMED_RESPONSE,
            technicalDetail = null,
        )
    }

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
