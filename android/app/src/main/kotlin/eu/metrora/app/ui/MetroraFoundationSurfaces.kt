package eu.metrora.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.AnalyzeModelUsage
import eu.metrora.app.data.CapabilityFreshness
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.data.MobileActivitySession
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectScopeOption
import eu.metrora.app.data.SpendTrendPoint
import java.util.Locale

@Composable
internal fun ProjectScopePicker(
    state: MetroraUiState,
    onSelect: (String) -> Unit,
) {
    val options = state.projectCatalog?.takeIf { it.available }?.projectOptions?.takeIf { it.isNotEmpty() }
        ?: state.foundation?.projectOptions?.takeIf { it.isNotEmpty() }
    if (options == null) {
        MetroraPanel(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
            radius = 17,
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 13.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.project_scope_label),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.project_catalog_unavailable),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }
    val selected = options.firstOrNull { it.id == state.selectedProjectId } ?: options.first()
    var expanded by remember { mutableStateOf(false) }
    MetroraPanel(
        modifier = Modifier.fillMaxWidth().clickable { expanded = true },
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
        radius = 17,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProjectToken(selected, Modifier.size(36.dp))
            Spacer(Modifier.width(11.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.project_scope_label),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = selected.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                imageVector = Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        options.forEach { option ->
            DropdownMenuItem(
                leadingIcon = { ProjectToken(option, Modifier.size(30.dp)) },
                text = {
                    Column {
                        Text(option.name)
                        Text(
                            text = androidx.compose.ui.res.pluralStringResource(
                                R.plurals.project_source_count,
                                option.sourceProjectCount,
                                option.sourceProjectCount,
                            ),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onClick = {
                    expanded = false
                    if (option.id != state.selectedProjectId) onSelect(option.id)
                },
            )
        }
    }
}

@Composable
private fun ProjectToken(option: ProjectScopeOption, modifier: Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(11.dp),
        color = projectColor(option.color).copy(alpha = 0.18f),
        border = androidx.compose.foundation.BorderStroke(1.dp, projectColor(option.color).copy(alpha = 0.62f)),
    ) {
        Text(
            text = projectGlyph(option.icon),
            color = projectColor(option.color),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 5.dp),
        )
    }
}

@Composable
internal fun ActivitySurface(state: MetroraUiState) {
    val foundation = state.foundation
    val capabilities = effectiveCapabilities(state)
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SurfaceHeading(R.string.nav_activity, Icons.Outlined.Group)
        if (foundation == null || !capabilities.isAvailable("activity.sessions")) {
            UnavailableSurface(R.string.activity_unavailable_title, R.string.activity_unavailable_body)
        } else {
            ActivityList(foundation.activitySessions, foundation.activityCoverage, foundation.activityFreshness)
        }
    }
}

@Composable
private fun ActivityList(
    sessions: List<MobileActivitySession>,
    coverage: DetailCoverage,
    freshness: CapabilityFreshness,
) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.activity_sessions_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.activity_privacy_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            DomainFreshnessNote(freshness)
            if (coverage == DetailCoverage.PARTIAL) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.activity_partial_detail),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 5.dp),
                )
            }
            if (sessions.isEmpty()) {
                Text(
                    text = androidx.compose.ui.res.stringResource(
                        if (coverage == DetailCoverage.UNAVAILABLE) R.string.activity_unavailable_detail else R.string.activity_empty,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 20.dp),
                )
            } else {
                sessions.take(128).forEachIndexed { index, session ->
                    ActivityRow(session)
                    if (index != sessions.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f))
                }
            }
        }
    }
}

@Composable
private fun ActivityRow(session: MobileActivitySession) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = session.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = formatFoundationUsd(session.costMicrosUsd),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Text(
            text = listOfNotNull(
                session.startedAt.take(10).takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) },
                session.sourceProjectName,
            ).joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val facts = listOfNotNull(
            session.sourceIds.firstNotNullOfOrNull(::sourceLabel),
            session.routeIds.firstNotNullOfOrNull { MetroraModelBranding.routeLabel(it) },
            session.brandIds.firstNotNullOfOrNull { MetroraModelBranding.brandLabel(it) },
            session.models.firstOrNull()?.takeIf { it.isNotBlank() },
        )
        if (facts.isNotEmpty()) {
            Text(
                text = facts.joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun AnalyzeSurface(state: MetroraUiState) {
    val foundation = state.foundation
    val capabilities = effectiveCapabilities(state)
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SurfaceHeading(R.string.nav_analyze, Icons.Outlined.ShowChart)
        if (foundation == null || !capabilities.isAvailable("analyze.models")) {
            UnavailableSurface(R.string.analyze_unavailable_title, R.string.analyze_unavailable_body)
        } else {
            AnalyzeModels(foundation)
        }
        if (foundation == null || !capabilities.isAvailable("analyze.spend") || foundation.spend == null) {
            UnavailableSurface(R.string.spend_unavailable_title, R.string.spend_unavailable_body)
        } else {
            SpendSurface(foundation.spend, foundation.analyzeSpendFreshness)
        }
    }
}

@Composable
private fun AnalyzeModels(foundation: MobileFoundationSnapshot) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.analyze_models_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            DomainFreshnessNote(foundation.analyzeModelsFreshness)
            Spacer(Modifier.height(6.dp))
            if (foundation.analyzeModelsCoverage == DetailCoverage.PARTIAL) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.models_partial_project_detail),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            val visibleModels = foundation.analyzeModels.takeIf { foundation.analyzeModelsCoverage != DetailCoverage.UNAVAILABLE }.orEmpty()
            if (visibleModels.isEmpty() && foundation.analyzeModelAccountingGap == null) {
                Text(
                    text = androidx.compose.ui.res.stringResource(
                        if (foundation.analyzeModelsCoverage == DetailCoverage.UNAVAILABLE) {
                            R.string.models_unavailable_project_detail
                        } else {
                            R.string.models_unavailable
                        },
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 18.dp),
                )
            } else {
                if (visibleModels.isEmpty()) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(
                            if (foundation.analyzeModelsCoverage == DetailCoverage.UNAVAILABLE) {
                                R.string.models_unavailable_project_detail
                            } else {
                                R.string.models_unavailable
                            },
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                }
                visibleModels.take(32).forEachIndexed { index, model ->
                    AnalyzeModelRow(model)
                    if (index != visibleModels.lastIndex || foundation.analyzeModelAccountingGap != null) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f))
                    }
                }
                foundation.analyzeModelAccountingGap?.let { gap ->
                    OtherModelsRow(gap)
                }
            }
        }
    }
}

@Composable
private fun AnalyzeModelRow(model: AnalyzeModelUsage) {
    val knownBrand = MetroraModelBranding.hasCanonicalLogo(model.brandId)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Surface(
            modifier = Modifier.size(38.dp),
            shape = RoundedCornerShape(11.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
        ) {
            androidx.compose.foundation.Image(
                painter = androidx.compose.ui.res.painterResource(MetroraModelBranding.logoResource(model.brandId)),
                contentDescription = model.brandId?.let(MetroraModelBranding::brandLabel)?.takeIf { knownBrand }
                    ?.let { androidx.compose.ui.res.stringResource(R.string.model_brand_logo_description, it) }
                    ?: androidx.compose.ui.res.stringResource(R.string.metrora_model_logo_description),
                modifier = Modifier.padding(8.dp),
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(model.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val route = model.routeId?.let(MetroraModelBranding::routeLabel)
            val brand = model.brandId?.let(MetroraModelBranding::brandLabel)
            Text(
                text = listOfNotNull(brand, route, model.sourceIds.firstNotNullOfOrNull(::sourceLabel)).joinToString(" · ")
                    .ifBlank { androidx.compose.ui.res.stringResource(R.string.provenance_unavailable) },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(formatFoundationUsd(model.costMicrosUsd), fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SpendSurface(
    spend: eu.metrora.app.data.MobileSpendSummary,
    freshness: CapabilityFreshness,
) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f),
        radius = 20,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.spend_trend_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            DomainFreshnessNote(freshness)
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                MetricValue(androidx.compose.ui.res.stringResource(R.string.cost), formatFoundationUsd(spend.costMicrosUsd))
                MetricValue(androidx.compose.ui.res.stringResource(R.string.calls), spend.calls.toString())
                MetricValue(androidx.compose.ui.res.stringResource(R.string.sessions), spend.sessions.toString())
            }
            if (spend.trend.isEmpty()) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.trend_unavailable),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 14.dp),
                )
            } else {
                FoundationTrendChart(spend.trend, Modifier.fillMaxWidth().height(120.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(spend.trend.first().date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(spend.trend.last().date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun DomainFreshnessNote(freshness: CapabilityFreshness) {
    val resource = when (freshness) {
        CapabilityFreshness.LIVE -> null
        CapabilityFreshness.CACHED -> R.string.domain_cached_detail
        CapabilityFreshness.UNKNOWN -> R.string.domain_freshness_unknown
    }
    if (resource != null) {
        Text(
            text = androidx.compose.ui.res.stringResource(resource),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MetricValue(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun FoundationTrendChart(points: List<SpendTrendPoint>, modifier: Modifier) {
    val primary = MaterialTheme.colorScheme.primary
    Canvas(modifier) {
        val max = points.maxOf { it.costMicrosUsd }.coerceAtLeast(1L).toFloat()
        val gap = 4.dp.toPx()
        val width = ((size.width - gap * (points.size - 1)) / points.size).coerceAtLeast(2.dp.toPx())
        points.forEachIndexed { index, point ->
            val barHeight = (point.costMicrosUsd / max) * (size.height * 0.82f)
            drawRoundRect(
                brush = Brush.verticalGradient(listOf(primary, primary.copy(alpha = 0.48f))),
                topLeft = androidx.compose.ui.geometry.Offset(index * (width + gap), size.height - barHeight),
                size = androidx.compose.ui.geometry.Size(width, barHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
            )
        }
    }
}

@Composable
internal fun WorkspaceSurface(state: MetroraUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SurfaceHeading(R.string.nav_workspace, Icons.Outlined.Layers)
        // Capability discovery currently returns unavailable/no-authority. The
        // explicit empty state is intentional: no local Workspace authority or
        // placeholder data is created when Desktop cannot provide a bounded one.
        UnavailableSurface(R.string.workspace_unavailable_title, R.string.workspace_unavailable_body)
    }
}

@Composable
private fun SurfaceHeading(label: Int, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(25.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(label),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun UnavailableSurface(title: Int, body: Int) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(androidx.compose.ui.res.stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(androidx.compose.ui.res.stringResource(body), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun effectiveCapabilities(state: MetroraUiState): CapabilityDiscovery =
    state.capabilities.takeIf { it.available } ?: state.foundation?.capabilities ?: CapabilityDiscovery.unavailable()

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

private fun projectGlyph(icon: String): String = when (icon) {
    "spark" -> "✦"
    "orbit" -> "◎"
    "stack" -> "▤"
    "terminal" -> ">_"
    "branch" -> "⌘"
    else -> "▦"
}

private fun projectColor(color: String): Color = when (color) {
    "blue" -> Color(0xFF79A8FF)
    "violet" -> Color(0xFFB99CFF)
    "amber" -> Color(0xFFFFC86B)
    "green" -> Color(0xFF65D6A3)
    "coral" -> Color(0xFFFF8E86)
    else -> Color(0xFF43D9E9)
}

private fun formatFoundationUsd(micros: Long): String = String.format(Locale.US, "$%.2f", micros / 1_000_000.0)
