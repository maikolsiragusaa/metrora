package eu.metrora.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.UsageSnapshot
import java.util.Locale

@Composable
internal fun OverviewState(
    state: MetroraUiState,
    onRefresh: () -> Unit,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        StatusCard(state)
        state.snapshot?.let { snapshot ->
            SnapshotCard(snapshot, state)
        } ?: EmptySnapshotCard(state.status)
        RefreshButton(state, onRefresh)
        DeviceCard(
            state = state,
            onRevoke = onRevoke,
            onForget = onForget,
        )
    }
}

@Composable
private fun StatusCard(state: MetroraUiState) {
    val status = statusCopy(state.status)
    val containerColor = when (status.tone) {
        StatusTone.POSITIVE,
        StatusTone.PROGRESS,
        -> MaterialTheme.colorScheme.primaryContainer
        StatusTone.SAVED,
        StatusTone.NEUTRAL,
        -> MaterialTheme.colorScheme.surfaceVariant
        StatusTone.WARNING -> MaterialTheme.colorScheme.tertiaryContainer
        StatusTone.ERROR -> MaterialTheme.colorScheme.errorContainer
    }
    val contentColor = when (status.tone) {
        StatusTone.POSITIVE,
        StatusTone.PROGRESS,
        -> MaterialTheme.colorScheme.onPrimaryContainer
        StatusTone.SAVED,
        StatusTone.NEUTRAL,
        -> MaterialTheme.colorScheme.onSurface
        StatusTone.WARNING -> MaterialTheme.colorScheme.onTertiaryContainer
        StatusTone.ERROR -> MaterialTheme.colorScheme.onErrorContainer
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite },
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = status.icon,
                contentDescription = androidx.compose.ui.res.stringResource(status.iconDescription),
                tint = contentColor,
                modifier = Modifier.size(27.dp),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    text = androidx.compose.ui.res.stringResource(status.title),
                    color = contentColor,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(status.body),
                    color = contentColor,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun SnapshotCard(snapshot: UsageSnapshot, state: MetroraUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.usage_overview),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = snapshot.periodLabel,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FreshnessBadge(state)
            }

            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.cost),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = formatUsd(snapshot.costMicrosUsd),
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                )
            }

            Text(
                text = androidx.compose.ui.res.stringResource(
                    R.string.desktop_data_generated,
                    formatDate(snapshot.generatedAtEpochMs),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(
                    R.string.last_checked,
                    formatDate(snapshot.retrievedAtEpochMs),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HorizontalDivider()

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    MetricTile(
                        label = androidx.compose.ui.res.stringResource(R.string.calls),
                        value = snapshot.calls.toString(),
                        modifier = Modifier.weight(1f),
                    )
                    MetricTile(
                        label = androidx.compose.ui.res.stringResource(R.string.sessions),
                        value = snapshot.sessions.toString(),
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    MetricTile(
                        label = androidx.compose.ui.res.stringResource(R.string.total_tokens),
                        value = formatCompact(snapshot.totalTokens),
                        modifier = Modifier.weight(1f),
                    )
                    MetricTile(
                        label = androidx.compose.ui.res.stringResource(R.string.cache_hit),
                        value = String.format(Locale.US, "%.1f%%", snapshot.cacheHitPercent),
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (snapshot.topModels.isNotEmpty()) {
                HorizontalDivider()
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.top_models),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    snapshot.topModels.forEach { model ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Text(
                                    text = model.name,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = androidx.compose.ui.res.pluralStringResource(
                                        R.plurals.model_calls_cost,
                                        model.calls.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
                                        model.calls,
                                        formatUsd(model.costMicrosUsd),
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FreshnessBadge(state: MetroraUiState) {
    val (label, icon, containerColor, contentColor) = when {
        state.status == MetroraConnectionState.REFRESHING -> FreshnessBadgeCopy(
            R.string.data_refreshing,
            Icons.Outlined.Refresh,
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )
        state.status == MetroraConnectionState.CONNECTED -> FreshnessBadgeCopy(
            R.string.data_fresh,
            Icons.Outlined.CheckCircle,
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )
        state.failure != null -> FreshnessBadgeCopy(
            R.string.data_saved_after_failed_refresh,
            Icons.Outlined.CloudOff,
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> FreshnessBadgeCopy(
            R.string.data_saved_on_phone,
            Icons.Outlined.Refresh,
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Surface(
        shape = RoundedCornerShape(50),
        color = containerColor,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(label),
                color = contentColor,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

private data class FreshnessBadgeCopy(
    val label: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val containerColor: androidx.compose.ui.graphics.Color,
    val contentColor: androidx.compose.ui.graphics.Color,
)

@Composable
private fun MetricTile(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 13.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun EmptySnapshotCard(status: MetroraConnectionState) {
    val body = if (status == MetroraConnectionState.PAIRED_NO_SNAPSHOT) {
        R.string.empty_snapshot_paired
    } else {
        R.string.empty_snapshot_offline
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.no_snapshot_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RefreshButton(state: MetroraUiState, onRefresh: () -> Unit) {
    val enabled = !state.busy &&
        state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED &&
        state.status != MetroraConnectionState.RECOVERY_REQUIRED
    Button(
        onClick = onRefresh,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp),
    ) {
        if (state.status == MetroraConnectionState.REFRESHING) {
            CircularProgressIndicator(
                modifier = Modifier.size(21.dp),
                strokeWidth = 2.5.dp,
            )
            Spacer(Modifier.width(10.dp))
            Text(androidx.compose.ui.res.stringResource(R.string.refreshing))
        } else {
            Icon(imageVector = Icons.Outlined.Refresh, contentDescription = null)
            Spacer(Modifier.width(10.dp))
            Text(androidx.compose.ui.res.stringResource(R.string.refresh))
        }
    }
}
