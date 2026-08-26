package eu.metrora.app.ui

import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraConnectionState
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import eu.metrora.app.data.PairingCredentials

@Composable
internal fun DeviceCard(state: MetroraUiState) {
    val credentials = state.credentials ?: return
    var detailsVisible by rememberSaveable { mutableStateOf(false) }
    val connected = state.status == MetroraConnectionState.CONNECTED || state.status == MetroraConnectionState.REFRESHING
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.surface.copy(alpha = 0.82f), radius = 13) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                MetroraIconBadge(Icons.Outlined.DesktopWindows, tint = MetroraPalette.cyan, size = 26.dp)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(credentials.desktopName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    Text(androidx.compose.ui.res.stringResource(R.string.device_local_only_body), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
                MetroraStatusPill(androidx.compose.ui.res.stringResource(if (connected) R.string.connected else R.string.saved_state), connected = connected)
            }
            Row(modifier = Modifier.fillMaxWidth().clickable { detailsVisible = !detailsVisible }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (detailsVisible) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(androidx.compose.ui.res.stringResource(if (detailsVisible) R.string.hide_connection_details else R.string.connection_details), color = MetroraPalette.cyan, style = MaterialTheme.typography.bodyMedium)
            }
            if (detailsVisible) ConnectionDetails(credentials, state.failure)
        }
    }
}

@Composable
internal fun DeviceActionCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    body: String,
    enabled: Boolean = true,
    onClickLabel: String? = null,
    onClick: () -> Unit,
) {
    MetroraPanel(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClickLabel = onClickLabel, onClick = onClick),
        color = MetroraPalette.surface.copy(alpha = 0.78f),
        radius = 12,
    ) {
        Row(modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(horizontal = 10.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
            MetroraIconBadge(icon, tint = MetroraPalette.cyan, size = 26.dp)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(body, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun ConnectionDetails(credentials: PairingCredentials, failure: MetroraFailure?) {
    MetroraPanel(modifier = Modifier.fillMaxWidth(), color = MetroraPalette.background.copy(alpha = 0.52f), borderColor = MetroraPalette.border, radius = 13) {
        SelectionContainer {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                DetailLine(androidx.compose.ui.res.stringResource(R.string.desktop_endpoint_label), androidx.compose.ui.res.stringResource(R.string.desktop_endpoint, credentials.host, credentials.port))
                DetailLine(androidx.compose.ui.res.stringResource(R.string.desktop_identity_label), credentials.serverFingerprint, true)
                DetailLine(androidx.compose.ui.res.stringResource(R.string.phone_identity_label), credentials.clientFingerprint, true)
                DetailLine(androidx.compose.ui.res.stringResource(R.string.paired_on_label), formatDate(credentials.pairedAtEpochMs))
                failure?.technicalDetail?.takeIf { it.isNotBlank() }?.let { DetailLine(androidx.compose.ui.res.stringResource(R.string.technical_detail_label), it, true) }
            }
        }
    }
}

@Composable
private fun DetailLine(label: String, value: String, technical: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall, fontFamily = if (technical) FontFamily.Monospace else FontFamily.Default)
    }
}
