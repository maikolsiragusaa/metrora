package eu.metrora.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.BuildConfig
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivityTab
import eu.metrora.app.data.CostTrendPoint
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.ModelAccountingGap
import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.ProjectScopeOption
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.demo.MetroraDemoDatasetV1
import java.util.Locale

private enum class HomeDestination(val label: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    HOME(R.string.nav_home, Icons.Outlined.Home),
    ACTIVITY(R.string.nav_activity, Icons.Outlined.Timeline),
    ANALYZE(R.string.nav_analyze, Icons.Outlined.PieChart),
    WORKSPACE(R.string.nav_workspace, Icons.Outlined.Layers),
    SETTINGS(R.string.nav_settings, Icons.Outlined.Settings),
}

@Composable
internal fun HomeState(
    state: MetroraUiState,
    onRefresh: () -> Unit,
    onSelectPeriod: (String) -> Unit,
    onSelectTrendGranularity: (String) -> Unit,
    onSelectProject: (String) -> Unit,
    onSetActivityQuery: (ActivityQuery) -> Unit,
    onLoadMoreActivity: (ActivityTab) -> Unit,
    onOpenActivitySession: (String) -> Unit,
    onOpenActivityPullRequest: (String) -> Unit,
    onCloseActivityDetail: () -> Unit,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
    onExitDemo: () -> Unit,
    initialDestination: String? = null,
) {
    val requestedInitialDestination = initialDestinationFor(state, initialDestination)
    var destinationName by rememberSaveable(state.isDemo, initialDestination) { mutableStateOf(requestedInitialDestination) }
    val destination = HomeDestination.entries.firstOrNull { it.name == destinationName } ?: HomeDestination.HOME
    val scrollState = remember(destination) { androidx.compose.foundation.ScrollState(0) }

    Scaffold(
        modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF0A151B), MetroraPalette.background))),
        containerColor = Color.Transparent,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = {
            MetroraBottomNavigation(destination) { destinationName = it.name }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(top = 10.dp)
                .verticalScroll(scrollState)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PostConnectionHeader(state, onRefresh)
            if (state.failure != null) Feedback(state)
            if (destination == HomeDestination.HOME) {
                ScopeControls(state, onSelectProject, onSelectPeriod)
            }
            when (destination) {
                HomeDestination.HOME -> OverviewSurface(state, onRefresh, onSelectTrendGranularity) { destinationName = HomeDestination.ANALYZE.name }
                HomeDestination.ACTIVITY -> ActivitySurface(
                    state = state,
                    onRetry = onRefresh,
                    onSetQuery = onSetActivityQuery,
                    onLoadMore = onLoadMoreActivity,
                    onOpenSession = onOpenActivitySession,
                    onOpenPullRequest = onOpenActivityPullRequest,
                    onCloseDetail = onCloseActivityDetail,
                    scopeControls = { ScopeControls(state, onSelectProject, onSelectPeriod) },
                )
                HomeDestination.ANALYZE -> AnalyzeSurface(state, scopeControls = { ScopeControls(state, onSelectProject, onSelectPeriod) })
                HomeDestination.WORKSPACE -> WorkspaceSurface(state)
                HomeDestination.SETTINGS -> SettingsSurface(state, onRevoke, onForget, onExitDemo)
            }
        }
    }
}

internal fun initialDestinationFor(state: MetroraUiState, requested: String?): String {
    if (!state.isDemo) return HomeDestination.HOME.name
    return HomeDestination.entries
        .firstOrNull { it.name.equals(requested, ignoreCase = true) }
        ?.name
        ?: HomeDestination.HOME.name
}

@Composable
private fun PostConnectionHeader(state: MetroraUiState, onRefresh: () -> Unit) {
    val connected = state.status == MetroraConnectionState.CONNECTED || state.status == MetroraConnectionState.REFRESHING
    val desktopName = state.snapshot?.desktopName ?: state.credentials?.desktopName ?: androidx.compose.ui.res.stringResource(R.string.desktop_label)
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        MetroraLogo(
            compact = true,
            markSize = 44.dp,
            markBoxWidth = 36.dp,
            markOffsetX = (-8).dp,
        )
        if (state.isDemo) {
            DemoDataBadge(modifier = Modifier.weight(1f))
        } else {
            Text(desktopName, modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.End)
        }
        IconButton(
            onClick = onRefresh,
            enabled = !state.busy && state.status != MetroraConnectionState.RECOVERY_REQUIRED && state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED,
            modifier = Modifier.size(36.dp),
        ) {
            if (state.status == MetroraConnectionState.REFRESHING) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Icon(Icons.Outlined.Refresh, contentDescription = androidx.compose.ui.res.stringResource(R.string.refresh), tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(21.dp))
        }
        if (!state.isDemo) {
            MetroraStatusPill(
                label = androidx.compose.ui.res.stringResource(if (connected) R.string.connected else R.string.saved_state),
                connected = connected,
            )
        }
    }
}

@Composable
private fun ScopeControls(state: MetroraUiState, onSelectProject: (String) -> Unit, onSelectPeriod: (String) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        CompactProjectMenu(state, onSelectProject, Modifier.weight(1.15f))
        CompactPeriodMenu(state.selectedPeriod, onSelectPeriod, Modifier.weight(1f), state.isDemo)
    }
}

@Composable
private fun CompactProjectMenu(state: MetroraUiState, onSelect: (String) -> Unit, modifier: Modifier) {
    val options = state.projectCatalog?.takeIf { it.available }?.projectOptions?.takeIf { it.isNotEmpty() }
        ?: state.foundation?.projectOptions?.takeIf { it.isNotEmpty() }
    val selected = options?.firstOrNull { it.id == state.selectedProjectId }
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        MetroraCompactControl(
            label = selected?.name ?: androidx.compose.ui.res.stringResource(R.string.project_scope_label),
            icon = Icons.Outlined.Folder,
            modifier = Modifier.fillMaxWidth(),
            enabled = options != null,
            onClick = { expanded = true },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.orEmpty().forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = { expanded = false; if (option.id != state.selectedProjectId) onSelect(option.id) },
                )
            }
        }
    }
}

@Composable
private fun CompactPeriodMenu(selected: String, onSelect: (String) -> Unit, modifier: Modifier, demo: Boolean) {
    val periods = if (demo) MetroraDemoDatasetV1.supportedPeriods else listOf("today", "week", "30days", "month", "all", "lifetime")
    val current = selected.takeIf { it in periods } ?: "month"
    val currentLabel = periodLabel(current)
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        MetroraCompactControl(modifier = Modifier.fillMaxWidth(), label = currentLabel, icon = Icons.Outlined.CalendarMonth, onClick = { expanded = true })
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            periods.forEach { value ->
                DropdownMenuItem(text = { Text(periodLabel(value)) }, onClick = { expanded = false; if (value != current) onSelect(value) })
            }
        }
    }
}

@Composable
private fun periodLabel(value: String): String = androidx.compose.ui.res.stringResource(
    when (value) {
        "today" -> R.string.period_today
        "week" -> R.string.period_week
        "30days" -> R.string.period_30_days
        "all" -> R.string.period_all
        "lifetime" -> R.string.period_lifetime
        else -> R.string.period_month
    },
)

@Composable
private fun OverviewSurface(state: MetroraUiState, onRefresh: () -> Unit, onSelectTrendGranularity: (String) -> Unit, onViewAllModels: () -> Unit) {
    var metric by rememberSaveable { mutableStateOf("Cost") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.snapshot?.let { snapshot ->
            HomeMetricHero(snapshot, metric, { metric = it }, onSelectTrendGranularity)
            HomeMetricTiles(snapshot)
            TopModels(snapshot.models.ifEmpty { snapshot.topModels }, snapshot.modelCoverage, snapshot.modelAccountingGap, onViewAllModels)
            FreshnessFooter(state)
        } ?: EmptyHomeSnapshot(state.status, onRefresh)
    }
}

@Composable
private fun HomeMetricHero(snapshot: UsageSnapshot, metric: String, onMetric: (String) -> Unit, onSelectGranularity: (String) -> Unit) {
    var granularityMenuExpanded by remember { mutableStateOf(false) }
    val trendControlA11y = androidx.compose.ui.res.stringResource(R.string.cost_trend_control)
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.86f), borderColor = MetroraPalette.cyan.copy(alpha = 0.30f), radius = 14) {
        Column(modifier = Modifier.padding(horizontal = 11.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                MetroraMetricTabs(metric, listOf("Cost", "Tokens", "Calls"), onMetric, Modifier.width(154.dp))
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.TopEnd) {
                    MetroraIconBadge(
                        Icons.Outlined.Timeline,
                        modifier = Modifier
                            .clickable { granularityMenuExpanded = true }
                            .semantics { contentDescription = trendControlA11y },
                        tint = MetroraPalette.cyan,
                        filled = false,
                    )
                    DropdownMenu(expanded = granularityMenuExpanded, onDismissRequest = { granularityMenuExpanded = false }) {
                        listOf("day" to R.string.daily, "week" to R.string.weekly, "month" to R.string.monthly).forEach { (value, res) ->
                            DropdownMenuItem(
                                text = { Text(androidx.compose.ui.res.stringResource(res)) },
                                onClick = {
                                    granularityMenuExpanded = false
                                    if (value != snapshot.costTrendGranularity) onSelectGranularity(value)
                                },
                            )
                        }
                    }
                }
            }
            val headline = when (metric) {
                "Tokens" -> tokenMetricValue(snapshot.tokenCoverage, snapshot.totalTokens)
                    ?: androidx.compose.ui.res.stringResource(R.string.detail_unavailable_short)
                "Calls" -> formatCompact(snapshot.calls)
                else -> formatUsd(snapshot.costMicrosUsd)
            }
            when (metric) {
                "Tokens" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        MetricHeadline(headline, androidx.compose.ui.res.stringResource(R.string.total_tokens), if (snapshot.tokenCoverage == DetailCoverage.COMPLETE) androidx.compose.ui.res.stringResource(R.string.token_detail_complete) else androidx.compose.ui.res.stringResource(R.string.token_detail_partial), Modifier.weight(1f))
                        MetricSeriesUnavailable(metricLabel = androidx.compose.ui.res.stringResource(R.string.total_tokens), modifier = Modifier.weight(1f))
                    }
                }
                "Calls" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        MetricHeadline(headline, androidx.compose.ui.res.stringResource(R.string.calls), androidx.compose.ui.res.stringResource(R.string.calls_from_desktop), Modifier.weight(1f))
                        MetricSeriesUnavailable(metricLabel = androidx.compose.ui.res.stringResource(R.string.calls), modifier = Modifier.weight(1f))
                    }
                }
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(0.98f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(headline, style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
                            PricingEvidence(snapshot)
                        }
                        TrendLineChart(snapshot.costTrend, Modifier.weight(1.02f).height(110.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricHeadline(value: String, label: String, supporting: String, modifier: Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(value, style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(supporting, style = MaterialTheme.typography.labelMedium, color = MetroraPalette.cyan)
    }
}

@Composable
private fun PricingEvidence(snapshot: UsageSnapshot) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val coverage = snapshot.pricingCoverage
        Text(
            text = if (coverage == null) androidx.compose.ui.res.stringResource(R.string.pricing_coverage_unknown)
            else androidx.compose.ui.res.stringResource(R.string.pricing_coverage, String.format(Locale.US, "%.1f%%", coverage * 100.0)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            softWrap = false,
        )
        snapshot.estimatedCostMicrosUsd?.takeIf { it > 0L }?.let {
            Text(androidx.compose.ui.res.stringResource(R.string.estimated_cost_evidence, formatEvidenceUsd(it)), style = MaterialTheme.typography.labelMedium, color = MetroraPalette.cyan, maxLines = 1, softWrap = false)
        }
    }
}

@Composable
private fun MetricSeriesUnavailable(metricLabel: String, modifier: Modifier = Modifier) {
    MetroraPanel(modifier = modifier.fillMaxWidth().height(82.dp), color = MetroraPalette.background.copy(alpha = 0.46f), radius = 13) {
        Column(modifier = Modifier.fillMaxSize().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(androidx.compose.ui.res.stringResource(R.string.metric_series_unavailable, metricLabel.lowercase()), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun TrendLineChart(points: List<CostTrendPoint>, modifier: Modifier) {
    val primary = MetroraPalette.cyan
    Canvas(modifier) {
        if (points.isEmpty()) return@Canvas
        val max = points.maxOf { it.costMicrosUsd }.coerceAtLeast(1L).toFloat()
        val min = points.minOf { it.costMicrosUsd }.toFloat()
        val span = (max - min).coerceAtLeast(1f)
        val coordinates = points.mapIndexed { index, point ->
            val x = if (points.size == 1) size.width else index * size.width / points.lastIndex.toFloat()
            val y = size.height - ((point.costMicrosUsd - min) / span) * (size.height * 0.75f) - size.height * 0.08f
            Offset(x, y)
        }
        val path = Path()
        path.moveTo(coordinates.first().x, coordinates.first().y)
        if (coordinates.size > 1) {
            coordinates.drop(1).forEachIndexed { index, point ->
                val previous = coordinates[index]
                val midpoint = Offset((previous.x + point.x) / 2f, (previous.y + point.y) / 2f)
                path.quadraticBezierTo(previous.x, previous.y, midpoint.x, midpoint.y)
            }
            val last = coordinates.last()
            val beforeLast = coordinates[coordinates.lastIndex - 1]
            path.quadraticBezierTo(beforeLast.x, beforeLast.y, last.x, last.y)
        }
        val fill = Path().apply { addPath(path); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
        drawPath(fill, brush = Brush.verticalGradient(listOf(primary.copy(alpha = 0.28f), Color.Transparent)))
        drawPath(path, color = primary, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
        drawCircle(primary, 4.dp.toPx(), coordinates.last())
    }
}

@Composable
private fun HomeMetricTiles(snapshot: UsageSnapshot) {
    val tokenValue = tokenMetricValue(snapshot.tokenCoverage, snapshot.totalTokens) ?: androidx.compose.ui.res.stringResource(R.string.detail_unavailable_short)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        MetricTile(Icons.Outlined.Timeline, formatCompact(snapshot.calls), R.string.calls, Modifier.weight(1f))
        MetricTile(Icons.Outlined.Group, formatCompact(snapshot.sessions), R.string.sessions, Modifier.weight(1f))
        MetricTile(Icons.Outlined.Layers, tokenValue, R.string.tokens, Modifier.weight(1f))
    }
}

@Composable
private fun MetricTile(icon: androidx.compose.ui.graphics.vector.ImageVector, value: String, label: Int, modifier: Modifier) {
    MetroraPanel(modifier = modifier.heightIn(min = 86.dp), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 12) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 9.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MetroraIconBadge(icon, tint = MetroraPalette.cyan, size = 25.dp)
                Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.weight(1f))
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
        }
    }
}

@Composable
private fun TopModels(models: List<ModelUsage>, coverage: DetailCoverage, modelAccountingGap: ModelAccountingGap?, onViewAll: () -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 14) {
        Column(modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(androidx.compose.ui.res.stringResource(R.string.top_models_by_cost), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(androidx.compose.ui.res.stringResource(R.string.see_models), modifier = Modifier.clickable { onViewAll() }.padding(6.dp), color = MetroraPalette.cyan, style = MaterialTheme.typography.labelLarge)
            }
            if (coverage == DetailCoverage.PARTIAL) {
                Text(androidx.compose.ui.res.stringResource(R.string.models_partial_project_detail), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 4.dp))
            }
            val visible = models.takeIf { coverage != DetailCoverage.UNAVAILABLE }.orEmpty().take(4)
            if (visible.isEmpty() && modelAccountingGap == null) {
                Text(androidx.compose.ui.res.stringResource(if (coverage == DetailCoverage.UNAVAILABLE) R.string.models_unavailable_project_detail else R.string.models_unavailable), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))
            } else {
                visible.forEachIndexed { index, model ->
                    ModelRow(model, index, visible.count { it.name == model.name } > 1)
                    if (index != visible.lastIndex || modelAccountingGap != null) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.65f))
                }
                modelAccountingGap?.let { gap -> OtherModelsRow(gap) }
            }
        }
    }
}

@Composable
private fun ModelRow(model: ModelUsage, index: Int, showProvider: Boolean) {
    val brand = MetroraModelBranding.hasCanonicalLogo(model.brandId)
    val routeKind = MetroraModelBranding.routeSubtitleKind(model.providerId, model.brandId, showProvider)
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Surface(modifier = Modifier.size(22.dp), shape = RoundedCornerShape(6.dp), color = modelBrandBadgeSurfaceColor(model.brandId), border = androidx.compose.foundation.BorderStroke(0.5.dp, modelBrandBadgeBorderColor(model.brandId).copy(alpha = 0.8f))) {
            Image(
                painter = painterResource(MetroraModelBranding.logoResource(model.brandId)),
                contentDescription = model.brandId?.let(MetroraModelBranding::brandLabel)?.takeIf { brand }?.let { androidx.compose.ui.res.stringResource(R.string.model_brand_logo_description, it) } ?: androidx.compose.ui.res.stringResource(R.string.metrora_model_logo_description),
                modifier = Modifier.padding(3.dp),
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(model.name, style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, lineHeight = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            when (routeKind) {
                MetroraModelBranding.RouteSubtitleKind.KNOWN -> MetroraModelBranding.routeLabel(model.providerId)?.let { Text(androidx.compose.ui.res.stringResource(R.string.via_provider, it), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                MetroraModelBranding.RouteSubtitleKind.UNAVAILABLE -> Text(androidx.compose.ui.res.stringResource(R.string.provider_unavailable), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                null -> Unit
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(if (model.costMicrosUsd > 0L) formatUsd(model.costMicrosUsd) else model.estimatedCostMicrosUsd?.let { "Est. ${formatEvidenceUsd(it)}" } ?: formatUsd(0L), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            Text(formatCompact(model.calls) + " calls", style = MaterialTheme.typography.labelMedium.copy(fontSize = 9.sp, lineHeight = 12.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun OtherModelsRow(gap: ModelAccountingGap) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        MetroraIconBadge(Icons.Outlined.Layers, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.other_models), style = MaterialTheme.typography.bodyLarge)
            Text(androidx.compose.ui.res.pluralStringResource(R.plurals.other_models_accounting_detail, gap.calls.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(), gap.calls), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(formatUsd(gap.costMicrosUsd), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun FreshnessFooter(state: MetroraUiState) {
    val freshness = freshnessPresentation(state)
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp).offset(y = (-4).dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Surface(modifier = Modifier.size(8.dp), shape = RoundedCornerShape(50), color = when (freshness.kind) { FreshnessKind.FRESH, FreshnessKind.CHECKING -> MetroraPalette.success; FreshnessKind.SAVED -> MetroraPalette.textSubtle; FreshnessKind.REFRESH_FAILED -> MaterialTheme.colorScheme.error }) {}
        Spacer(Modifier.width(8.dp))
        Text(androidx.compose.ui.res.stringResource(freshness.label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun EmptyHomeSnapshot(status: MetroraConnectionState, onRefresh: () -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surfaceRaised) {
        Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.no_snapshot_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(androidx.compose.ui.res.stringResource(if (status == MetroraConnectionState.PAIRED_NO_SNAPSHOT) R.string.empty_snapshot_paired else R.string.empty_snapshot_offline), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
            androidx.compose.material3.Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) { Text(androidx.compose.ui.res.stringResource(R.string.refresh)) }
        }
    }
}

@Composable
private fun SettingsSurface(state: MetroraUiState, onRevoke: () -> Unit, onForget: () -> Unit, onExitDemo: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(androidx.compose.ui.res.stringResource(R.string.nav_settings), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Text(androidx.compose.ui.res.stringResource(if (state.isDemo) R.string.demo_settings_subtitle else R.string.settings_subtitle), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.isDemo) {
            DemoDataBadge()
            SettingsInfoCard(Icons.Outlined.Info, R.string.demo_settings_title, R.string.demo_settings_body)
            DeviceActionCard(
                icon = Icons.Outlined.LinkOff,
                title = androidx.compose.ui.res.stringResource(R.string.exit_demo_action),
                body = androidx.compose.ui.res.stringResource(R.string.exit_demo_body),
                enabled = !state.busy,
                onClick = onExitDemo,
            )
        } else {
            DeviceCard(state)
            if (state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED && state.status != MetroraConnectionState.RECOVERY_REQUIRED) {
                DeviceActionCard(
                    icon = Icons.Outlined.LinkOff,
                    title = androidx.compose.ui.res.stringResource(R.string.revoke_desktop),
                    body = androidx.compose.ui.res.stringResource(R.string.revoke_desktop_hint),
                    enabled = !state.busy,
                    onClick = onRevoke,
                )
            }
            DeviceActionCard(
                icon = Icons.Outlined.DeleteOutline,
                title = androidx.compose.ui.res.stringResource(if (state.status == MetroraConnectionState.REVOKED_OR_UNAUTHORIZED || state.status == MetroraConnectionState.RECOVERY_REQUIRED) R.string.pair_again else R.string.forget_local),
                body = androidx.compose.ui.res.stringResource(R.string.forget_local_hint),
                enabled = !state.busy,
                onClick = onForget,
            )
        }
        SettingsInfoCard(Icons.Outlined.Lock, R.string.privacy_data_title, R.string.privacy_data_body)
        SettingsInfoCard(Icons.Outlined.Info, R.string.about_title, R.string.about_body, androidx.compose.ui.res.stringResource(R.string.about_version, BuildConfig.VERSION_NAME))
    }
}

@Composable
private fun SettingsInfoCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector?,
    title: Int,
    body: Int,
    eyebrow: String? = null,
) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 12) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
            icon?.let { MetroraIconBadge(it, tint = MetroraPalette.cyan, size = 26.dp) }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                eyebrow?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MetroraPalette.cyan) }
                Text(androidx.compose.ui.res.stringResource(body), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun MetroraBottomNavigation(selected: HomeDestination, onSelect: (HomeDestination) -> Unit) {
    Surface(
        color = MetroraPalette.surface.copy(alpha = 0.96f),
        tonalElevation = 2.dp,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.border.copy(alpha = 0.72f)),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 2.dp)
            .navigationBarsPadding()
            .offset(y = 6.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 3.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            HomeDestination.entries.forEach { item ->
                val active = item == selected
                val color = if (active) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant
                val itemLabel = androidx.compose.ui.res.stringResource(item.label)
                Column(
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).clickable(role = Role.Tab, onClick = { onSelect(item) }).semantics { role = Role.Tab; contentDescription = itemLabel }.padding(horizontal = 1.dp, vertical = 1.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Surface(shape = RoundedCornerShape(13.dp), color = if (active) MetroraPalette.cyan.copy(alpha = 0.10f) else Color.Transparent) {
                        Icon(item.icon, contentDescription = null, tint = color, modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp).size(21.dp))
                    }
                    Text(itemLabel, color = color, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
                }
            }
        }
    }
}
