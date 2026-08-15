package eu.metrora.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraCoordinator
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R

private enum class ConfirmAction {
    REVOKE,
    FORGET,
}

@Composable
fun MetroraApp(coordinator: MetroraCoordinator) {
    val state by coordinator.state.collectAsState()
    var confirmation by rememberSaveable { mutableStateOf<ConfirmAction?>(null) }
    var scannerVisible by rememberSaveable { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        when {
            scannerVisible -> QrScannerScreen(
                onBack = { scannerVisible = false },
                onPayload = { payload ->
                    val endpoint = runCatching {
                        eu.metrora.app.network.PairingBootstrap.parse(payload)
                    }.getOrNull()
                    if (endpoint != null) {
                        scannerVisible = false
                        coordinator.pair(endpoint.host, endpoint.port.toString())
                    }
                    endpoint != null
                },
            )
            state.initializing -> AppScrollShell { InitializingState() }
            state.status == MetroraConnectionState.VERIFYING_SAS ||
                state.status == MetroraConnectionState.WAITING_FOR_DESKTOP_APPROVAL -> VerifySasScreen(
                state = state,
                onConfirm = coordinator::confirmPairingCode,
                onCancel = coordinator::cancelPairing,
            )
            state.status == MetroraConnectionState.RECOVERY_REQUIRED -> AppScrollShell {
                Feedback(state)
                RecoveryState(onForget = { confirmation = ConfirmAction.FORGET })
            }
            state.credentials == null -> ConnectScreen(
                state = state,
                coordinator = coordinator,
                onOpenScanner = { scannerVisible = true },
            )
            else -> HomeState(
                state = state,
                onRefresh = coordinator::refresh,
                onSelectPeriod = coordinator::selectPeriod,
                onRevoke = { confirmation = ConfirmAction.REVOKE },
                onForget = { confirmation = ConfirmAction.FORGET },
            )
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
private fun AppScrollShell(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        content = { content() },
    )
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
        icon = {
            Icon(
                imageVector = if (revoke) Icons.Outlined.LinkOff else Icons.Outlined.DeleteOutline,
                contentDescription = null,
            )
        },
        title = {
            Text(
                androidx.compose.ui.res.stringResource(
                    if (revoke) R.string.confirm_revoke_title else R.string.confirm_forget_title,
                ),
            )
        },
        text = {
            Text(
                androidx.compose.ui.res.stringResource(
                    when {
                        revoke -> R.string.confirm_revoke_body
                        recovery -> R.string.confirm_forget_recovery_body
                        else -> R.string.confirm_forget_body
                    },
                ),
            )
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) {
                Text(androidx.compose.ui.res.stringResource(R.string.confirm_action))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(androidx.compose.ui.res.stringResource(R.string.cancel_action))
            }
        },
    )
}
