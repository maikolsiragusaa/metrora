package eu.metrora.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.PairingCredentials

@Composable
internal fun DeviceCard(
    state: MetroraUiState,
    onRevoke: () -> Unit,
    onForget: () -> Unit,
) {
    val credentials = state.credentials ?: return
    var detailsVisible by rememberSaveable { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.device_section_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = credentials.desktopName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.device_local_only_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            TextButton(
                onClick = { detailsVisible = !detailsVisible },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) {
                Icon(
                    imageVector = if (detailsVisible) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                )
                androidx.compose.foundation.layout.Spacer(Modifier.width(6.dp))
                Text(
                    androidx.compose.ui.res.stringResource(
                        if (detailsVisible) R.string.hide_connection_details else R.string.connection_details,
                    ),
                )
            }

            if (detailsVisible) {
                ConnectionDetails(credentials, state.failure)
            }

            if (state.status != MetroraConnectionState.REVOKED_OR_UNAUTHORIZED &&
                state.status != MetroraConnectionState.RECOVERY_REQUIRED
            ) {
                OutlinedButton(
                    onClick = onRevoke,
                    enabled = !state.busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.LinkOff,
                        contentDescription = null,
                    )
                    androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp))
                    Text(androidx.compose.ui.res.stringResource(R.string.revoke_desktop))
                }
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.revoke_desktop_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            OutlinedButton(
                onClick = onForget,
                enabled = !state.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.DeleteOutline,
                    contentDescription = null,
                )
                androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp))
                Text(
                    androidx.compose.ui.res.stringResource(
                        if (state.status == MetroraConnectionState.REVOKED_OR_UNAUTHORIZED ||
                            state.status == MetroraConnectionState.RECOVERY_REQUIRED
                        ) R.string.pair_again else R.string.forget_local,
                    ),
                )
            }
            Text(
                text = androidx.compose.ui.res.stringResource(R.string.forget_local_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ConnectionDetails(
    credentials: PairingCredentials,
    failure: MetroraFailure?,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        SelectionContainer {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DetailLine(
                    label = androidx.compose.ui.res.stringResource(R.string.desktop_endpoint_label),
                    value = androidx.compose.ui.res.stringResource(
                        R.string.desktop_endpoint,
                        credentials.host,
                        credentials.port,
                    ),
                )
                DetailLine(
                    label = androidx.compose.ui.res.stringResource(R.string.desktop_identity_label),
                    value = credentials.serverFingerprint,
                    technical = true,
                )
                DetailLine(
                    label = androidx.compose.ui.res.stringResource(R.string.phone_identity_label),
                    value = credentials.clientFingerprint,
                    technical = true,
                )
                DetailLine(
                    label = androidx.compose.ui.res.stringResource(R.string.paired_on_label),
                    value = formatDate(credentials.pairedAtEpochMs),
                )
                failure?.technicalDetail?.takeIf { it.isNotBlank() }?.let { detail ->
                    DetailLine(
                        label = androidx.compose.ui.res.stringResource(R.string.technical_detail_label),
                        value = detail,
                        technical = true,
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailLine(
    label: String,
    value: String,
    technical: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = if (technical) FontFamily.Monospace else FontFamily.Default,
        )
    }
}
