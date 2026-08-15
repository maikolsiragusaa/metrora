package eu.metrora.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.R

@Composable
internal fun MetroraPanel(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surface,
    borderColor: Color = MaterialTheme.colorScheme.outline,
    radius: Int = 20,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier.border(1.dp, borderColor.copy(alpha = 0.72f), RoundedCornerShape(radius.dp)),
        shape = RoundedCornerShape(radius.dp),
        color = color,
        content = content,
    )
}

@Composable
internal fun MetroraBrandHeader(
    modifier: Modifier = Modifier,
    onHelp: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.metrora_mark),
            contentDescription = androidx.compose.ui.res.stringResource(R.string.metrora_logo_description),
            modifier = Modifier.size(46.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.app_name).uppercase(),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Medium,
            letterSpacing = 3.8.sp,
        )
        Spacer(Modifier.weight(1f))
        onHelp?.let {
            IconButton(
                onClick = it,
                modifier = Modifier.semantics { role = Role.Button },
            ) {
                Icon(
                    imageVector = Icons.Outlined.HelpOutline,
                    contentDescription = androidx.compose.ui.res.stringResource(R.string.help_action),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
internal fun MetroraBackHeader(
    onBack: () -> Unit,
    onHelp: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = onBack,
            modifier = Modifier
                .size(48.dp)
                .semantics { role = Role.Button },
        ) {
            Icon(
                imageVector = Icons.Outlined.ArrowBack,
                contentDescription = androidx.compose.ui.res.stringResource(R.string.back_action),
            )
        }
        onHelp?.let {
            IconButton(
                onClick = it,
                modifier = Modifier
                    .size(48.dp)
                    .semantics { role = Role.Button },
            ) {
                Icon(
                    imageVector = Icons.Outlined.HelpOutline,
                    contentDescription = androidx.compose.ui.res.stringResource(R.string.help_action),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
