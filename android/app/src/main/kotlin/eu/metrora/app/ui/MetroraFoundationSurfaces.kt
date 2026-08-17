package eu.metrora.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.ActivityFilterOption
import eu.metrora.app.data.ActivityPullRequest
import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.ActivitySession
import eu.metrora.app.data.ActivitySessionDetail
import eu.metrora.app.data.ActivitySnapshot
import eu.metrora.app.data.ActivityTab
import eu.metrora.app.data.AnalyzeModelUsage
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.MobileActivitySession
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.SpendTrendPoint
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.sourceProjectFilterOptions
import java.time.Duration
import java.time.Instant
import java.util.Locale

@Composable
internal fun ActivitySurface(
    state: MetroraUiState,
    onRetry: () -> Unit,
    onSetQuery: (ActivityQuery) -> Unit,
    onLoadMore: (ActivityTab) -> Unit,
    onOpenSession: (String) -> Unit,
    onOpenPullRequest: (String) -> Unit,
    onCloseDetail: () -> Unit,
    scopeControls: @Composable () -> Unit,
) {
    val foundation = state.foundation
    val activityAvailable = state.capabilities.isAvailable("activity.sessions")
    val legacyAvailable = foundation?.capabilities?.isAvailable("activity.sessions") == true
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.activityFailure?.let { ActivityFailureSurface(onRetry, state.activity != null) }
        when {
            state.activity != null -> ActivityNativeSurface(state, onSetQuery, onLoadMore, onOpenSession, onOpenPullRequest, onCloseDetail, scopeControls)
            state.activityFailure != null -> Unit
            foundation == null || (!activityAvailable && !legacyAvailable) -> UnavailableSurface(R.string.activity_unavailable_title, R.string.activity_unavailable_body)
            !activityAvailable -> ActivityList(foundation.activitySessions, foundation.activityCoverage, foundation.activityFreshness)
            else -> ActivityLoadingSurface()
        }
    }
}

@Composable
private fun ActivityFailureSurface(onRetry: () -> Unit, showingCached: Boolean) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.28f), radius = 15) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.activity_load_failed_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(androidx.compose.ui.res.stringResource(if (showingCached) R.string.activity_load_failed_cached_body else R.string.activity_load_failed_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 46.dp)) { Text(androidx.compose.ui.res.stringResource(R.string.activity_retry)) }
        }
    }
}

@Composable
private fun ActivityLoadingSurface() {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surfaceRaised, radius = 16) {
        Row(modifier = Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(9.dp))
            Text(androidx.compose.ui.res.stringResource(R.string.activity_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActivityNativeSurface(
    state: MetroraUiState,
    onSetQuery: (ActivityQuery) -> Unit,
    onLoadMore: (ActivityTab) -> Unit,
    onOpenSession: (String) -> Unit,
    onOpenPullRequest: (String) -> Unit,
    onCloseDetail: () -> Unit,
    scopeControls: @Composable () -> Unit,
) {
    val activity = state.activity ?: return
    var tabName by rememberSaveable { mutableStateOf(ActivityTab.SESSIONS.name) }
    var filtersVisible by rememberSaveable { mutableStateOf(false) }
    val tab = ActivityTab.entries.firstOrNull { it.name == tabName } ?: ActivityTab.SESSIONS
    val activeFilters = listOfNotNull(
        activity.query.provider?.let { R.string.activity_filter_provider to it },
        activity.query.model?.let { R.string.activity_filter_model to it },
        activity.query.route?.let { R.string.activity_filter_route to it },
        activity.query.source?.let { value -> R.string.activity_filter_source to (sourceProjectFilterOptions(activity.sessions).firstOrNull { it.id == value }?.label ?: value) },
    )
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        scopeControls()
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            ActivityTabButton(Modifier.weight(1f), R.string.activity_sessions_title, tab == ActivityTab.SESSIONS) { tabName = ActivityTab.SESSIONS.name }
            ActivityTabButton(Modifier.weight(1f), R.string.activity_pull_requests_title, tab == ActivityTab.PULL_REQUESTS) { tabName = ActivityTab.PULL_REQUESTS.name }
        }
        ActivitySummary(state.snapshot)
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.activity_recent_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            MetroraPanel(modifier = Modifier.clickable { filtersVisible = true }, color = if (activeFilters.isEmpty()) MetroraPalette.surface else MetroraPalette.cyan.copy(alpha = 0.12f), radius = 12) {
                Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.FilterList, contentDescription = null, tint = if (activeFilters.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MetroraPalette.cyan, modifier = Modifier.size(19.dp))
                    Text(androidx.compose.ui.res.stringResource(R.string.activity_filters), style = MaterialTheme.typography.labelLarge, color = if (activeFilters.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MetroraPalette.cyan)
                }
            }
            if (activeFilters.isNotEmpty()) {
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    activeFilters.forEach { (label, value) ->
                        ActiveFilterChip(androidx.compose.ui.res.stringResource(label), value) {
                            onSetQuery(clearActivityFilter(activity.query, label))
                        }
                    }
                }
            }
        }
        activity.selectedSession?.let { ActivitySessionDetailCard(it, activity.freshness, onCloseDetail) }
        activity.selectedPullRequest?.let { ActivityPullRequestDetailCard(it, onCloseDetail) }
        if (tab == ActivityTab.SESSIONS) ActivitySessionPage(activity, onOpenSession, onLoadMore)
        else ActivityPullRequestPage(activity, onOpenPullRequest, onLoadMore)
    }
    if (filtersVisible) {
        ModalBottomSheet(onDismissRequest = { filtersVisible = false }) {
            ActivityFilterSheet(activity, onSetQuery, { filtersVisible = false })
        }
    }
}

@Composable
private fun ActivitySummary(snapshot: UsageSnapshot?) {
    snapshot ?: return
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        ActivitySummaryCard(Icons.Outlined.AttachMoney, androidx.compose.ui.res.stringResource(R.string.cost), formatUsd(snapshot.costMicrosUsd))
        ActivitySummaryCard(Icons.Outlined.Layers, androidx.compose.ui.res.stringResource(R.string.tokens), tokenMetricValue(snapshot.tokenCoverage, snapshot.totalTokens) ?: "—")
        ActivitySummaryCard(Icons.Outlined.Group, androidx.compose.ui.res.stringResource(R.string.calls), formatCompact(snapshot.calls))
        ActivitySummaryCard(Icons.Outlined.Timeline, androidx.compose.ui.res.stringResource(R.string.sessions), formatCompact(snapshot.sessions))
    }
}

@Composable
private fun RowScope.ActivitySummaryCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
) {
    MetroraPanel(modifier = Modifier.weight(1f), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 10) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 7.dp, vertical = 7.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(icon, contentDescription = null, tint = MetroraPalette.cyan, modifier = Modifier.size(14.dp))
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
        }
    }
}

private fun clearActivityFilter(query: ActivityQuery, label: Int): ActivityQuery = when (label) {
    R.string.activity_filter_provider -> query.copy(provider = null)
    R.string.activity_filter_model -> query.copy(model = null)
    R.string.activity_filter_route -> query.copy(route = null)
    else -> query.copy(source = null)
}

@Composable
private fun ActiveFilterChip(label: String, value: String, onClear: () -> Unit) {
    Surface(shape = RoundedCornerShape(8.dp), color = MetroraPalette.surfaceMuted, border = androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.border)) {
        Row(modifier = Modifier.padding(start = 8.dp, end = 3.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("$label: $value", style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            IconButton(onClick = onClear, modifier = Modifier.size(22.dp)) { Icon(Icons.Outlined.Close, contentDescription = androidx.compose.ui.res.stringResource(R.string.close), modifier = Modifier.size(15.dp)) }
        }
    }
}

@Composable
private fun ActivityFilterSheet(activity: ActivitySnapshot, onSetQuery: (ActivityQuery) -> Unit, onDone: () -> Unit) {
    val query = activity.query
    Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 18.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(androidx.compose.ui.res.stringResource(R.string.activity_filters), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = onDone) { Text(androidx.compose.ui.res.stringResource(R.string.close)) }
        }
        Text(androidx.compose.ui.res.stringResource(R.string.activity_privacy_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        FilterPicker(R.string.activity_filter_provider, query.provider, rawActivityFilterOptions(activity.sessions.flatMap { it.sourceIds })) { onSetQuery(query.copy(provider = it)) }
        FilterPicker(R.string.activity_filter_model, query.model, rawActivityFilterOptions(activity.sessions.flatMap { it.models })) { onSetQuery(query.copy(model = it)) }
        FilterPicker(R.string.activity_filter_route, query.route, rawActivityFilterOptions(activity.sessions.flatMap { it.routeIds })) { onSetQuery(query.copy(route = it)) }
        val sourceOptions = sourceProjectFilterOptions(activity.sessions)
        FilterPicker(R.string.activity_filter_source, query.source, sourceOptions) { onSetQuery(query.copy(source = it)) }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun FilterPicker(label: Int, selected: String?, values: List<ActivityFilterOption>, onSelect: (String?) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = values.firstOrNull { it.id == selected }?.label
    Box(modifier = Modifier.fillMaxWidth()) {
        MetroraPanel(modifier = Modifier.fillMaxWidth().clickable { expanded = true }, color = if (selected == null) MetroraPalette.surface else MetroraPalette.cyan.copy(alpha = 0.10f), radius = 13) {
            Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(selectedLabel ?: selected ?: androidx.compose.ui.res.stringResource(R.string.activity_filter_any), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(Icons.Outlined.Check, contentDescription = null, tint = if (selected == null) Color.Transparent else MetroraPalette.cyan, modifier = Modifier.size(20.dp))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (selected != null) DropdownMenuItem(text = { Text(androidx.compose.ui.res.stringResource(R.string.activity_filter_clear)) }, onClick = { expanded = false; onSelect(null) })
            values.take(16).forEach { value -> DropdownMenuItem(text = { Text(value.label, maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = { expanded = false; onSelect(value.id) }) }
            if (values.isEmpty()) DropdownMenuItem(text = { Text(androidx.compose.ui.res.stringResource(R.string.activity_filter_empty)) }, onClick = { expanded = false })
        }
    }
}

private fun rawActivityFilterOptions(values: List<String>): List<ActivityFilterOption> = values.distinct().sorted().map { ActivityFilterOption(it, it) }

@Composable
private fun ActivityTabButton(modifier: Modifier, label: Int, selected: Boolean, onClick: () -> Unit) {
    Surface(modifier = modifier.clickable(onClick = onClick), shape = RoundedCornerShape(10.dp), color = if (selected) MetroraPalette.cyan.copy(alpha = 0.13f) else MetroraPalette.surface, border = androidx.compose.foundation.BorderStroke(0.5.dp, if (selected) MetroraPalette.cyan.copy(alpha = 0.8f) else MetroraPalette.border)) {
        Text(androidx.compose.ui.res.stringResource(label), modifier = Modifier.padding(vertical = 4.dp), textAlign = TextAlign.Center, color = if (selected) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun ActivitySessionPage(activity: ActivitySnapshot, onOpen: (String) -> Unit, onLoadMore: (ActivityTab) -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 13) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            ActivityCoverageHeader(activity.sessionCoverage, activity.freshness, activity.sessionTotalCount)
            if (activity.sessions.isEmpty()) {
                Text(androidx.compose.ui.res.stringResource(if (activity.sessionCoverage == DetailCoverage.UNAVAILABLE) R.string.activity_unavailable_detail else R.string.activity_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 20.dp))
            } else {
                activity.sessions.forEachIndexed { index, session ->
                    ActivitySessionCard(session, onOpen)
                    if (index != activity.sessions.lastIndex) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.64f))
                }
                if (activity.sessionHasMore) TextButton(onClick = { onLoadMore(ActivityTab.SESSIONS) }, modifier = Modifier.fillMaxWidth()) { Text(androidx.compose.ui.res.stringResource(R.string.activity_load_more)) }
            }
        }
    }
}

@Composable
private fun ActivitySessionCard(session: ActivitySession, onOpen: (String) -> Unit) {
    val model = session.models.firstOrNull() ?: session.title
    val brandId = session.brandIds.firstOrNull()
    Row(modifier = Modifier.fillMaxWidth().clickable { onOpen(session.id) }.padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
        MetroraModelBrandBadge(brandId, size = 22.dp)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(model, style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, lineHeight = 13.sp), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf(session.sourceProjectName, formatActivityTimestamp(session.startedAt)).joinToString(" · "), style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, lineHeight = 11.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(session.totalTokens?.let(::formatPreciseCount).let { it?.plus(" tokens") }, "${session.calls} calls", session.routeIds.firstOrNull()?.let { MetroraModelBranding.routeLabel(it) }).joinToString(" · "), style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 10.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(formatFoundationUsd(session.costMicrosUsd), style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, lineHeight = 13.sp), color = MetroraPalette.cyan, fontWeight = FontWeight.Medium)
            Text(formatActivityDate(session.startedAt), style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 10.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ActivityPullRequestPage(activity: ActivitySnapshot, onOpen: (String) -> Unit, onLoadMore: (ActivityTab) -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 13) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp)) {
            ActivityCoverageHeader(activity.pullRequestCoverage, activity.freshness, activity.pullRequestTotalCount)
            if (activity.pullRequestCoverage != DetailCoverage.UNAVAILABLE) Text(androidx.compose.ui.res.stringResource(R.string.activity_pr_spend_split, formatFoundationUsd(activity.attributedCostMicrosUsd), formatFoundationUsd(activity.unattributedCostMicrosUsd)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            if (activity.pullRequests.isEmpty()) {
                Text(androidx.compose.ui.res.stringResource(if (activity.pullRequestCoverage == DetailCoverage.UNAVAILABLE) R.string.activity_unavailable_detail else R.string.activity_pull_requests_empty), modifier = Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            } else {
                activity.pullRequests.forEachIndexed { index, row ->
                    ActivityPullRequestCard(row, onOpen)
                    if (index != activity.pullRequests.lastIndex) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.64f))
                }
                if (activity.pullRequestHasMore) TextButton(onClick = { onLoadMore(ActivityTab.PULL_REQUESTS) }, modifier = Modifier.fillMaxWidth()) { Text(androidx.compose.ui.res.stringResource(R.string.activity_load_more)) }
            }
        }
    }
}

@Composable
private fun ActivityPullRequestCard(row: ActivityPullRequest, onOpen: (String) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable { onOpen(row.id) }.padding(vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        MetroraIconBadge(Icons.Outlined.Folder, tint = MetroraPalette.cyan)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.reference, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf("${row.linkedSessionCount} sessions", "${row.calls} calls", row.dateFrom.take(10)).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (row.approximate || row.categoryCoverage != DetailCoverage.COMPLETE) Text(androidx.compose.ui.res.stringResource(R.string.activity_pr_approximate), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(formatFoundationUsd(row.costMicrosUsd), color = MetroraPalette.cyan, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ActivityCoverageHeader(coverage: DetailCoverage, freshness: CapabilityFreshness, @Suppress("UNUSED_PARAMETER") total: Long?) {
    DomainFreshnessNote(freshness)
    when (coverage) {
        DetailCoverage.PARTIAL -> Text(androidx.compose.ui.res.stringResource(R.string.activity_partial_detail), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        DetailCoverage.UNAVAILABLE -> Text(androidx.compose.ui.res.stringResource(R.string.activity_coverage_unavailable), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        DetailCoverage.COMPLETE -> Unit
    }
}

@Composable
private fun ActivitySessionDetailCard(detail: ActivitySessionDetail, freshness: CapabilityFreshness, onClose: () -> Unit) {
    val session = detail.session
    val durationMs = detail.durationMs ?: derivedDurationMs(session.startedAt, session.endedAt)
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.cyan.copy(alpha = 0.09f), radius = 16) {
        Column(modifier = Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DetailHeader(R.string.activity_session_detail_title, onClose)
            Text(session.models.firstOrNull() ?: session.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(listOf(session.sourceProjectName, formatActivityTimestamp(session.startedAt), formatActivityTimestamp(session.endedAt)).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.cost), formatFoundationUsd(session.costMicrosUsd))
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.calls), formatPreciseCount(session.calls))
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.turns), formatPreciseCount(session.turns))
            durationMs?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_duration), formatDuration(it)) }
            detail.inputTokens?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_input_tokens), formatPreciseCount(it)) }
            detail.outputTokens?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_output_tokens), formatPreciseCount(it)) }
            detail.reasoningTokens?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_reasoning_tokens), formatPreciseCount(it)) }
            detail.cacheReadTokens?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_cache_read), formatPreciseCount(it)) }
            detail.cacheWriteTokens?.let { ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.activity_cache_write), formatPreciseCount(it)) }
            ActivityCoverageHeader(detail.detailCoverage, freshness, null)
        }
    }
}

@Composable
private fun DetailHeader(title: Int, onClose: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose, modifier = Modifier.size(30.dp)) { Icon(Icons.Outlined.Close, contentDescription = androidx.compose.ui.res.stringResource(R.string.close), modifier = Modifier.size(19.dp)) }
    }
}

@Composable
private fun ActivityFactLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ActivityPullRequestDetailCard(row: ActivityPullRequest, onClose: () -> Unit) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.cyan.copy(alpha = 0.09f), radius = 16) {
        Column(modifier = Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DetailHeader(R.string.activity_pr_detail_title, onClose)
            Text(row.reference, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(listOf(row.dateFrom, row.dateTo).joinToString(" → "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.cost), formatFoundationUsd(row.costMicrosUsd))
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.calls), formatPreciseCount(row.calls))
            ActivityFactLine(androidx.compose.ui.res.stringResource(R.string.sessions), formatPreciseCount(row.linkedSessionCount))
            if (row.models.isNotEmpty()) Text(row.models.joinToString(", "), style = MaterialTheme.typography.bodySmall)
            if (row.categories.isNotEmpty()) Text(row.categories.joinToString(" · ") { "${it.name}: ${formatFoundationUsd(it.costMicrosUsd)}" }, style = MaterialTheme.typography.bodySmall)
            if (row.approximate || row.categoryCoverage != DetailCoverage.COMPLETE) Text(androidx.compose.ui.res.stringResource(R.string.activity_pr_approximate), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ActivityList(sessions: List<MobileActivitySession>, coverage: DetailCoverage, freshness: CapabilityFreshness) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 17) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.activity_sessions_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(androidx.compose.ui.res.stringResource(R.string.activity_privacy_note), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 3.dp))
            DomainFreshnessNote(freshness)
            if (coverage == DetailCoverage.PARTIAL) Text(androidx.compose.ui.res.stringResource(R.string.activity_partial_detail), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            if (sessions.isEmpty()) Text(androidx.compose.ui.res.stringResource(if (coverage == DetailCoverage.UNAVAILABLE) R.string.activity_unavailable_detail else R.string.activity_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 20.dp))
            else sessions.take(128).forEachIndexed { index, session ->
                LegacyActivityRow(session)
                if (index != sessions.lastIndex) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.64f))
            }
        }
    }
}

@Composable
private fun LegacyActivityRow(session: MobileActivitySession) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(session.models.firstOrNull() ?: session.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatFoundationUsd(session.costMicrosUsd), style = MaterialTheme.typography.bodyMedium, color = MetroraPalette.cyan)
        }
        Text(listOf(session.sourceProjectName, formatActivityTimestamp(session.startedAt)).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(listOf("${session.calls} calls", "${session.turns} turns", session.routeIds.firstOrNull()?.let { MetroraModelBranding.routeLabel(it) }).filterNotNull().joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun AnalyzeSurface(state: MetroraUiState, scopeControls: @Composable () -> Unit) {
    val foundation = state.foundation
    val capabilities = effectiveCapabilities(state)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SurfaceHeading(R.string.nav_analyze, Icons.Outlined.ShowChart, R.string.analyze_subtitle)
        scopeControls()
        if (foundation == null || !capabilities.isAvailable("analyze.spend") || foundation.spend == null) UnavailableSurface(R.string.spend_unavailable_title, R.string.spend_unavailable_body)
        else SpendSurface(foundation, foundation.spend, foundation.analyzeSpendFreshness)
        if (foundation == null || !capabilities.isAvailable("analyze.models")) UnavailableSurface(R.string.analyze_unavailable_title, R.string.analyze_unavailable_body)
        else AnalyzeModels(foundation)
        if (foundation != null && capabilities.isAvailable("analyze.spend") && foundation.spend != null) AnalyzeCoverageSurface(foundation, foundation.spend)
    }
}

@Composable
private fun AnalyzeModels(foundation: MobileFoundationSnapshot) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 13) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(androidx.compose.ui.res.stringResource(R.string.analyze_models_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                CoverageBadge(foundation.analyzeModelsCoverage)
            }
            DomainFreshnessNote(foundation.analyzeModelsFreshness)
            if (foundation.analyzeModelsCoverage == DetailCoverage.PARTIAL) Text(androidx.compose.ui.res.stringResource(R.string.models_partial_project_detail), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 3.dp))
            val rows = foundation.analyzeModels.takeIf { foundation.analyzeModelsCoverage != DetailCoverage.UNAVAILABLE }.orEmpty().take(32)
            if (rows.isEmpty() && foundation.analyzeModelAccountingGap == null) Text(androidx.compose.ui.res.stringResource(if (foundation.analyzeModelsCoverage == DetailCoverage.UNAVAILABLE) R.string.models_unavailable_project_detail else R.string.models_unavailable), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 18.dp))
            else {
                rows.forEachIndexed { index, model ->
                    AnalyzeModelRow(model)
                    if (index != rows.lastIndex || foundation.analyzeModelAccountingGap != null) HorizontalDivider(color = MetroraPalette.border.copy(alpha = 0.64f))
                }
                foundation.analyzeModelAccountingGap?.let { gap -> OtherModelsRow(gap) }
            }
        }
    }
}

@Composable
private fun AnalyzeModelRow(model: AnalyzeModelUsage) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        MetroraModelBrandBadge(model.brandId, size = 22.dp)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(model.name, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 11.sp, lineHeight = 14.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(model.brandId?.let(MetroraModelBranding::brandLabel), model.routeId?.let(MetroraModelBranding::routeLabel), model.sourceIds.firstOrNull()?.let(::sourceLabel)).joinToString(" · ").ifBlank { androidx.compose.ui.res.stringResource(R.string.provenance_unavailable) }, style = MaterialTheme.typography.labelMedium.copy(fontSize = 9.sp, lineHeight = 12.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(formatFoundationUsd(model.costMicrosUsd), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(formatCompact(model.calls) + " calls", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SpendSurface(foundation: MobileFoundationSnapshot, spend: eu.metrora.app.data.MobileSpendSummary, freshness: CapabilityFreshness) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 13) {
            Column(modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(androidx.compose.ui.res.stringResource(R.string.spend_trend_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    DomainFreshnessNote(freshness)
                    Text(formatFoundationUsd(spend.costMicrosUsd), style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.SemiBold)
                }
                foundation.analyzeAccountingCoverage?.cost?.let { CoverageValue(it, R.string.cost_coverage) }
            }
            if (spend.trend.isEmpty()) Text(androidx.compose.ui.res.stringResource(R.string.trend_unavailable), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 6.dp))
            else FoundationTrendChart(spend.trend, Modifier.fillMaxWidth().height(42.dp))
        }
    }
}

@Composable
private fun AnalyzeCoverageSurface(foundation: MobileFoundationSnapshot, spend: eu.metrora.app.data.MobileSpendSummary) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.78f), radius = 13) {
        Column(modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(androidx.compose.ui.res.stringResource(R.string.pricing_coverage_short), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(androidx.compose.ui.res.stringResource(R.string.analyze_coverage_independent), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                foundation.analyzeAccountingCoverage?.cost?.let { CoverageValue(it, R.string.pricing_coverage_short) }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                AnalyzeInlineMetric(androidx.compose.ui.res.stringResource(R.string.calls), formatCompact(spend.calls), Modifier.weight(1f))
                AnalyzeInlineMetric(androidx.compose.ui.res.stringResource(R.string.sessions), formatCompact(spend.sessions), Modifier.weight(1f))
                foundation.analyzeAccountingCoverage?.tokenCost?.let { CoverageValue(it, R.string.token_coverage) }
            }
            CoverageLine(androidx.compose.ui.res.stringResource(R.string.models_coverage), foundation.analyzeModelsCoverage)
        }
    }
}

@Composable
private fun AnalyzeInlineMetric(label: String, value: String, modifier: Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun CoverageValue(value: Double, label: Int) {
    Column(horizontalAlignment = Alignment.End) {
        Text(String.format(Locale.US, "%.1f%%", value * 100.0), color = MetroraPalette.cyan, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CoverageLine(label: String, coverage: DetailCoverage) {
    val text = when (coverage) { DetailCoverage.COMPLETE -> androidx.compose.ui.res.stringResource(R.string.coverage_complete); DetailCoverage.PARTIAL -> androidx.compose.ui.res.stringResource(R.string.coverage_partial); DetailCoverage.UNAVAILABLE -> androidx.compose.ui.res.stringResource(R.string.coverage_unavailable) }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(text, style = MaterialTheme.typography.labelMedium) }
}

@Composable
private fun CoverageLine(label: String, coverage: Double) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(String.format(Locale.US, "%.1f%%", coverage * 100.0), style = MaterialTheme.typography.labelMedium, color = MetroraPalette.cyan) }
}

@Composable
private fun CoverageBadge(coverage: DetailCoverage) {
    val label = when (coverage) { DetailCoverage.COMPLETE -> R.string.coverage_complete; DetailCoverage.PARTIAL -> R.string.coverage_partial; DetailCoverage.UNAVAILABLE -> R.string.coverage_unavailable }
    Surface(shape = RoundedCornerShape(8.dp), color = if (coverage == DetailCoverage.COMPLETE) MetroraPalette.cyan.copy(alpha = 0.10f) else MetroraPalette.surfaceMuted) { Text(androidx.compose.ui.res.stringResource(label), modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, color = if (coverage == DetailCoverage.COMPLETE) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant) }
}

@Composable
private fun FoundationTrendChart(points: List<SpendTrendPoint>, modifier: Modifier) {
    val primary = MetroraPalette.cyan
    Canvas(modifier) {
        val max = points.maxOf { it.costMicrosUsd }.coerceAtLeast(1L).toFloat()
        val min = points.minOf { it.costMicrosUsd }.toFloat()
        val span = (max - min).coerceAtLeast(1f)
        val path = Path()
        points.forEachIndexed { index, point ->
            val x = if (points.size == 1) size.width else index * size.width / points.lastIndex.toFloat()
            val y = size.height - ((point.costMicrosUsd - min) / span) * (size.height * 0.78f) - size.height * 0.08f
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val fill = Path().apply { addPath(path); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
        drawPath(fill, brush = Brush.verticalGradient(listOf(primary.copy(alpha = 0.25f), androidx.compose.ui.graphics.Color.Transparent)))
        drawPath(path, color = primary, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
        val last = points.last()
        val lastY = size.height - ((last.costMicrosUsd - min) / span) * (size.height * 0.78f) - size.height * 0.08f
        drawCircle(primary, 4.dp.toPx(), Offset(size.width, lastY))
    }
}

@Composable
internal fun WorkspaceSurface(state: MetroraUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SurfaceHeading(R.string.nav_workspace, Icons.Outlined.Layers, R.string.workspace_subtitle)
        MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surfaceRaised, radius = 18) {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                MetroraIconBadge(Icons.Outlined.Layers, tint = MetroraPalette.cyan, modifier = Modifier.size(48.dp))
                Text(androidx.compose.ui.res.stringResource(R.string.workspace_unavailable_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                Text(androidx.compose.ui.res.stringResource(R.string.workspace_unavailable_body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                Text(androidx.compose.ui.res.stringResource(R.string.workspace_read_only_label), style = MaterialTheme.typography.labelMedium, color = MetroraPalette.cyan)
            }
        }
    }
}

@Composable
private fun SurfaceHeading(label: Int, @Suppress("UNUSED_PARAMETER") icon: androidx.compose.ui.graphics.vector.ImageVector, subtitle: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(androidx.compose.ui.res.stringResource(label), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
        Text(androidx.compose.ui.res.stringResource(subtitle), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun UnavailableSurface(title: Int, body: Int) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surfaceRaised, radius = 17) {
        Column(modifier = Modifier.padding(horizontal = 15.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(androidx.compose.ui.res.stringResource(body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DomainFreshnessNote(freshness: CapabilityFreshness) {
    val resource = when (freshness) { CapabilityFreshness.LIVE -> null; CapabilityFreshness.CACHED -> R.string.domain_cached_detail; CapabilityFreshness.UNKNOWN -> R.string.domain_freshness_unknown }
    resource?.let { Text(androidx.compose.ui.res.stringResource(it), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}

private fun effectiveCapabilities(state: MetroraUiState): CapabilityDiscovery = state.capabilities.takeIf { it.available } ?: state.foundation?.capabilities ?: CapabilityDiscovery.unavailable()

private fun sourceLabel(raw: String): String? = when (raw.trim().lowercase(Locale.US)) {
    "codex" -> "Codex"
    "opencode" -> "OpenCode"
    "github-copilot", "copilot" -> "GitHub Copilot"
    "claude", "claude-cli" -> "Claude CLI"
    "cursor" -> "Cursor"
    "zed" -> "Zed"
    "antigravity" -> "Antigravity"
    else -> null
}

private fun formatFoundationUsd(micros: Long?): String = micros?.let { formatUsd(it) } ?: "—"

private fun formatPreciseCount(value: Long): String = when {
    value >= 1_000_000_000L -> String.format(Locale.US, "%.2f", value / 1_000_000_000.0).trimEnd('0').trimEnd('.') + "B"
    value >= 1_000_000L -> String.format(Locale.US, "%.2f", value / 1_000_000.0).trimEnd('0').trimEnd('.') + "M"
    value >= 1_000L -> String.format(Locale.US, "%.1f", value / 1_000.0).trimEnd('0').trimEnd('.') + "K"
    else -> value.toString()
}

private fun formatDuration(value: Long): String {
    val totalSeconds = value / 1_000L
    val seconds = totalSeconds % 60
    val minutes = (totalSeconds / 60) % 60
    val hours = totalSeconds / 3_600
    return when {
        hours > 0 -> "%dh %02dm".format(Locale.US, hours, minutes)
        minutes > 0 -> "%dm %02ds".format(Locale.US, minutes, seconds)
        else -> "${seconds}s"
    }
}

private fun formatActivityTimestamp(value: String): String = runCatching {
    formatDate(Instant.parse(value).toEpochMilli())
}.getOrElse {
    value.take(16).replace('T', ' ')
}

private fun formatActivityDate(value: String): String = runCatching {
    formatDate(Instant.parse(value).toEpochMilli()).substringBeforeLast(", ")
}.getOrElse {
    value.take(10)
}

private fun derivedDurationMs(startedAt: String, endedAt: String): Long? = runCatching {
    Duration.between(Instant.parse(startedAt), Instant.parse(endedAt)).toMillis().takeIf { it >= 0L }
}.getOrNull()
