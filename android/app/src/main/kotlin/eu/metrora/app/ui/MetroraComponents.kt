package eu.metrora.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ExpandMore
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import eu.metrora.app.R

@Composable
internal fun MetroraPanel(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surface,
    borderColor: Color = MetroraPalette.border,
    radius: Int = 18,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier.border(0.5.dp, borderColor.copy(alpha = 0.72f), RoundedCornerShape(radius.dp)),
        shape = RoundedCornerShape(radius.dp),
        color = color,
        content = content,
    )
}

@Composable
internal fun MetroraLogo(
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    tight: Boolean = false,
    markSize: Dp? = null,
    markBoxWidth: Dp? = null,
    markOffsetX: Dp = 0.dp,
) {
    val resolvedMarkSize = markSize ?: if (compact) 24.dp else 34.dp
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (markBoxWidth != null) 0.dp else if (compact) 7.dp else if (tight) 8.dp else 10.dp),
    ) {
        if (markBoxWidth != null) {
            Box(Modifier.width(markBoxWidth).height(resolvedMarkSize)) {
                Image(
                    painter = painterResource(R.drawable.metrora_mark),
                    contentDescription = androidx.compose.ui.res.stringResource(R.string.metrora_logo_description),
                    modifier = Modifier.size(resolvedMarkSize).offset(x = markOffsetX),
                )
            }
        } else {
            Image(
                painter = painterResource(R.drawable.metrora_mark),
                contentDescription = androidx.compose.ui.res.stringResource(R.string.metrora_logo_description),
                modifier = Modifier.size(resolvedMarkSize),
            )
        }
        Text(
            text = androidx.compose.ui.res.stringResource(R.string.app_name).uppercase(),
            style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Medium,
            letterSpacing = if (compact) 1.4.sp else if (tight) 1.4.sp else 2.4.sp,
            modifier = if (compact) Modifier else Modifier.offset(x = (-1.5).dp),
            maxLines = 1,
        )
    }
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
        MetroraLogo(
            modifier = Modifier.offset(x = (-7).dp, y = (-2).dp),
            tight = true,
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
    Box(
        modifier = Modifier.fillMaxWidth(),
    ) {
        IconButton(
            onClick = onBack,
            modifier = Modifier.align(Alignment.CenterStart).offset(x = (-16).dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.ArrowBack,
                contentDescription = androidx.compose.ui.res.stringResource(R.string.back_action),
            )
        }
        MetroraLogo(
            modifier = Modifier.align(Alignment.Center).offset(y = 2.dp),
            compact = false,
        )
        onHelp?.let {
            IconButton(
                onClick = it,
                modifier = Modifier.align(Alignment.CenterEnd),
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
internal fun MetroraIconBadge(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary,
    filled: Boolean = true,
    size: Dp = 30.dp,
) {
    Surface(
        modifier = modifier.size(size),
        shape = RoundedCornerShape(10.dp),
        color = if (filled) tint.copy(alpha = 0.10f) else Color.Transparent,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, tint.copy(alpha = 0.28f)),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.padding(if (size <= 24.dp) 4.dp else 5.dp),
        )
    }
}

@Composable
internal fun MetroraModelBrandBadge(
    brandId: String?,
    modifier: Modifier = Modifier,
    size: Dp = 30.dp,
) {
    val knownBrand = MetroraModelBranding.hasCanonicalLogo(brandId)
    Surface(
        modifier = modifier.size(size),
        shape = RoundedCornerShape(10.dp),
        color = MetroraPalette.surfaceMuted,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.border.copy(alpha = 0.8f)),
    ) {
        Image(
            painter = painterResource(MetroraModelBranding.logoResource(brandId)),
            contentDescription = brandId
                ?.let(MetroraModelBranding::brandLabel)
                ?.takeIf { knownBrand }
                ?.let { androidx.compose.ui.res.stringResource(R.string.model_brand_logo_description, it) }
                ?: androidx.compose.ui.res.stringResource(R.string.metrora_model_logo_description),
            modifier = Modifier.padding(if (size <= 24.dp) 4.dp else 6.dp),
        )
    }
}

@Composable
internal fun MetroraStatusPill(
    label: String,
    modifier: Modifier = Modifier,
    connected: Boolean = true,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = Color.Transparent,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.border.copy(alpha = 0.82f)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Surface(
                modifier = Modifier.size(6.dp),
                shape = RoundedCornerShape(50),
                color = if (connected) MetroraPalette.cyan else MetroraPalette.textSubtle,
            ) {}
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(fontSize = 8.sp, lineHeight = 11.sp, letterSpacing = 0.sp),
                color = if (connected) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

@Composable
internal fun MetroraCompactControl(
    modifier: Modifier = Modifier,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    MetroraPanel(
        modifier = modifier.clickable(enabled = enabled, onClick = onClick),
        color = MetroraPalette.surface.copy(alpha = 0.92f),
        radius = 11,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelLarge.copy(fontSize = 10.sp, lineHeight = 13.sp),
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Outlined.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
internal fun MetroraMetricTabs(
    selected: String,
    options: List<String>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MetroraPalette.surface.copy(alpha = 0.86f),
        border = androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.border.copy(alpha = 0.75f)),
    ) {
        Row(modifier = Modifier.padding(2.dp), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
            options.forEach { option ->
                val active = option == selected
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(onClick = { onSelect(option) }),
                    shape = RoundedCornerShape(15.dp),
                    color = if (active) MetroraPalette.cyan.copy(alpha = 0.13f) else Color.Transparent,
                    border = if (active) androidx.compose.foundation.BorderStroke(0.5.dp, MetroraPalette.cyan.copy(alpha = 0.78f)) else null,
                ) {
                    Text(
                        option,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        color = if (active) MetroraPalette.cyan else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

@Composable
internal fun MetroraPrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: ImageVector? = null,
    leadingContent: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 40.dp),
        shape = RoundedCornerShape(7.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
            containerColor = MetroraPalette.cyan,
            contentColor = Color(0xFF001A20),
            disabledContainerColor = MetroraPalette.surfaceMuted,
            disabledContentColor = MetroraPalette.textSubtle,
        ),
    ) {
        when {
            leadingContent != null -> {
                leadingContent()
                Spacer(Modifier.width(8.dp))
            }
            leadingIcon != null -> {
                Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
            }
        }
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}
