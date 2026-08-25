package eu.metrora.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import eu.metrora.app.R
import eu.metrora.app.data.CapacityFreshness
import eu.metrora.app.data.CapacityProviderSnapshot
import eu.metrora.app.data.CapacitySnapshot
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
internal fun CapacityModule(
    snapshot: CapacitySnapshot?,
    onOpenDetails: () -> Unit,
) {
    val presentation = capacityPresentation(snapshot)
    if (!presentation.showModule) return

    MetroraPanel(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpenDetails)
            .semantics { role = Role.Button },
        color = MetroraPalette.surface.copy(alpha = 0.78f),
        borderColor = MetroraPalette.border,
        radius = 14,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.capacity_title),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.capacity_authority),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    capacityStateLabel(presentation.state),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (presentation.state == CapacityPresentationState.CONNECTED) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (presentation.visibleProviders.isEmpty()) {
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_unavailable),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                presentation.visibleProviders.forEach { provider ->
                    CapacityProviderRow(provider, compact = true)
                }
                if (presentation.unavailableProviderCount > 0) {
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.capacity_partial),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                androidx.compose.ui.res.stringResource(R.string.capacity_tap_details),
                style = MaterialTheme.typography.labelSmall,
                color = MetroraPalette.cyan,
            )
        }
    }
}

@Composable
internal fun CapacityDetailsDialog(
    snapshot: CapacitySnapshot,
    onDismiss: () -> Unit,
) {
    val presentation = capacityPresentation(snapshot)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(androidx.compose.ui.res.stringResource(R.string.capacity_details_title)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_status, capacityStateLabel(presentation.state)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (presentation.visibleProviders.isEmpty()) {
                    Text(
                        androidx.compose.ui.res.stringResource(R.string.capacity_unavailable),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    presentation.visibleProviders.forEach { provider -> CapacityProviderRow(provider, compact = false) }
                }
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_projection_generated, snapshot.generatedAtEpochMs.toCapacityDate()),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(androidx.compose.ui.res.stringResource(R.string.close))
            }
        },
    )
}

@Composable
private fun CapacityProviderRow(provider: CapacityProviderSnapshot, compact: Boolean) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                provider.provider.displayName,
                modifier = Modifier.weight(1f),
                style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            provider.windows.firstOrNull()?.let { window ->
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_used_remaining, formatPercent(window.usedPercent), formatPercent(window.remainingPercent)),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (provider.freshness == CapacityFreshness.STALE) MaterialTheme.colorScheme.onSurfaceVariant else MetroraPalette.cyan,
                )
            } ?: provider.credits?.let { credits ->
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_credits, formatCredits(credits.balance)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MetroraPalette.cyan,
                )
            } ?: provider.planLabel?.let { plan ->
                Text(
                    plan,
                    style = MaterialTheme.typography.labelMedium,
                    color = MetroraPalette.cyan,
                )
            }
        }
        provider.windows.firstOrNull()?.resetsAt?.let { reset ->
            Text(
                androidx.compose.ui.res.stringResource(R.string.capacity_resets, reset.toCapacityDate()),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!compact) {
            provider.observedAt?.let { observedAt ->
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_provider_observed, observedAt.toCapacityDate()),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            provider.planLabel?.let { plan ->
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_plan, plan),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            provider.source?.let { source ->
                Text(
                    androidx.compose.ui.res.stringResource(R.string.capacity_source, source.kind, source.stability),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun capacityStateLabel(state: CapacityPresentationState): String = androidx.compose.ui.res.stringResource(
    when (state) {
        CapacityPresentationState.CONNECTED -> R.string.capacity_connected
        CapacityPresentationState.PARTIAL -> R.string.capacity_partial
        CapacityPresentationState.STALE -> R.string.capacity_stale
        CapacityPresentationState.UNAVAILABLE -> R.string.capacity_unavailable
        CapacityPresentationState.HIDDEN -> R.string.capacity_unavailable
    },
)

private fun formatPercent(value: Double): String = String.format(Locale.US, "%.0f%%", value)

private fun formatCredits(value: Double): String = String.format(Locale.US, "USD %.2f", value)

private fun String.toCapacityDate(): String = runCatching {
    DateTimeFormatter.ofPattern("MMM d, HH:mm", Locale.US)
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(this))
}.getOrDefault(this)

@Composable
private fun Long.toCapacityDate(): String = if (this <= 0L) {
    androidx.compose.ui.res.stringResource(R.string.capacity_unknown_time)
} else {
    DateTimeFormatter.ofPattern("MMM d, HH:mm", Locale.US)
        .withZone(ZoneId.systemDefault())
        .format(Instant.ofEpochMilli(this))
}
