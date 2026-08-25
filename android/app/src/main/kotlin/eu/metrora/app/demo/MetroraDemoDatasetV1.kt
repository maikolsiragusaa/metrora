package eu.metrora.app.demo

import eu.metrora.app.data.ActivityPageMeta
import eu.metrora.app.data.ActivityPullRequest
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySession
import eu.metrora.app.data.ActivitySessionDetail
import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.AnalyzeAccountingCoverage
import eu.metrora.app.data.AnalyzeModelUsage
import eu.metrora.app.data.CapabilityAvailability
import eu.metrora.app.data.CapabilityDescriptor
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.MobileActivitySession
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.MobileSpendSummary
import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.ProjectScopeOption
import eu.metrora.app.data.SourceProjectContributor
import eu.metrora.app.data.SourceProjectSummary
import eu.metrora.app.data.SpendTrendPoint
import eu.metrora.app.data.UsageSnapshot
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale

/** The ephemeral inputs that define one reproducible demo session. */
data class MetroraDemoSession(
    val today: LocalDate,
    val datasetVersion: String = MetroraDemoDatasetV1.VERSION,
) {
    init {
        require(datasetVersion == MetroraDemoDatasetV1.VERSION) { "Unsupported demo dataset version." }
    }
}

data class MetroraDemoPayload(
    val snapshot: UsageSnapshot,
    val foundation: MobileFoundationSnapshot,
    val projectCatalog: ProjectCatalogSnapshot,
    val activity: ActivitySnapshot,
    val capabilities: CapabilityDiscovery,
)

/**
 * Versioned, built-in demo authority. Every returned value is an existing
 * Android domain type; this object owns no persistence and performs no I/O.
 */
object MetroraDemoDatasetV1 {
    const val VERSION = "v1"
    val supportedPeriods: List<String> = listOf("today", "week", "30days", "month")

    fun supportsPeriod(period: String): Boolean = period in supportedPeriods

    fun source(today: LocalDate): MetroraDemoDataSource = MetroraDemoDataSource(
        MetroraDemoSession(today = today),
    )
}

class MetroraDemoDataSource internal constructor(
    private val session: MetroraDemoSession,
) {
    val datasetVersion: String = session.datasetVersion
    val today: LocalDate = session.today

    private val generatedAt = today.atTime(12, 0).toInstant(ZoneOffset.UTC)
    private val generatedAtEpochMs = generatedAt.toEpochMilli()
    private val generatedAtText = generatedAt.toString()
    private val records = buildRecords()
    private val projectCatalog = buildProjectCatalog()
    private val capabilities = buildCapabilities()
    private val pullRequests = buildPullRequests()

    fun load(
        period: String = "month",
        trendGranularity: String? = "day",
        projectScopeId: String = ALL_PROJECTS,
        activityQuery: ActivityQuery? = null,
    ): MetroraDemoPayload {
        require(period in SUPPORTED_PERIODS) { "Unsupported demo period." }
        require(trendGranularity == null || trendGranularity in SUPPORTED_TREND_GRANULARITIES) {
            "Unsupported demo trend granularity."
        }
        require(projectCatalog.projectOption(projectScopeId) != null) { "Unknown demo Project scope." }

        val effectiveGranularity = trendGranularity ?: "day"
        val selected = recordsFor(period, projectScopeId)
        val snapshot = usageSnapshot(period, effectiveGranularity, projectScopeId, selected)
        val foundation = foundationSnapshot(period, effectiveGranularity, projectScopeId, selected, snapshot)
        val query = (activityQuery ?: ActivityQuery(period = period, projectScopeId = projectScopeId)).copy(
            period = period,
            projectScopeId = projectScopeId,
            effectiveFrom = null,
            effectiveTo = null,
        )
        return MetroraDemoPayload(
            snapshot = snapshot,
            foundation = foundation,
            projectCatalog = projectCatalog,
            activity = activitySnapshot(query),
            capabilities = capabilities,
        )
    }

    fun activitySessionDetail(query: ActivityQuery, id: String): ActivitySessionDetail? {
        val record = recordsFor(query.period, query.projectScopeId)
            .firstOrNull { it.id == id && recordMatchesQuery(it, query) }
            ?: return null
        return ActivitySessionDetail(
            session = record.toActivitySession(),
            durationMs = (record.turns * 18_000L).coerceAtLeast(60_000L),
            inputTokens = record.inputTokens,
            outputTokens = record.outputTokens,
            reasoningTokens = null,
            cacheReadTokens = record.cacheReadTokens,
            cacheWriteTokens = record.cacheWriteTokens,
            cacheReusePercent = record.cacheReadTokens.toDouble() * 100.0 /
                (record.inputTokens + record.cacheReadTokens).coerceAtLeast(1L),
            reasoningSemantics = "unavailable",
            detailCoverage = DetailCoverage.COMPLETE,
        )
    }

    private fun usageSnapshot(
        period: String,
        trendGranularity: String,
        projectScopeId: String,
        selected: List<DemoRecord>,
    ): UsageSnapshot {
        val models = aggregateModels(selected)
        val cost = selected.sumOf { it.costMicrosUsd }
        val input = selected.sumOf { it.inputTokens }
        val cacheRead = selected.sumOf { it.cacheReadTokens }
        return UsageSnapshot(
            desktopId = DEMO_ID,
            desktopName = "Demo data",
            projectScopeId = projectScopeId,
            generatedAtEpochMs = generatedAtEpochMs,
            periodLabel = periodLabel(period),
            costMicrosUsd = cost,
            calls = selected.sumOf { it.calls },
            sessions = selected.size.toLong(),
            inputTokens = input,
            outputTokens = selected.sumOf { it.outputTokens },
            cacheReadTokens = cacheRead,
            cacheWriteTokens = selected.sumOf { it.cacheWriteTokens },
            cacheHitPercent = cacheRead.toDouble() * 100.0 / (input + cacheRead).coerceAtLeast(1L),
            topModels = models.take(5),
            models = models,
            pricingCoverage = 0.96,
            tokenCoverage = DetailCoverage.COMPLETE,
            modelCoverage = DetailCoverage.COMPLETE,
            estimatedCostMicrosUsd = (cost / 12L).takeIf { it > 0L },
            costTrend = costTrend(selected, period, trendGranularity),
            costTrendGranularity = trendGranularity,
            costTrendPeriodLabel = periodLabel(period),
            retrievedAtEpochMs = generatedAtEpochMs,
        )
    }

    private fun foundationSnapshot(
        period: String,
        trendGranularity: String,
        projectScopeId: String,
        selected: List<DemoRecord>,
        snapshot: UsageSnapshot,
    ): MobileFoundationSnapshot {
        val modelRows = aggregateAnalyzeModels(selected)
        val spendTrend = snapshot.costTrend.map { SpendTrendPoint(it.date, it.costMicrosUsd) }
        return MobileFoundationSnapshot(
            desktopId = DEMO_ID,
            generatedAt = generatedAtText,
            retrievedAtEpochMs = generatedAtEpochMs,
            projectScopeId = projectScopeId,
            projectOptions = projectCatalog.projectOptions,
            sourceProjects = projectCatalog.sourceProjects,
            capabilities = capabilities,
            activitySessions = selected.map { it.toMobileActivitySession() },
            activityFreshness = CapabilityFreshness.LIVE,
            activityCoverage = DetailCoverage.COMPLETE,
            analyzeModels = modelRows,
            analyzeModelsFreshness = CapabilityFreshness.LIVE,
            analyzeModelsCoverage = DetailCoverage.COMPLETE,
            analyzeTokensCoverage = DetailCoverage.COMPLETE,
            analyzeHistoricalDetail = true,
            analyzeAccountingCoverage = AnalyzeAccountingCoverage(
                cost = 1.0,
                calls = 1.0,
                tokenCost = 1.0,
                tokenCalls = 1.0,
            ),
            spend = MobileSpendSummary(
                costMicrosUsd = snapshot.costMicrosUsd,
                calls = snapshot.calls,
                sessions = snapshot.sessions,
                trend = spendTrend,
            ),
            analyzeSpendFreshness = CapabilityFreshness.LIVE,
            workspaceAvailable = false,
            periodLabel = snapshot.periodLabel,
            trendGranularity = trendGranularity,
        )
    }

    private fun activitySnapshot(query: ActivityQuery): ActivitySnapshot {
        val boundedQuery = query.copy(
            effectiveFrom = periodStart(query.period).toString(),
            effectiveTo = today.toString(),
        )
        val filteredRecords = recordsFor(query.period, query.projectScopeId)
            .filter { recordMatchesQuery(it, query) }
            .sortedWith(compareBy<DemoRecord> { it.offset }.thenBy { it.id })
        val sessionRows = filteredRecords.take(query.limit).map { it.toActivitySession() }
        val filteredPullRequests = pullRequests
            .filter { pullRequestMatchesQuery(it, query) }
            .take(query.limit)
            .map { it.toActivityPullRequest(query.period) }
        val sessionsMeta = ActivityPageMeta(
            desktopId = DEMO_ID,
            generatedAt = generatedAtText,
            query = boundedQuery,
            freshness = CapabilityFreshness.LIVE,
            coverage = DetailCoverage.COMPLETE,
            totalCount = filteredRecords.size.toLong(),
            availableCount = filteredRecords.size.toLong(),
            hasMore = false,
            nextCursor = null,
        )
        return ActivitySnapshot(
            desktopId = DEMO_ID,
            retrievedAtEpochMs = generatedAtEpochMs,
            query = boundedQuery,
            sessions = sessionRows,
            sessionNextCursor = null,
            sessionHasMore = false,
            sessionTotalCount = filteredRecords.size.toLong(),
            sessionAvailableCount = filteredRecords.size.toLong(),
            sessionCoverage = DetailCoverage.COMPLETE,
            pullRequests = filteredPullRequests,
            pullRequestNextCursor = null,
            pullRequestHasMore = false,
            pullRequestTotalCount = filteredPullRequests.size.toLong(),
            pullRequestAvailableCount = filteredPullRequests.size.toLong(),
            pullRequestCoverage = DetailCoverage.COMPLETE,
            attributedCostMicrosUsd = filteredPullRequests.sumOf { it.costMicrosUsd },
            unattributedCostMicrosUsd = 0L,
            freshness = CapabilityFreshness.LIVE,
        )
    }

    private fun recordsFor(period: String, projectScopeId: String): List<DemoRecord> = records.filter { record ->
        record.offset < periodDays(period) && (projectScopeId == ALL_PROJECTS || record.projectId == projectScopeId)
    }

    private fun periodDays(period: String): Int = when (period) {
        "today" -> 1
        "week" -> 7
        "30days", "month" -> 30
        else -> error("Unsupported demo period.")
    }

    private fun periodStart(period: String): LocalDate = today.minusDays((periodDays(period) - 1).toLong())

    private fun costTrend(records: List<DemoRecord>, period: String, granularity: String): List<eu.metrora.app.data.CostTrendPoint> {
        val days = periodDays(period)
        val dates = (days - 1 downTo 0).map { today.minusDays(it.toLong()) }
        val buckets = dates.map { bucketDate(it, granularity) }.distinct().sorted()
        return buckets.map { bucket ->
            eu.metrora.app.data.CostTrendPoint(
                date = bucket.toString(),
                costMicrosUsd = records.filter { bucketDate(recordDate(it), granularity) == bucket }.sumOf { it.costMicrosUsd },
            )
        }
    }

    private fun bucketDate(date: LocalDate, granularity: String): LocalDate = when (granularity) {
        "week" -> date.minusDays((date.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
        "month" -> date.withDayOfMonth(1)
        else -> date
    }

    private fun recordDate(record: DemoRecord): LocalDate = today.minusDays(record.offset.toLong())

    private fun aggregateModels(rows: List<DemoRecord>): List<ModelUsage> = rows
        .groupBy { ModelKey(it.model, it.route, it.brand) }
        .map { (key, values) ->
            val cost = values.sumOf { it.costMicrosUsd }
            ModelUsage(
                name = key.name,
                calls = values.sumOf { it.calls },
                costMicrosUsd = cost,
                estimatedCostMicrosUsd = (cost / 12L).takeIf { it > 0L },
                providerId = key.route,
                brandId = key.brand,
            )
        }
        .sortedWith(compareByDescending<ModelUsage> { it.costMicrosUsd }.thenBy { it.name })

    private fun aggregateAnalyzeModels(rows: List<DemoRecord>): List<AnalyzeModelUsage> = rows
        .groupBy { ModelKey(it.model, it.route, it.brand) }
        .map { (key, values) ->
            AnalyzeModelUsage(
                name = key.name,
                routeId = key.route,
                sourceIds = values.flatMap { it.sourceIds }.distinct().take(8),
                brandId = key.brand,
                calls = values.sumOf { it.calls },
                costMicrosUsd = values.sumOf { it.costMicrosUsd },
                inputTokens = values.sumOf { it.inputTokens },
                outputTokens = values.sumOf { it.outputTokens },
                cacheReadTokens = values.sumOf { it.cacheReadTokens },
                cacheWriteTokens = values.sumOf { it.cacheWriteTokens },
            )
        }
        .sortedWith(compareByDescending<AnalyzeModelUsage> { it.costMicrosUsd }.thenBy { it.name })

    private fun recordMatchesQuery(record: DemoRecord, query: ActivityQuery): Boolean =
        (query.provider == null || query.provider in record.sourceIds) &&
            (query.route == null || query.route == record.route) &&
            (query.model == null || query.model == record.model) &&
            (query.source == null || query.source == record.sourceProjectId)

    private fun pullRequestMatchesQuery(request: DemoPullRequest, query: ActivityQuery): Boolean =
        if (query.projectScopeId != ALL_PROJECTS && query.projectScopeId != request.projectId) {
            false
        } else {
            val rows = records.filter {
                it.projectId == request.projectId &&
                    it.offset in request.offsets &&
                    it.offset < periodDays(query.period)
            }
            rows.isNotEmpty() &&
                (query.provider == null || rows.any { query.provider in it.sourceIds }) &&
                (query.route == null || rows.any { query.route == it.route }) &&
                (query.model == null || rows.any { query.model == it.model }) &&
                (query.source == null || rows.any { query.source == it.sourceProjectId })
        }

    private fun buildProjectCatalog(): ProjectCatalogSnapshot = ProjectCatalogSnapshot(
        desktopId = DEMO_ID,
        generatedAt = generatedAtText,
        retrievedAtEpochMs = generatedAtEpochMs,
        projectOptions = listOf(
            ProjectScopeOption(ALL_PROJECTS, "All projects", "grid", "cyan", 4),
            ProjectScopeOption("unassigned", "Unassigned", "stack", "violet", 1),
            ProjectScopeOption("mp_atlas", "Atlas", "spark", "cyan", 1),
            ProjectScopeOption("mp_nova", "Nova", "orbit", "blue", 1),
            ProjectScopeOption("mp_beacon", "Beacon", "signal", "green", 1),
        ),
        sourceProjects = listOf(
            SourceProjectSummary(
                id = SOURCE_ATLAS,
                name = "Atlas Console",
                contributors = listOf(SourceProjectContributor("codex", listOf("openai"))),
                assignedProjectId = "mp_atlas",
            ),
            SourceProjectSummary(
                id = SOURCE_NOVA,
                name = "Nova Studio",
                contributors = listOf(SourceProjectContributor("claude-cli", listOf("anthropic"))),
                assignedProjectId = "mp_nova",
            ),
            SourceProjectSummary(
                id = SOURCE_BEACON,
                name = "Beacon Lab",
                contributors = listOf(SourceProjectContributor("cursor", listOf("google"))),
                assignedProjectId = "mp_beacon",
            ),
            SourceProjectSummary(
                id = SOURCE_UNASSIGNED,
                name = "Scratch Pad",
                contributors = listOf(SourceProjectContributor("studio-bot", listOf("zai"))),
                assignedProjectId = null,
            ),
        ),
        freshness = CapabilityFreshness.LIVE,
        available = true,
    )

    private fun buildCapabilities(): CapabilityDiscovery = CapabilityDiscovery(
        generatedAt = generatedAtText,
        capabilities = listOf(
            capability("activity.sessions"),
            capability("analyze.models"),
            capability("analyze.spend"),
        ),
        available = true,
    )

    private fun capability(id: String): CapabilityDescriptor = CapabilityDescriptor(
        id = id,
        versions = listOf(1),
        availability = CapabilityAvailability.AVAILABLE,
        freshness = CapabilityFreshness.LIVE,
        periodScoped = true,
        projectScoped = true,
        workspaceScoped = false,
    )

    private fun buildRecords(): List<DemoRecord> = (0 until 30).map { offset ->
        val seed = SEEDS[offset % SEEDS.size]
        val date = today.minusDays(offset.toLong())
        val cost = 108_000L + ((offset * 31L) % 8L) * 24_000L + seed.costOffsetMicrosUsd
        val calls = 8L + (offset % 5)
        val turns = calls * 2L + (offset % 3)
        val inputTokens = 18_000L + offset * 420L + seed.tokenOffset
        val outputTokens = 5_500L + offset * 180L + seed.tokenOffset / 3L
        DemoRecord(
            id = "demo_session_${offset.toString().padStart(2, '0')}",
            offset = offset,
            projectId = seed.projectId,
            sourceProjectId = seed.sourceProjectId,
            sourceProjectName = seed.sourceProjectName,
            sourceIds = seed.sourceIds,
            route = seed.route,
            model = seed.model,
            brand = seed.brand,
            costMicrosUsd = cost,
            calls = calls,
            turns = turns,
            inputTokens = inputTokens,
            outputTokens = outputTokens,
            cacheReadTokens = inputTokens * 2L,
            cacheWriteTokens = inputTokens / 10L,
            startedAt = "${date}T${String.format(Locale.US, "%02d", 9 + offset % 8)}:00:00Z",
            endedAt = "${date}T${String.format(Locale.US, "%02d", 9 + offset % 8)}:32:00Z",
        )
    }

    private fun buildPullRequests(): List<DemoPullRequest> {
        fun request(id: String, reference: String, projectId: String, offsets: IntRange): DemoPullRequest {
            val rows = records.filter { it.projectId == projectId && it.offset in offsets }
            return DemoPullRequest(
                id = id,
                reference = reference,
                projectId = projectId,
                offsets = offsets,
                dateFrom = rows.minOfOrNull { it.startedAt } ?: "${today}T09:00:00Z",
                dateTo = rows.maxOfOrNull { it.endedAt } ?: "${today}T09:32:00Z",
            )
        }
        return listOf(
            request("demo_pr_atlas_17", "Atlas review #17", "mp_atlas", 0..12),
            request("demo_pr_nova_08", "Nova review #08", "mp_nova", 4..20),
            request("demo_pr_beacon_03", "Beacon review #03", "mp_beacon", 9..28),
        )
    }

    private fun DemoRecord.toActivitySession(): ActivitySession = ActivitySession(
        id = id,
        projectId = projectId,
        sourceProjectId = sourceProjectId,
        sourceProjectName = sourceProjectName,
        title = "Session · ${recordDate(this)}",
        sourceIds = sourceIds,
        routeIds = listOf(route),
        brandIds = listOf(brand),
        models = listOf(model),
        costMicrosUsd = costMicrosUsd,
        estimatedCostMicrosUsd = costMicrosUsd / 12L,
        calls = calls,
        turns = turns,
        totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        tokenCoverage = DetailCoverage.COMPLETE,
        pricingCoverage = DetailCoverage.COMPLETE,
        startedAt = startedAt,
        endedAt = endedAt,
    )

    private fun DemoRecord.toMobileActivitySession(): MobileActivitySession = MobileActivitySession(
        id = id,
        projectId = projectId,
        sourceProjectId = sourceProjectId,
        sourceProjectName = sourceProjectName,
        title = "Session · ${recordDate(this)}",
        sourceIds = sourceIds,
        routeIds = listOf(route),
        brandIds = listOf(brand),
        models = listOf(model),
        costMicrosUsd = costMicrosUsd,
        calls = calls,
        turns = turns,
        startedAt = startedAt,
        endedAt = endedAt,
    )

    private fun DemoPullRequest.toActivityPullRequest(period: String): ActivityPullRequest {
        val rows = records.filter {
            it.projectId == projectId &&
                it.offset in offsets &&
                it.offset < periodDays(period)
        }
        val cost = rows.sumOf { it.costMicrosUsd }
        return ActivityPullRequest(
            id = id,
            reference = reference,
            url = null,
            dateFrom = rows.minOfOrNull { it.startedAt } ?: dateFrom,
            dateTo = rows.maxOfOrNull { it.endedAt } ?: dateTo,
            costMicrosUsd = cost,
            calls = rows.sumOf { it.calls },
            linkedSessionCount = rows.size.toLong(),
            models = rows.map { it.model }.distinct(),
            approximate = false,
            categoryCoverage = DetailCoverage.COMPLETE,
            categories = listOf(
                eu.metrora.app.data.ActivityCategory("Review", cost * 6L / 10L),
                eu.metrora.app.data.ActivityCategory("Changes", cost - cost * 6L / 10L),
            ),
        )
    }

    private data class DemoRecord(
        val id: String,
        val offset: Int,
        val projectId: String,
        val sourceProjectId: String,
        val sourceProjectName: String,
        val sourceIds: List<String>,
        val route: String,
        val model: String,
        val brand: String,
        val costMicrosUsd: Long,
        val calls: Long,
        val turns: Long,
        val inputTokens: Long,
        val outputTokens: Long,
        val cacheReadTokens: Long,
        val cacheWriteTokens: Long,
        val startedAt: String,
        val endedAt: String,
    )

    private data class DemoPullRequest(
        val id: String,
        val reference: String,
        val projectId: String,
        val offsets: IntRange,
        val dateFrom: String,
        val dateTo: String,
    )

    private data class ModelKey(val name: String, val route: String, val brand: String)

    private data class DemoSeed(
        val projectId: String,
        val sourceProjectId: String,
        val sourceProjectName: String,
        val sourceIds: List<String>,
        val route: String,
        val model: String,
        val brand: String,
        val costOffsetMicrosUsd: Long,
        val tokenOffset: Long,
    )

    private companion object {
        const val DEMO_ID = "demo-dataset-v1"
        const val ALL_PROJECTS = "all"
        val SOURCE_ATLAS = "sp_${"1".repeat(64)}"
        val SOURCE_NOVA = "sp_${"2".repeat(64)}"
        val SOURCE_BEACON = "sp_${"3".repeat(64)}"
        val SOURCE_UNASSIGNED = "sp_${"4".repeat(64)}"
        val SUPPORTED_PERIODS = MetroraDemoDatasetV1.supportedPeriods.toSet()
        val SUPPORTED_TREND_GRANULARITIES = setOf("day", "week", "month")
        val SEEDS = listOf(
            DemoSeed("mp_atlas", SOURCE_ATLAS, "Atlas Console", listOf("codex"), "openai", "gpt-4.1-mini", "openai", 22_000L, 1_600L),
            DemoSeed("mp_nova", SOURCE_NOVA, "Nova Studio", listOf("claude-cli"), "anthropic", "claude-sonnet-4", "anthropic", 51_000L, 3_100L),
            DemoSeed("mp_beacon", SOURCE_BEACON, "Beacon Lab", listOf("cursor"), "google", "gemini-2.5-pro", "google", 12_000L, 2_200L),
            DemoSeed("unassigned", SOURCE_UNASSIGNED, "Scratch Pad", listOf("studio-bot"), "zai", "glm-4.5", "zai", 4_000L, 1_000L),
            DemoSeed("mp_atlas", SOURCE_ATLAS, "Atlas Console", listOf("codex"), "deepseek", "deepseek-chat", "deepseek", 16_000L, 1_400L),
            DemoSeed("mp_nova", SOURCE_NOVA, "Nova Studio", listOf("claude-cli"), "qwen", "qwen3-coder", "qwen", 29_000L, 2_700L),
        )

        fun periodLabel(period: String): String = when (period) {
            "today" -> "Today"
            "week" -> "Last 7 days"
            "30days" -> "Last 30 days"
            "all" -> "Last 6 months"
            "lifetime" -> "Lifetime"
            else -> "This month"
        }
    }
}
