package eu.metrora.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import eu.metrora.app.MetroraFailure
import eu.metrora.app.MetroraFailureCategory
import eu.metrora.app.MetroraNotice
import eu.metrora.app.MetroraUiState
import eu.metrora.app.R
import kotlinx.coroutines.delay

@Composable
internal fun Feedback(state: MetroraUiState) {
    if (state.notice == null && state.failure == null) return
    var showNotice by remember { mutableStateOf(state.notice != null) }
    LaunchedEffect(state.notice) {
        showNotice = state.notice != null
        if (state.notice != null) {
            delay(3_500)
            showNotice = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (showNotice) state.notice?.let { NoticeSnackbar(it) }
        state.failure?.let { FailureBanner(it) }
    }
}

@Composable
private fun NoticeSnackbar(notice: MetroraNotice) {
    Snackbar(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite },
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        containerColor = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = androidx.compose.ui.res.stringResource(noticeResource(notice)),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun FailureBanner(failure: MetroraFailure) {
    var detailsVisible by rememberSaveable { mutableStateOf(false) }
    val technicalDetailsAvailable = failure.category == MetroraFailureCategory.IDENTITY_SECURITY ||
        !failure.technicalDetail.isNullOrBlank()
    val severe = failure.category == MetroraFailureCategory.IDENTITY_SECURITY ||
        failure.category == MetroraFailureCategory.LOCAL_STATE
    val containerColor = if (severe) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }
    val contentColor = if (severe) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    val icon = when (failure.category) {
        MetroraFailureCategory.CONNECTIVITY -> Icons.Outlined.CloudOff
        MetroraFailureCategory.IDENTITY_SECURITY -> Icons.Outlined.Security
        else -> Icons.Outlined.ErrorOutline
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite },
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = contentColor,
                    modifier = Modifier.size(22.dp),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(failureTitleResource(failure)),
                        color = contentColor,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = androidx.compose.ui.res.stringResource(failureResource(failure)),
                        color = contentColor,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (technicalDetailsAvailable) {
                TextButton(
                    onClick = { detailsVisible = !detailsVisible },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                ) {
                    Icon(
                        imageVector = if (detailsVisible) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                        contentDescription = null,
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        androidx.compose.ui.res.stringResource(
                            if (detailsVisible) R.string.hide_technical_details else R.string.show_technical_details,
                        ),
                    )
                }
                if (detailsVisible) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (failure.category == MetroraFailureCategory.IDENTITY_SECURITY) {
                            Text(
                                text = androidx.compose.ui.res.stringResource(R.string.advanced_security_failure),
                                color = contentColor,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        failure.technicalDetail?.takeIf { it.isNotBlank() }?.let { detail ->
                            SelectionContainer {
                                Text(
                                    text = androidx.compose.ui.res.stringResource(R.string.technical_detail, detail),
                                    color = contentColor,
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
