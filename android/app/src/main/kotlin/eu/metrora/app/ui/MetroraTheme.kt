package eu.metrora.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val SignalCyan = Color(0xFF00D4FF)
private val DeepCyan = Color(0xFF00677D)
private val Graphite950 = Color(0xFF0B1013)
private val Graphite900 = Color(0xFF11181C)
private val Graphite700 = Color(0xFF243239)
private val Graphite300 = Color(0xFFB9C9CE)
private val Cloud = Color(0xFFF4F8F9)
private val CloudSurface = Color(0xFFFFFFFF)
private val CloudVariant = Color(0xFFE4EEF0)

private val LightColors = lightColorScheme(
    primary = DeepCyan,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFB8ECF5),
    onPrimaryContainer = Color(0xFF001F27),
    secondary = Color(0xFF41636B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFCBE8EC),
    onSecondaryContainer = Color(0xFF071F24),
    tertiary = Color(0xFF526277),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFD7E2F4),
    onTertiaryContainer = Color(0xFF0C1B2B),
    background = Cloud,
    onBackground = Color(0xFF151D20),
    surface = CloudSurface,
    onSurface = Color(0xFF151D20),
    surfaceVariant = CloudVariant,
    onSurfaceVariant = Color(0xFF3D4B50),
    outline = Color(0xFF6F7F84),
)

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
)

@Composable
fun MetroraTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
