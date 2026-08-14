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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraCoordinator
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.network.MetroraProtocol

@Composable
internal fun InitializingState() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            modifier = Modifier.padding(22.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.5.dp)
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.initializing_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.initializing_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
internal fun PairingState(state: MetroraUiState, coordinator: MetroraCoordinator) {
    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf(MetroraProtocol.DEFAULT_PORT.toString()) }
    var advanced by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val waiting = state.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
    val pairing = state.status == MetroraConnectionState.PAIRING
    val canSubmit = !state.busy && host.isNotBlank() && port.isNotBlank()
    val invalidHost = state.failure?.reason == MetroraFailureReason.INVALID_HOST
    val invalidPort = state.failure?.reason == MetroraFailureReason.INVALID_PORT

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 22.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.pair_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.pair_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text(
                text = androidx.compose.ui.res.stringResource(R.string.pair_step_address),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )

            OutlinedTextField(
                value = host,
                onValueChange = { host = it },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
                singleLine = true,
                isError = invalidHost,
                label = { Text(androidx.compose.ui.res.stringResource(R.string.desktop_address)) },
                supportingText = {
                    Text(
                        androidx.compose.ui.res.stringResource(
                            if (invalidHost) failureResource(state.failure) else R.string.desktop_address_hint,
                        ),
                    )
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            )

            OutlinedTextField(
                value = port,
                onValueChange = { value -> port = value.filter(Char::isDigit).take(5) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
                singleLine = true,
                isError = invalidPort,
                label = { Text(androidx.compose.ui.res.stringResource(R.string.port)) },
                supportingText = {
                    Text(
                        androidx.compose.ui.res.stringResource(
                            if (invalidPort) failureResource(state.failure) else R.string.port_hint,
                        ),
                    )
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        if (canSubmit) {
                            focusManager.clearFocus()
                            coordinator.pair(host, port)
                        }
                    },
                ),
            )

            when {
                pairing -> Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.5.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = androidx.compose.ui.res.stringResource(R.string.pairing_discovering),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = androidx.compose.ui.res.stringResource(R.string.pairing_discovering_body),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                waiting -> Text(
                    text = androidx.compose.ui.res.stringResource(R.string.pairing_continue_on_desktop),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> Button(
                    onClick = { coordinator.pair(host, port) },
                    enabled = canSubmit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp),
                ) {
                    Text(androidx.compose.ui.res.stringResource(R.string.pair_action))
                }
            }
        }
    }

    if (waiting) {
        PairingCodeCard(state, onCancel = coordinator::cancelPairing)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Security,
                    contentDescription = androidx.compose.ui.res.stringResource(R.string.security_icon),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.pairing_safety_title),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.pairing_safety_body),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            TextButton(
                onClick = { advanced = !advanced },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) {
                Icon(
                    imageVector = if (advanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    androidx.compose.ui.res.stringResource(
                        if (advanced) R.string.hide_connection_verification else R.string.pairing_advanced,
                    ),
                )
            }
            if (advanced) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.pairing_advanced_body),
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
    val displayCode = code.chunked(3).joinToString(" ")
    val codeDescription = androidx.compose.ui.res.stringResource(R.string.confirmation_code_a11y, code)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                imageVector = Icons.Outlined.Security,
                contentDescription = androidx.compose.ui.res.stringResource(R.string.security_icon),
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(28.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.pairing_waiting_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            SelectionContainer {
                Text(
                    text = displayCode,
                    modifier = Modifier.semantics {
                        contentDescription = codeDescription
                    },
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.pairing_waiting_body),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            state.pairingDesktopName?.let { name ->
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.pairing_waiting_device, name),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            OutlinedButton(
                onClick = onCancel,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp),
            ) {
                Text(androidx.compose.ui.res.stringResource(R.string.pairing_cancel))
            }
        }
    }
}

@Composable
internal fun RecoveryState(onForget: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 22.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.WarningAmber,
                contentDescription = androidx.compose.ui.res.stringResource(R.string.recovery_icon),
                tint = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.size(28.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.status_recovery_required),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.status_recovery_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            OutlinedButton(
                onClick = onForget,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp),
            ) {
                Text(androidx.compose.ui.res.stringResource(R.string.pair_again))
            }
        }
    }
}
