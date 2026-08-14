package eu.metrora.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraCoordinator
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraNotice
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.network.MetroraProtocol
import java.math.BigDecimal
import java.text.DateFormat
import java.text.NumberFormat
import java.util.Date
import java.util.Locale

private enum class ConfirmAction {
    REVOKE,
    FORGET,
}

@Composable
fun MetroraApp(coordinator: MetroraCoordinator) {
    val state by coordinator.state.collectAsState()
    var confirmation by rememberSaveable { mutableStateOf<ConfirmAction?>(null) }

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header()
            Feedback(state)
            when {
                state.initializing -> LoadingState()
                state.credentials == null && state.status == MetroraConnectionState.RECOVERY_REQUIRED ->
                    RecoveryState(state, onForget = { confirmation = ConfirmAction.FORGET })
                state.credentials == null -> PairingState(state, coordinator)
                else -> OverviewState(
                    state = state,
                    onRefresh = coordinator::refresh,
                    onRevoke = { confirmation = ConfirmAction.REVOKE },
                    onForget = { confirmation = ConfirmAction.FORGET },
                )
            }
        }
    }

    confirmation?.let { action ->
        ConfirmationDialog(
            action = action,
            recovery = state.status == MetroraConnectionState.RECOVERY_REQUIRED,
            onDismiss = { confirmation = null },
            onConfirm = {
                confirmation = null
                if (action == ConfirmAction.REVOKE) coordinator.revoke() else coordinator.forgetLocal()
            },
        )
    }
}

@Composable
private fun Header() {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = stringResource(R.string.app_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LoadingState() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun Feedback(state: MetroraUiState) {
    state.notice?.let { notice ->
        Card(
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Text(
                text = stringResource(noticeResource(notice)),
                modifier = Modifier.padding(14.dp),
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
    state.failure?.let { failure ->
        Card(
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = stringResource(failureResource(failure)),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (failure.category == MetroraFailureCategory.IDENTITY_SECURITY) {
                    Text(
                        text = stringResource(R.string.advanced_security_failure),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun PairingState(state: MetroraUiState, coordinator: MetroraCoordinator) {
    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf(MetroraProtocol.DEFAULT_PORT.toString()) }
    var advanced by rememberSaveable { mutableStateOf(false) }
    val waiting = state.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
    val pairing = state.status == MetroraConnectionState.PAIRING

    Card {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = stringResource(R.string.pair_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = stringResource(R.string.pair_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = stringResource(R.string.pair_step_address),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = host,
                onValueChange = { host = it },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
                singleLine = true,
                isError = state.failure?.reason == MetroraFailureReason.INVALID_HOST,
                label = { Text(stringResource(R.string.desktop_address)) },
                supportingText = { Text(stringResource(R.string.desktop_address_hint)) },
            )
            OutlinedTextField(
                value = port,
                onValueChange = { value -> port = value.filter(Char::isDigit).take(5) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
                singleLine = true,
                isError = state.failure?.reason == MetroraFailureReason.INVALID_PORT,
                label = { Text(stringResource(R.string.port)) },
                supportingText = { Text(stringResource(R.string.port_hint)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            if (pairing) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.pairing_discovering), style = MaterialTheme.typography.bodyMedium)
                }
            } else if (!waiting) {
                Button(
                    onClick = { coordinator.pair(host, port) },
                    enabled = !state.busy && host.isNotBlank() && port.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.pair_action))
                }
            }
            if (waiting) {
                OutlinedButton(
                    onClick = coordinator::cancelPairing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.pairing_cancel))
                }
            }
        }
    }

    if (waiting) {
        PairingCodeCard(state, onCancel = coordinator::cancelPairing)
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.Security, contentDescription = stringResource(R.string.security_icon))
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.pairing_safety_title), fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(R.string.pairing_safety_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            TextButton(onClick = { advanced = !advanced }) {
                Icon(
                    if (advanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                )
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.pairing_advanced))
            }
            if (advanced) {
                Text(
                    stringResource(R.string.pairing_advanced_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PairingCodeCard(state: MetroraUiState, onCancel: () -> Unit) {
    val code = state.pairingCode ?: return
    val codeDescription = stringResource(R.string.confirmation_code_a11y, code)
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Outlined.Security, contentDescription = stringResource(R.string.security_icon))
            Text(
                text = stringResource(R.string.pairing_waiting_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            Text(
                text = code,
                modifier = Modifier.semantics {
                    // Keep the complete code available as one screen-reader announcement.
                    contentDescription = codeDescription
                },
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                letterSpacing = MaterialTheme.typography.headlineLarge.letterSpacing,
            )
            Text(
                text = stringResource(R.string.confirmation_code_description, code),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(R.string.pairing_waiting_body),
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            state.pairingDesktopName?.let { name ->
                Text(
                    text = stringResource(R.string.pairing_waiting_device, name),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.pairing_cancel))
            }
        }
    }
}

@Composable
private fun RecoveryState(state: MetroraUiState, onForget: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.WarningAmber, contentDescription = stringResource(R.string.recovery_icon))
            Text(stringResource(R.string.status_recovery_required), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.status_recovery_body), color = MaterialTheme.colorScheme.onErrorContainer)
            OutlinedButton(onClick = onForget, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.pair_again))
            }
        }
    }
}

@Composable
private fun OverviewState(
    state: MetroraUiState,
    onRefresh: () -> Unit,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
) {
    var details by rememberSaveable { mutableStateOf(false) }
    val credentials = state.credentials ?: return
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        StatusCard(state)
        state.snapshot?.let {
            SnapshotCard(
                snapshot = it,
                cached = state.showingCachedData,
                restored = state.status == MetroraConnectionState.RESTORED,
            )
        } ?: EmptySnapshotCard()

        Button(
            onClick = onRefresh,
            enabled = !state.busy &&
                state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED &&
                state.status != MetroraConnectionState.RECOVERY_REQUIRED,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.status == MetroraConnectionState.REFRESHING) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.refreshing))
            } else {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.refresh))
            }
        }

        TextButton(onClick = { details = !details }, modifier = Modifier.fillMaxWidth()) {
            Icon(
                if (details) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = null,
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(if (details) R.string.hide_connection_details else R.string.connection_details))
        }
        if (details) ConnectionDetails(credentials, state.failure)

        if (state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED &&
            state.status != MetroraConnectionState.RECOVERY_REQUIRED
        ) {
            OutlinedButton(
                onClick = onRevoke,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.LinkOff, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.revoke_desktop))
            }
            Text(
                stringResource(R.string.revoke_desktop_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        OutlinedButton(
            onClick = onForget,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.DeleteOutline, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(
                    if (state.status == MetroraConnectionState.REVOKED_OR_UNAUTHORIZED ||
                        state.status == MetroraConnectionState.RECOVERY_REQUIRED
                    ) R.string.pair_again else R.string.forget_local,
                ),
            )
        }
        Text(
            stringResource(R.string.forget_local_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StatusCard(state: MetroraUiState) {
    val status = statusCopy(state.status)
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (status.isError) {
                MaterialTheme.colorScheme.errorContainer
            } else if (status.isOffline) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.secondaryContainer
            },
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                status.icon,
                contentDescription = stringResource(status.iconDescription),
                tint = if (status.isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    stringResource(status.title),
                    fontWeight = FontWeight.SemiBold,
                    color = if (status.isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    stringResource(status.body),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (status.isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private data class StatusCopy(
    val title: Int,
    val body: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val iconDescription: Int,
    val isOffline: Boolean = false,
    val isError: Boolean = false,
)

@Composable
private fun SnapshotCard(snapshot: UsageSnapshot, cached: Boolean, restored: Boolean) {
    Card {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.usage_overview), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(snapshot.periodLabel, style = MaterialTheme.typography.titleMedium)
            Text(
                stringResource(R.string.desktop_data_generated, formatDate(snapshot.generatedAtEpochMs)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.last_checked, formatDate(snapshot.retrievedAtEpochMs)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (cached) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (restored) Icons.Outlined.Refresh else Icons.Outlined.CloudOff,
                        contentDescription = stringResource(
                            if (restored) R.string.desktop_check_icon else R.string.desktop_unavailable_icon,
                        ),
                    )
                    Text(
                        stringResource(if (restored) R.string.cached_data_not_checked else R.string.cached_data),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            HorizontalDivider()
            Metric(stringResource(R.string.cost), formatUsd(snapshot.costMicrosUsd))
            Metric(stringResource(R.string.total_tokens), formatCompact(snapshot.totalTokens))
            Metric(stringResource(R.string.calls), snapshot.calls.toString())
            Metric(stringResource(R.string.sessions), snapshot.sessions.toString())
            Metric(stringResource(R.string.cache_hit), String.format(Locale.US, "%.1f%%", snapshot.cacheHitPercent))
            if (snapshot.topModels.isNotEmpty()) {
                HorizontalDivider()
                Text(stringResource(R.string.top_models), fontWeight = FontWeight.SemiBold)
                snapshot.topModels.forEach { model ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(model.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            pluralStringResource(
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

@Composable
private fun EmptySnapshotCard() {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(
            text = stringResource(R.string.no_snapshot),
            modifier = Modifier.padding(18.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End)
    }
}

@Composable
private fun ConnectionDetails(
    credentials: eu.metrora.app.data.PairingCredentials,
    failure: MetroraFailure?,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.desktop_endpoint, credentials.host, credentials.port), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.desktop_identity, credentials.serverFingerprint), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.phone_identity, credentials.clientFingerprint), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.paired_on, formatDate(credentials.pairedAtEpochMs)), style = MaterialTheme.typography.bodySmall)
            failure?.technicalDetail?.let { detail ->
                Text(stringResource(R.string.technical_detail, detail), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ConfirmationDialog(
    action: ConfirmAction,
    recovery: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val revoke = action == ConfirmAction.REVOKE
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(if (revoke) Icons.Outlined.LinkOff else Icons.Outlined.DeleteOutline, contentDescription = null) },
        title = { Text(stringResource(if (revoke) R.string.confirm_revoke_title else R.string.confirm_forget_title)) },
        text = {
            Text(
                stringResource(
                    when {
                        revoke -> R.string.confirm_revoke_body
                        recovery -> R.string.confirm_forget_recovery_body
                        else -> R.string.confirm_forget_body
                    },
                ),
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.confirm_action)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel_action)) } },
    )
}

private fun statusCopy(status: MetroraConnectionState): StatusCopy = when (status) {
    MetroraConnectionState.RESTORED -> StatusCopy(
        R.string.status_saved_on_phone,
        R.string.status_saved_on_phone_body,
        Icons.Outlined.Refresh,
        R.string.desktop_check_icon,
    )
    MetroraConnectionState.PAIRED_NO_SNAPSHOT -> StatusCopy(
        R.string.status_paired_no_snapshot,
        R.string.status_paired_no_snapshot_body,
        Icons.Outlined.Refresh,
        R.string.desktop_check_icon,
    )
    MetroraConnectionState.CONNECTED -> StatusCopy(
        R.string.status_up_to_date,
        R.string.status_online_body,
        Icons.Outlined.CheckCircle,
        R.string.online_icon,
    )
    MetroraConnectionState.REFRESHING -> StatusCopy(
        R.string.status_updating,
        R.string.status_updating_body,
        Icons.Outlined.Refresh,
        R.string.online_icon,
    )
    MetroraConnectionState.OFFLINE_WITH_SNAPSHOT -> StatusCopy(
        R.string.status_desktop_unavailable,
        R.string.status_cached_body,
        Icons.Outlined.CloudOff,
        R.string.desktop_unavailable_icon,
        isOffline = true,
    )
    MetroraConnectionState.OFFLINE_NO_SNAPSHOT -> StatusCopy(
        R.string.status_no_snapshot,
        R.string.status_no_snapshot_body,
        Icons.Outlined.CloudOff,
        R.string.desktop_unavailable_icon,
        isOffline = true,
    )
    MetroraConnectionState.REVOKED_OR_UNAUTHORIZED -> StatusCopy(
        R.string.status_access_attention,
        R.string.status_access_attention_body,
        Icons.Outlined.Security,
        R.string.security_icon,
        isError = true,
    )
    MetroraConnectionState.RECOVERY_REQUIRED -> StatusCopy(
        R.string.status_recovery_required,
        R.string.status_recovery_body,
        Icons.Outlined.WarningAmber,
        R.string.recovery_icon,
        isError = true,
    )
    MetroraConnectionState.REVOKING -> StatusCopy(
        R.string.status_revoking,
        R.string.status_updating_body,
        Icons.Outlined.LinkOff,
        R.string.security_icon,
    )
    MetroraConnectionState.FORGETTING -> StatusCopy(
        R.string.status_forgetting,
        R.string.status_updating_body,
        Icons.Outlined.DeleteOutline,
        R.string.recovery_icon,
    )
    else -> StatusCopy(
        R.string.status_problem,
        R.string.status_problem_body,
        Icons.Outlined.ErrorOutline,
        R.string.recovery_icon,
        isError = true,
    )
}

private fun noticeResource(notice: MetroraNotice): Int = when (notice) {
    MetroraNotice.PAIRING_CANCELLED -> R.string.notice_pairing_cancelled
    MetroraNotice.PAIRING_COMPLETE -> R.string.notice_pairing_complete
    MetroraNotice.USAGE_REFRESHED -> R.string.notice_usage_refreshed
    MetroraNotice.PAIRED_WITHOUT_USAGE -> R.string.notice_paired_without_usage
    MetroraNotice.LOCAL_PAIRING_FORGOTTEN -> R.string.notice_local_forgotten
    MetroraNotice.REMOTE_REVOCATION_COMPLETE -> R.string.notice_remote_revocation_complete
    MetroraNotice.REMOTE_REVOCATION_CONFIRMED_LOCAL_CLEANUP_NEEDED -> R.string.notice_remote_revocation_cleanup
    MetroraNotice.SNAPSHOT_RECOVERED -> R.string.notice_snapshot_recovered
}

private fun failureResource(failure: MetroraFailure): Int = when (failure.reason) {
    MetroraFailureReason.INVALID_HOST -> R.string.error_invalid_host
    MetroraFailureReason.INVALID_PORT -> R.string.error_invalid_port
    MetroraFailureReason.DESKTOP_UNREACHABLE -> R.string.error_unreachable
    MetroraFailureReason.TIMEOUT -> R.string.error_timeout
    MetroraFailureReason.DESKTOP_NOT_METRORA -> R.string.error_not_metrora
    MetroraFailureReason.COMPANION_API_UNAVAILABLE -> R.string.error_api_unavailable
    MetroraFailureReason.PROTOCOL_VERSION_UNSUPPORTED -> R.string.error_version
    MetroraFailureReason.PAIRING_NOT_AVAILABLE -> R.string.error_pairing_unavailable
    MetroraFailureReason.PAIRING_DECLINED_OR_EXPIRED -> R.string.error_pairing_declined
    MetroraFailureReason.ALREADY_PAIRED -> R.string.error_already_paired
    MetroraFailureReason.CERTIFICATE_MISMATCH -> R.string.error_certificate
    MetroraFailureReason.DESKTOP_IDENTITY_CHANGED -> R.string.error_desktop_identity_changed
    MetroraFailureReason.LOCAL_IDENTITY_CHANGED -> R.string.error_local_identity_changed
    MetroraFailureReason.CONFIRMATION_CODE_MISMATCH -> R.string.error_confirmation_code
    MetroraFailureReason.UNAUTHORIZED -> R.string.error_unauthorized
    MetroraFailureReason.REMOTE_REVOCATION_NOT_CONFIRMED -> R.string.error_revoke_unconfirmed
    MetroraFailureReason.MALFORMED_RESPONSE,
    MetroraFailureReason.RESPONSE_TOO_LARGE,
    -> R.string.error_malformed
    MetroraFailureReason.STORAGE_CORRUPTED,
    MetroraFailureReason.KEY_UNAVAILABLE,
    -> R.string.error_local_state
    MetroraFailureReason.INCONSISTENT_LOCAL_STATE -> R.string.error_recovery
    MetroraFailureReason.UNEXPECTED_SERVER_BEHAVIOR,
    MetroraFailureReason.UNKNOWN,
    -> R.string.error_unexpected
}

private fun formatUsd(micros: Long): String = NumberFormat.getCurrencyInstance(Locale.US)
    .format(BigDecimal.valueOf(micros).movePointLeft(6))

private fun formatCompact(value: Long): String = when {
    value >= 1_000_000_000 -> String.format(Locale.US, "%.1fB", value / 1_000_000_000.0)
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fK", value / 1_000.0)
    else -> value.toString()
}

private fun formatDate(epochMs: Long): String = DateFormat.getDateTimeInstance(
    DateFormat.MEDIUM,
    DateFormat.SHORT,
).format(Date(epochMs))
