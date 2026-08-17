package eu.metrora.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Shared V2 visual tokens. Keep product/domain decisions outside this file. */
internal object MetroraPalette {
    val background = Color(0xFF070D11)
    val surface = Color(0xFF0D151B)
    val surfaceRaised = Color(0xFF111A21)
    val surfaceMuted = Color(0xFF162128)
    val border = Color(0xFF223139)
    val borderStrong = Color(0xFF56666E)
    val text = Color(0xFFF4F7F8)
    val textMuted = Color(0xFFAAB7BD)
    val textSubtle = Color(0xFF77878E)
    val cyan = Color(0xFF00D4FF)
    val signalCyanDeep = Color(0xFF007A99)
    val signalCyanSoft = Color(0xFFE6F9FD)
    val success = Color(0xFF21D47A)
    val warning = Color(0xFFFFC857)
    val brandBadgeLight = Color(0xFFF1F4F5)
    val brandBadgeLightBorder = Color(0xFFC8D1D5)
}

internal object MetroraSpacing {
    val page = 16.dp
    val section = 12.dp
    val card = 14.dp
    val compact = 10.dp
}

private val DarkColors = darkColorScheme(
    primary = MetroraPalette.cyan,
    onPrimary = Color(0xFF00212A),
    primaryContainer = Color(0xFF063F4D),
    onPrimaryContainer = Color(0xFFA5EEFF),
    secondary = MetroraPalette.textMuted,
    onSecondary = Color(0xFF07343C),
    secondaryContainer = MetroraPalette.surfaceMuted,
    onSecondaryContainer = Color(0xFFC4F2F8),
    tertiary = Color(0xFFB8C7DF),
    onTertiary = Color(0xFF1C3048),
    tertiaryContainer = Color(0xFF34465D),
    onTertiaryContainer = Color(0xFFD7E4FC),
    background = MetroraPalette.background,
    onBackground = MetroraPalette.text,
    surface = MetroraPalette.surface,
    onSurface = MetroraPalette.text,
    surfaceVariant = MetroraPalette.surfaceMuted,
    onSurfaceVariant = MetroraPalette.textMuted,
    outline = MetroraPalette.borderStrong,
    surfaceTint = MetroraPalette.cyan,
)

private val MetroraTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 22.sp,
            lineHeight = 26.sp,
        ),
        displayMedium = displayMedium.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 28.sp,
            lineHeight = 32.sp,
        ),
        headlineMedium = headlineMedium.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 19.sp,
            lineHeight = 23.sp,
        ),
        titleLarge = titleLarge.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Medium,
            fontSize = 16.sp,
            lineHeight = 20.sp,
        ),
        titleMedium = titleMedium.copy(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 18.sp),
        bodyLarge = bodyLarge.copy(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 18.sp),
        bodyMedium = bodyMedium.copy(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 16.sp),
        bodySmall = bodySmall.copy(fontFamily = FontFamily.SansSerif, fontSize = 11.sp, lineHeight = 15.sp),
        labelLarge = labelLarge.copy(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 16.sp),
        labelMedium = labelMedium.copy(fontFamily = FontFamily.SansSerif, fontSize = 10.sp, lineHeight = 14.sp),
        labelSmall = labelSmall.copy(fontFamily = FontFamily.SansSerif, fontSize = 9.sp, lineHeight = 12.sp),
    )
}

@Composable
fun MetroraTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors, typography = MetroraTypography, content = content)
}
