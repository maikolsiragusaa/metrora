package eu.metrora.app.ui

import eu.metrora.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MetroraModelBrandingTest {
    @Test
    fun knownModelBrandUsesCanonicalVendorAssets() {
        assertEquals(R.drawable.model_brand_openai, MetroraModelBranding.logoResource("openai"))
        assertEquals(R.drawable.model_brand_anthropic, MetroraModelBranding.logoResource("anthropic"))
        assertEquals(R.drawable.model_brand_google, MetroraModelBranding.logoResource("google"))
        assertEquals(R.drawable.model_brand_zai, MetroraModelBranding.logoResource("zai"))
        assertEquals(R.drawable.model_brand_deepseek, MetroraModelBranding.logoResource("deepseek"))
        assertEquals(R.drawable.model_brand_qwen, MetroraModelBranding.logoResource("qwen"))
        assertEquals(R.drawable.model_brand_moonshot, MetroraModelBranding.logoResource("moonshot"))
        assertTrue(MetroraModelBranding.hasCanonicalLogo("anthropic"))
    }

    @Test
    fun collectorOrAmbiguousIdsNeverBecomeModelBrandLogos() {
        assertEquals(R.drawable.metrora_mark, MetroraModelBranding.logoResource("codex"))
        assertEquals(R.drawable.metrora_mark, MetroraModelBranding.logoResource(null))
        assertEquals(R.drawable.metrora_mark, MetroraModelBranding.logoResource("model-name-inference"))
        assertFalse(MetroraModelBranding.hasCanonicalLogo("codex"))
        assertFalse(MetroraModelBranding.hasCanonicalLogo("model-name-inference"))
    }

    @Test
    fun routeSubtitleUsesHumanLabelsOnlyWhenInformative() {
        assertEquals("Amazon Bedrock", MetroraModelBranding.routeLabel("amazon-bedrock"))
        assertEquals("Anthropic API", MetroraModelBranding.routeLabel("api_provider_anthropic"))
        assertFalse(MetroraModelBranding.shouldShowRoute("api_provider_anthropic", "anthropic", false))
        assertTrue(MetroraModelBranding.shouldShowRoute("amazon-bedrock", "anthropic", false))
        assertTrue(MetroraModelBranding.shouldShowRoute("api_provider_anthropic", "anthropic", true))
        assertEquals(null, MetroraModelBranding.routeLabel("unknown-internal-route"))
        assertFalse(MetroraModelBranding.shouldShowRoute("unknown-internal-route", null, true))
    }

    @Test
    fun duplicateRowsUseKnownRouteOrHonestUnavailableDifferentiator() {
        assertEquals(
            MetroraModelBranding.RouteSubtitleKind.KNOWN,
            MetroraModelBranding.routeSubtitleKind("anthropic", "anthropic", true),
        )
        assertEquals(
            MetroraModelBranding.RouteSubtitleKind.KNOWN,
            MetroraModelBranding.routeSubtitleKind("amazon-bedrock", "anthropic", true),
        )
        assertEquals(
            MetroraModelBranding.RouteSubtitleKind.UNAVAILABLE,
            MetroraModelBranding.routeSubtitleKind(null, "anthropic", true),
        )
        assertEquals(
            MetroraModelBranding.RouteSubtitleKind.UNAVAILABLE,
            MetroraModelBranding.routeSubtitleKind("unknown-internal-route", "anthropic", true),
        )
        assertEquals(null, MetroraModelBranding.routeSubtitleKind(null, "anthropic", false))
    }
}
