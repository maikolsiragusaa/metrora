package eu.metrora.app.ui

import eu.metrora.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MetroraProviderBrandingTest {
    @Test
    fun knownProviderIdUsesItsCanonicalAsset() {
        assertEquals(R.drawable.provider_codex, MetroraProviderBranding.logoResource("codex"))
        assertTrue(MetroraProviderBranding.hasCanonicalLogo("claude"))
    }

    @Test
    fun absentOrAmbiguousProviderIdUsesNeutralMark() {
        assertEquals(R.drawable.metrora_mark, MetroraProviderBranding.logoResource(null))
        assertEquals(R.drawable.metrora_mark, MetroraProviderBranding.logoResource("model-name-inference"))
        assertFalse(MetroraProviderBranding.hasCanonicalLogo("model-name-inference"))
    }
}
