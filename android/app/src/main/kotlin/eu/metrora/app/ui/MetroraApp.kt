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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Header()
            if (state.initializing) {
                InitializingState()
            } else {
                Feedback(state)
                when {
                    state.status == MetroraConnectionState.RECOVERY_REQUIRED -> RecoveryState(
                        onForget = { confirmation = ConfirmAction.FORGET },
                    )
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
    }

    confirmation?.let { action ->
        ConfirmationDialog(
            action = action,
            recovery = state.status == MetroraConnectionState.RECOVERY_REQUIRED,
            onDismiss = { confirmation = null },
            onConfirm = {
                confirmation = null
                if (action == ConfirmAction.REVOKE) {
                    coordinator.revoke()
                } else {
                    coordinator.forgetLocal()
                }
            },
        )
    }
}

@Composable
private fun Header() {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.app_companion_label),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.8.sp,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.app_name),
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.app_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error,
                ),
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
