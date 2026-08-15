package eu.metrora.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val SignalCyan = Color(0xFF00D4FF)
private val DeepCyan = Color(0xFF00677D)
private val Graphite950 = Color(0xFF0B1013)
private val Graphite900 = Color(0xFF11181C)
private val Graphite700 = Color(0xFF243239)
private val Graphite300 = Color(0xFFB9C9CE)
private val Cloud = Color(0xFFF4F8F9)
private val CloudSurface = Color(0xFFFFFFFF)
private val CloudVariant = Color(0xFFE4EEF0)

private val DarkColors = darkColorScheme(
    primary = SignalCyan,
    onPrimary = Color(0xFF00212A),
    primaryContainer = Color(0xFF004653),
    onPrimaryContainer = Color(0xFFA5EEFF),
    secondary = Color(0xFFA6D8E0),
    onSecondary = Color(0xFF07343C),
    secondaryContainer = Color(0xFF234B54),
    onSecondaryContainer = Color(0xFFC4F2F8),
    tertiary = Color(0xFFB8C7DF),
    onTertiary = Color(0xFF1C3048),
    tertiaryContainer = Color(0xFF34465D),
    onTertiaryContainer = Color(0xFFD7E4FC),
    background = Graphite950,
    onBackground = Color(0xFFE7F0F2),
    surface = Graphite900,
    onSurface = Color(0xFFE7F0F2),
    surfaceVariant = Graphite700,
    onSurfaceVariant = Graphite300,
    outline = Color(0xFF819399),
    surfaceTint = SignalCyan,
)

private val MetroraTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 30.sp,
            lineHeight = 36.sp,
        ),
        displayMedium = displayMedium.copy(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 42.sp,
            lineHeight = 48.sp,
        ),
        titleLarge = titleLarge.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium),
        bodyLarge = bodyLarge.copy(fontFamily = FontFamily.SansSerif, lineHeight = 26.sp),
        bodyMedium = bodyMedium.copy(fontFamily = FontFamily.SansSerif, lineHeight = 21.sp),
    )
}

@Composable
fun MetroraTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors, typography = MetroraTypography, content = content)
}
