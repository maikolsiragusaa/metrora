package eu.metrora.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraCoordinator
import eu.metrora.app.MetroraFailureReason
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.network.MetroraProtocol

@Composable
internal fun ConnectScreen(
    state: MetroraUiState,
    coordinator: MetroraCoordinator,
    onOpenScanner: () -> Unit,
) {
    var manualVisible by rememberSaveable { mutableStateOf(false) }
    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf(MetroraProtocol.DEFAULT_PORT.toString()) }
    val focusManager = LocalFocusManager.current
    val invalidHost = state.failure?.reason == MetroraFailureReason.INVALID_HOST
    val invalidPort = state.failure?.reason == MetroraFailureReason.INVALID_PORT
    val canSubmit = !state.busy && host.isNotBlank() && port.isNotBlank()
    val manualAddressAction = androidx.compose.ui.res.stringResource(R.string.manual_address_action)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        MetroraBrandHeader(onHelp = {})
        Feedback(state)

        Column(
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.connect_title),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.connect_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        ConnectQrCard(
            enabled = !state.busy,
            onClick = onOpenScanner,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            androidx.compose.material3.HorizontalDivider(Modifier.weight(1f))
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.or_label),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge,
            )
            androidx.compose.material3.HorizontalDivider(Modifier.weight(1f))
        }

        MetroraPanel(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    enabled = !state.busy,
                    role = Role.Button,
                    onClick = { manualVisible = !manualVisible },
                )
                .semantics { contentDescription = manualAddressAction },
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
            radius = 18,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.DesktopWindows,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(30.dp),
                )
                Spacer(Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.manual_address_title),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(R.string.manual_address_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    imageVector = if (manualVisible) Icons.Outlined.ExpandLess else Icons.Outlined.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (manualVisible) {
            MetroraPanel(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
                radius = 18,
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
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
                        onValueChange = { port = it.filter(Char::isDigit).take(5) },
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
                    if (state.status == MetroraConnectionState.PAIRING) {
                        Row(
                            modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text(
                                text = androidx.compose.ui.res.stringResource(R.string.pairing_discovering),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    } else {
                        Button(
                            onClick = { coordinator.pair(host, port) },
                            enabled = canSubmit,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                        ) {
                            Text(androidx.compose.ui.res.stringResource(R.string.pair_action))
                        }
                    }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = Icons.Outlined.Lock,
                contentDescription = androidx.compose.ui.res.stringResource(R.string.security_icon),
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(28.dp),
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.local_private_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.local_private_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        HowItWorksCard()
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.pairing_footer),
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ConnectQrCard(enabled: Boolean, onClick: () -> Unit) {
    val scanQrAction = androidx.compose.ui.res.stringResource(R.string.scan_qr_action)
    MetroraPanel(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = scanQrAction },
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.23f),
        borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.45f),
        radius = 22,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 30.dp, horizontal = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.QrCode2,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(86.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.scan_qr_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.recommended),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun HowItWorksCard() {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
        radius = 18,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.how_it_works_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            HowItWorksRow(
                icon = Icons.Outlined.DesktopWindows,
                title = R.string.how_it_works_step_one,
                body = R.string.how_it_works_step_one_body,
            )
            HowItWorksRow(
                icon = Icons.Outlined.QrCode2,
                title = R.string.how_it_works_step_two,
                body = R.string.how_it_works_step_two_body,
            )
            HowItWorksRow(
                icon = Icons.Outlined.Security,
                title = R.string.how_it_works_step_three,
                body = R.string.how_it_works_step_three_body,
            )
        }
    }
}

@Composable
private fun HowItWorksRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: Int,
    body: Int,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(28.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(body),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun VerifySasScreen(
    state: MetroraUiState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val code = state.pairingCode ?: return
    val waitingForApproval = state.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL
    val confirmationCodeDescription = androidx.compose.ui.res.stringResource(
        R.string.confirmation_code_a11y,
        code,
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        MetroraBackHeader(onBack = onCancel, onHelp = {})
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.verify_title),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.verify_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        MetroraPanel(
            modifier = Modifier
                .fillMaxWidth()
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = confirmationCodeDescription
                },
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
            borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.36f),
            radius = 18,
        ) {
            SelectionContainer {
                Text(
                    text = code.chunked(1).joinToString("  "),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 22.dp),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.displaySmall.copy(
                        letterSpacing = 8.sp,
                        fontWeight = FontWeight.Medium,
                    ),
                    textAlign = TextAlign.Center,
                )
            }
        }

        MetroraPanel(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.22f),
            radius = 18,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                VerifyRow(
                    icon = Icons.Outlined.CheckCircle,
                    title = R.string.verify_check_title,
                    body = R.string.verify_check_body,
                )
                VerifyRow(
                    icon = Icons.Outlined.Security,
                    title = R.string.verify_security_title,
                    body = R.string.verify_security_body,
                )
                VerifyRow(
                    icon = Icons.Outlined.DesktopWindows,
                    title = R.string.verify_approval_title,
                    body = R.string.verify_approval_body,
                )
            }
        }

        if (waitingForApproval) {
            Row(
                modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.waiting_for_desktop),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            Button(
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
            ) {
                Text(androidx.compose.ui.res.stringResource(R.string.codes_match))
            }
        }
        TextButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            contentPadding = PaddingValues(vertical = 10.dp),
        ) {
            Text(androidx.compose.ui.res.stringResource(R.string.cancel_action))
        }
    }
}

@Composable
private fun VerifyRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: Int,
    body: Int,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(28.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = androidx.compose.ui.res.stringResource(title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = androidx.compose.ui.res.stringResource(body),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun InitializingState() {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f),
    ) {
        Row(
            modifier = Modifier.padding(22.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp)
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
internal fun RecoveryState(onForget: () -> Unit) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.72f),
        borderColor = MaterialTheme.colorScheme.error.copy(alpha = 0.65f),
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
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            ) {
                Text(androidx.compose.ui.res.stringResource(R.string.pair_again))
            }
        }
    }
}
