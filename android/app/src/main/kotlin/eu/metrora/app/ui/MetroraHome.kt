package eu.metrora.app.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material3.Button
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.CostTrendPoint
import eu.metrora.app.data.ModelUsage
import eu.metrora.app.data.UsageSnapshot
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class HomeDestination(
    val label: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val available: Boolean,
) {
    OVERVIEW(R.string.nav_overview, Icons.Outlined.Home, true),
    MODELS(R.string.nav_models, Icons.Outlined.Layers, true),
    SESSIONS(R.string.nav_sessions, Icons.Outlined.Group, false),
    ALERTS(R.string.nav_alerts, Icons.Outlined.NotificationsNone, false),
    SETTINGS(R.string.nav_settings, Icons.Outlined.Settings, true),
}

@Composable
internal fun HomeState(
    state: MetroraUiState,
    onRefresh: () -> Unit,
    onSelectPeriod: (String) -> Unit,
    onSelectTrendGranularity: (String) -> Unit,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
) {
    var destination by rememberSaveable { mutableStateOf(HomeDestination.OVERVIEW.name) }
    val selected = HomeDestination.valueOf(destination)
    // Each destination owns an independent scroll position. Settings no
    // longer opens halfway down after a long Overview scroll on a small phone.
    val scrollState = remember(selected) { androidx.compose.foundation.ScrollState(0) }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        bottomBar = {
            MetroraBottomNavigation(
                selected = selected,
                onSelect = { if (it.available) destination = it.name },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(padding)
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (selected) {
                HomeDestination.OVERVIEW -> OverviewSurface(
                    state = state,
                    onRefresh = onRefresh,
                    onSelectPeriod = onSelectPeriod,
                    onSelectTrendGranularity = onSelectTrendGranularity,
                    onViewAllModels = { destination = HomeDestination.MODELS.name },
                )
                HomeDestination.SETTINGS -> SettingsSurface(
                    state = state,
                    onRevoke = onRevoke,
                    onForget = onForget,
                )
                HomeDestination.MODELS -> ModelsSurface(state = state)
                else -> UnsupportedDestination(destination = selected)
            }
        }
    }
}

@Composable
private fun OverviewSurface(
    state: MetroraUiState,
    onRefresh: () -> Unit,
    onSelectPeriod: (String) -> Unit,
    onSelectTrendGranularity: (String) -> Unit,
    onViewAllModels: () -> Unit,
) {
    HomeHeader(state = state, onRefresh = onRefresh)
    Feedback(state)
    PeriodSelector(
        selected = state.selectedPeriod,
        onSelect = onSelectPeriod,
    )
    state.snapshot?.let { snapshot ->
        CostHero(snapshot)
        MetricsStrip(snapshot)
        CostOverTime(snapshot.costTrend, snapshot.costTrendGranularity, onSelectTrendGranularity)
        TopModels(snapshot.topModels, onViewAll = onViewAllModels)
        FreshnessFooter(state)
    } ?: EmptyHomeSnapshot(state.status, onRefresh)
}

@Composable
private fun HomeHeader(state: MetroraUiState, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.foundation.Image(
                painter = androidx.compose.ui.res.painterResource(R.drawable.metrora_mark),
                contentDescription = androidx.compose.ui.res.stringResource(R.string.metrora_logo_description),
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.app_name).uppercase(),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Medium,
                letterSpacing = 3.8.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        IconButton(
            onClick = onRefresh,
            enabled = !state.busy &&
                state.status != MetroraConnectionState.RECOVERY_REQUIRED &&
                state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED,
            modifier = Modifier.size(48.dp),
        ) {
            if (state.status == MetroraConnectionState.REFRESHING) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            } else {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = androidx.compose.ui.res.stringResource(R.string.refresh),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .padding(end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.ShowChart,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.desktop_label),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
            )
        }
        ConnectionPill(state)
    }
}

@Composable
private fun ConnectionPill(state: MetroraUiState) {
    val connected = state.status == MetroraConnectionState.CONNECTED ||
        state.status == MetroraConnectionState.REFRESHING
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.33f),
        modifier = Modifier
            .widthIn(min = 104.dp)
            .heightIn(min = 42.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Surface(
                modifier = Modifier.size(9.dp),
                shape = RoundedCornerShape(50),
                color = if (connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
            ) {}
            Text(
                text = if (connected) {
                    androidx.compose.ui.res.stringResource(R.string.connected)
                } else {
                    androidx.compose.ui.res.stringResource(R.string.saved_state)
                },
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

@Composable
private fun PeriodSelector(
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val periods = listOf("today", "week", "30days", "month", "all", "lifetime")
    val chosen = selected.takeIf { it in periods } ?: "month"
    val label = when (chosen) {
        "today" -> R.string.period_today
        "week" -> R.string.period_week
        "30days" -> R.string.period_30_days
        "all" -> R.string.period_all
        "lifetime" -> R.string.period_lifetime
        else -> R.string.period_month
    }
    val periodAccessibility = androidx.compose.ui.res.stringResource(R.string.period_selector_a11y)
    Box(modifier = Modifier.fillMaxWidth()) {
        MetroraPanel(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    role = Role.Button,
                    onClick = { expanded = true },
                )
                .semantics {
                    contentDescription = periodAccessibility
                },
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f),
            radius = 17,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.CalendarMonth,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(28.dp),
                )
                Spacer(Modifier.width(16.dp))
                Text(
                    text = androidx.compose.ui.res.stringResource(label),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    imageVector = Icons.Outlined.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            periods.forEach { period ->
                val resource = when (period) {
                    "today" -> R.string.period_today
                    "week" -> R.string.period_week
                    "30days" -> R.string.period_30_days
                    "month" -> R.string.period_month
                    "all" -> R.string.period_all
                    else -> R.string.period_lifetime
                }
                DropdownMenuItem(
                    text = { Text(androidx.compose.ui.res.stringResource(resource)) },
                    onClick = {
                        expanded = false
                        if (period != chosen) onSelect(period)
                    },
                )
            }
        }
    }
}

@Composable
private fun CostHero(snapshot: UsageSnapshot) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.23f),
        borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.62f),
        radius = 22,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.cost).uppercase(),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleMedium,
                letterSpacing = 0.8.sp,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = formatUsd(snapshot.costMicrosUsd),
                    style = MaterialTheme.typography.displayMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                Surface(
                    modifier = Modifier.size(52.dp),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.outline.copy(alpha = 0.7f),
                    ),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.ShowChart,
                        contentDescription = androidx.compose.ui.res.stringResource(R.string.cost_trend_a11y),
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(13.dp),
                    )
                }
            }
            PricingEvidence(snapshot)
            if (snapshot.costTrend.isNotEmpty()) {
                TrendLineChart(
                    points = snapshot.costTrend,
                    modifier = Modifier.fillMaxWidth().height(72.dp).padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun PricingEvidence(snapshot: UsageSnapshot) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        val coverage = snapshot.pricingCoverage
        Text(
            text = if (coverage == null) {
                androidx.compose.ui.res.stringResource(R.string.pricing_coverage_unknown)
            } else {
                androidx.compose.ui.res.stringResource(
                    R.string.pricing_coverage,
                    String.format(Locale.US, "%.1f%%", coverage * 100.0),
                )
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        snapshot.estimatedCostMicrosUsd?.takeIf { it > 0L }?.let { estimated ->
            Text(
                text = androidx.compose.ui.res.stringResource(
                    R.string.estimated_cost_evidence,
                    formatEvidenceUsd(estimated),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun MetricsStrip(snapshot: UsageSnapshot) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeMetric(
                icon = Icons.Outlined.ShowChart,
                value = formatCompact(snapshot.calls),
                label = R.string.calls,
                modifier = Modifier.weight(1f),
            )
            MetricDivider()
            HomeMetric(
                icon = Icons.Outlined.Group,
                value = formatCompact(snapshot.sessions),
                label = R.string.sessions,
                modifier = Modifier.weight(1f),
            )
            MetricDivider()
            HomeMetric(
                icon = Icons.Outlined.Layers,
                value = formatCompact(snapshot.totalTokens),
                label = R.string.total_tokens,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun HomeMetric(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String,
    label: Int,
    modifier: Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(22.dp),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(label),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MetricDivider() {
    androidx.compose.material3.VerticalDivider(
        modifier = Modifier.height(44.dp),
        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.6f),
    )
}

@Composable
private fun CostOverTime(
    points: List<CostTrendPoint>,
    granularity: String,
    onSelectGranularity: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val granularities = listOf("day", "week", "month")
    val selectedLabel = when (granularity) {
        "week" -> R.string.weekly
        "month" -> R.string.monthly
        else -> R.string.daily
    }
    val selectorAccessibility = androidx.compose.ui.res.stringResource(R.string.trend_selector_a11y)
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.cost_over_time),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Box {
                    Row(
                        modifier = Modifier
                            .clickable(role = Role.Button, onClick = { expanded = true })
                            .semantics { contentDescription = selectorAccessibility }
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = androidx.compose.ui.res.stringResource(selectedLabel),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Icon(
                            imageVector = Icons.Outlined.ExpandMore,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    DropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false },
                    ) {
                        granularities.forEach { option ->
                            val resource = when (option) {
                                "week" -> R.string.weekly
                                "month" -> R.string.monthly
                                else -> R.string.daily
                            }
                            DropdownMenuItem(
                                text = { Text(androidx.compose.ui.res.stringResource(resource)) },
                                onClick = {
                                    expanded = false
                                    if (option != granularity) onSelectGranularity(option)
                                },
                            )
                        }
                    }
                }
            }
            if (points.isEmpty()) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.trend_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 20.dp),
                )
            } else {
                CostBarChart(points, Modifier.fillMaxWidth().height(170.dp))
                TrendLabels(points)
            }
        }
    }
}

@Composable
private fun TrendLineChart(points: List<CostTrendPoint>, modifier: Modifier = Modifier) {
    val primary = MaterialTheme.colorScheme.primary
    val onBackground = MaterialTheme.colorScheme.onBackground
    Canvas(modifier = modifier) {
        if (points.isEmpty()) return@Canvas
        val max = points.maxOf { it.costMicrosUsd }.coerceAtLeast(1L).toFloat()
        val min = points.minOf { it.costMicrosUsd }.toFloat()
        val span = (max - min).coerceAtLeast(1f)
        val path = Path()
        points.forEachIndexed { index, point ->
            val x = if (points.size == 1) size.width else index * size.width / (points.lastIndex.toFloat())
            val y = size.height - ((point.costMicrosUsd - min) / span) * (size.height * 0.75f) - size.height * 0.1f
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val fill = Path().apply {
            addPath(path)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(
            fill,
            brush = Brush.verticalGradient(
                listOf(primary.copy(alpha = 0.32f), Color.Transparent),
            ),
        )
        drawPath(
            path,
            color = primary,
            style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round),
        )
        val end = points.last()
        val endY = size.height - ((end.costMicrosUsd - min) / span) * (size.height * 0.75f) - size.height * 0.1f
        drawCircle(onBackground, 5.dp.toPx(), Offset(size.width, endY))
        drawCircle(primary, 3.dp.toPx(), Offset(size.width, endY))
    }
}

@Composable
private fun CostBarChart(points: List<CostTrendPoint>, modifier: Modifier) {
    val primary = MaterialTheme.colorScheme.primary
    Canvas(modifier = modifier) {
        val max = points.maxOf { it.costMicrosUsd }.coerceAtLeast(1L).toFloat()
        val gap = 5.dp.toPx()
        val barWidth = ((size.width - gap * (points.size - 1)) / points.size).coerceAtLeast(2.dp.toPx())
        points.forEachIndexed { index, point ->
            val height = (point.costMicrosUsd / max) * (size.height * 0.78f)
            val left = index * (barWidth + gap)
            val top = size.height - height
            drawRoundRect(
                brush = Brush.verticalGradient(
                    listOf(primary, primary.copy(alpha = 0.54f)),
                    startY = top,
                    endY = size.height,
                ),
                topLeft = Offset(left, top),
                size = androidx.compose.ui.geometry.Size(barWidth, height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
            )
        }
    }
}

@Composable
private fun TrendLabels(points: List<CostTrendPoint>) {
    val labels = listOf(points.firstOrNull(), points.getOrNull(points.lastIndex / 2), points.lastOrNull())
        .distinctBy { it?.date }
        .filterNotNull()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        labels.forEach { point ->
            Text(
                text = formatTrendDate(point.date),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TopModels(models: List<ModelUsage>, onViewAll: () -> Unit) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.top_models),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.see_models),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .clickable(role = Role.Button, onClick = onViewAll)
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            if (models.isEmpty()) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.models_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            } else {
                models.forEachIndexed { index, model ->
                    ModelRow(model, index)
                    if (index != models.lastIndex) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f))
                    }
                }
            }
        }
    }
}

@Composable
private fun ModelsSurface(state: MetroraUiState) {
    val models = state.snapshot?.models ?: emptyList()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.nav_models),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        MetroraPanel(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
            radius = 20,
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp)) {
                Text(
                    text = state.snapshot?.periodLabel ?: androidx.compose.ui.res.stringResource(R.string.models_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                if (models.isEmpty()) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.models_unavailable),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                } else {
                    models.forEachIndexed { index, model ->
                        ModelRow(model, index, showProvider = models.count { it.name == model.name } > 1)
                        if (index != models.lastIndex) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModelRow(model: ModelUsage, index: Int, showProvider: Boolean = false) {
    val providerId = model.providerId
    val brandId = model.brandId
    val hasCanonicalBrandLogo = MetroraModelBranding.hasCanonicalLogo(brandId)
    val routeLabel = MetroraModelBranding.routeLabel(providerId)
    val routeSubtitleKind = MetroraModelBranding.routeSubtitleKind(providerId, brandId, showProvider)
    val cost = if (model.costMicrosUsd > 0L) {
        formatUsd(model.costMicrosUsd)
    } else {
        model.estimatedCostMicrosUsd?.let { "Est. " + formatEvidenceUsd(it) } ?: formatUsd(0L)
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Surface(
            modifier = Modifier.size(40.dp),
            shape = RoundedCornerShape(11.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f + (index.coerceAtMost(3) * 0.05f)),
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                MaterialTheme.colorScheme.primary.copy(alpha = 0.42f),
            ),
        ) {
            androidx.compose.foundation.Image(
                painter = androidx.compose.ui.res.painterResource(MetroraModelBranding.logoResource(brandId)),
                contentDescription = if (hasCanonicalBrandLogo) {
                    MetroraModelBranding.brandLabel(brandId)?.let {
                        androidx.compose.ui.res.stringResource(R.string.model_brand_logo_description, it)
                    }
                } else {
                    androidx.compose.ui.res.stringResource(R.string.metrora_model_logo_description)
                },
                modifier = Modifier.padding(9.dp),
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = model.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
            )
            when (routeSubtitleKind) {
                MetroraModelBranding.RouteSubtitleKind.KNOWN -> if (routeLabel != null) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.via_provider, routeLabel),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                MetroraModelBranding.RouteSubtitleKind.UNAVAILABLE -> {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.provider_unavailable),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                null -> Unit
            }
            model.estimatedCostMicrosUsd?.takeIf { it > 0L }?.let {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.estimated_pricing),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Text(
            text = cost,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun FreshnessFooter(state: MetroraUiState) {
    val freshness = freshnessPresentation(state)
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(9.dp),
            shape = RoundedCornerShape(50),
            color = when (freshness.kind) {
                FreshnessKind.FRESH -> MaterialTheme.colorScheme.primary
                FreshnessKind.CHECKING -> MaterialTheme.colorScheme.primary
                FreshnessKind.SAVED -> MaterialTheme.colorScheme.outline
                FreshnessKind.REFRESH_FAILED -> MaterialTheme.colorScheme.error
            },
        ) {}
        Spacer(Modifier.width(9.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(freshness.label),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EmptyHomeSnapshot(status: MetroraConnectionState, onRefresh: () -> Unit) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.no_snapshot_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(
                    if (status == MetroraConnectionState.PAIRED_NO_SNAPSHOT) {
                        R.string.empty_snapshot_paired
                    } else {
                        R.string.empty_snapshot_offline
                    },
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Text(androidx.compose.ui.res.stringResource(R.string.refresh))
            }
        }
    }
}

@Composable
private fun SettingsSurface(
    state: MetroraUiState,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.nav_settings),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        DeviceCard(state = state, onRevoke = onRevoke, onForget = onForget)
    }
}

@Composable
private fun UnsupportedDestination(destination: HomeDestination) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = destination.icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(38.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(destination.label),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.destination_not_available),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun MetroraBottomNavigation(
    selected: HomeDestination,
    onSelect: (HomeDestination) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.background.copy(alpha = 0.98f),
        tonalElevation = 3.dp,
        modifier = Modifier.navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeDestination.entries.forEach { destination ->
                val active = destination == selected
                val destinationLabel = androidx.compose.ui.res.stringResource(destination.label)
                val a11yLabel = if (destination.available) {
                    destinationLabel
                } else {
                    androidx.compose.ui.res.stringResource(R.string.destination_unavailable_a11y, destinationLabel)
                }
                val contentColor = when {
                    active -> MaterialTheme.colorScheme.primary
                    destination.available -> MaterialTheme.colorScheme.onSurfaceVariant
                    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.56f)
                }
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 58.dp)
                        .clickable(
                            enabled = destination.available,
                            role = Role.Tab,
                            onClick = { onSelect(destination) },
                        )
                        .semantics {
                            role = Role.Tab
                            contentDescription = a11yLabel
                        }
                        .padding(horizontal = 2.dp, vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = null,
                        tint = contentColor,
                        modifier = Modifier.size(24.dp),
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(destination.label),
                        color = contentColor,
                        style = MaterialTheme.typography.labelSmall,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

private fun formatTrendDate(raw: String): String = runCatching {
    LocalDate.parse(raw).format(DateTimeFormatter.ofPattern("MMM d", Locale.US))
}.getOrDefault(raw)
