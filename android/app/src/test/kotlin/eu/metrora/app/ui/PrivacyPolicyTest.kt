package eu.metrora.app.ui

import androidx.compose.ui.platform.UriHandler
import org.junit.Assert.assertEquals
import org.junit.Test

class PrivacyPolicyTest {
    @Test
    fun opensCanonicalPrivacyPolicyUrl() {
        var openedUrl: String? = null
        openMetroraPrivacyPolicy(object : UriHandler {
            override fun openUri(uri: String) {
                openedUrl = uri
            }
        })

        assertEquals("https://metrora.eu/privacy", openedUrl)
    }
}
