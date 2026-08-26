package eu.metrora.app.ui

import androidx.compose.ui.platform.UriHandler

internal const val METRORA_PRIVACY_POLICY_URL = "https://metrora.eu/privacy"

internal fun openMetroraPrivacyPolicy(uriHandler: UriHandler) {
    uriHandler.openUri(METRORA_PRIVACY_POLICY_URL)
}
