package eu.metrora.app.ui

import eu.metrora.app.R
import java.util.Locale

/**
 * Presentation-only model-vendor branding.
 *
 * `brandId` is Desktop-owned canonical model evidence. It is deliberately
 * separate from `providerId`, which remains the factual delivery route or
 * provenance used for duplicate handling and optional route subtitles.
 */
internal object MetroraModelBranding {
    private val canonicalLogos = mapOf(
        "openai" to R.drawable.model_brand_openai,
        "anthropic" to R.drawable.model_brand_anthropic,
        "google" to R.drawable.model_brand_google,
        "zai" to R.drawable.model_brand_zai,
    )

    private val brandLabels = mapOf(
        "openai" to "OpenAI",
        "anthropic" to "Anthropic / Claude",
        "google" to "Google / Gemini",
        "zai" to "Z.AI / GLM",
    )

    private data class RoutePresentation(
        val label: String,
        /** A route's own vendor, when the route id factually identifies one. */
        val brandId: String? = null,
    )

    private val routePresentations = mapOf(
        "openai" to RoutePresentation("OpenAI", "openai"),
        "api_provider_openai" to RoutePresentation("OpenAI API", "openai"),
        "anthropic" to RoutePresentation("Anthropic", "anthropic"),
        "api_provider_anthropic" to RoutePresentation("Anthropic API", "anthropic"),
        "amazon-bedrock" to RoutePresentation("Amazon Bedrock"),
        "aws-bedrock" to RoutePresentation("Amazon Bedrock"),
        "google" to RoutePresentation("Google", "google"),
        "api_provider_google" to RoutePresentation("Google API", "google"),
        "vertex-ai" to RoutePresentation("Google Vertex AI", "google"),
        "google-vertex" to RoutePresentation("Google Vertex AI", "google"),
        "zai" to RoutePresentation("Z.AI", "zai"),
        "api_provider_zai" to RoutePresentation("Z.AI API", "zai"),
        "openrouter" to RoutePresentation("OpenRouter"),
        "vercel-ai-gateway" to RoutePresentation("Vercel AI Gateway"),
    )

    private fun normalize(value: String?): String? = value?.trim()?.lowercase(Locale.US)?.ifBlank { null }

    fun hasCanonicalLogo(brandId: String?): Boolean = normalize(brandId)?.let(canonicalLogos::containsKey) == true

    fun logoResource(brandId: String?): Int = canonicalLogos[normalize(brandId)] ?: R.drawable.metrora_mark

    fun brandLabel(brandId: String?): String? = normalize(brandId)?.let(brandLabels::get)

    fun routeLabel(providerId: String?): String? = normalize(providerId)?.let(routePresentations::get)?.label

    /**
     * Show a route only when it adds information or is needed to distinguish
     * rows. Unknown internal ids are intentionally omitted rather than shown.
     */
    fun shouldShowRoute(providerId: String?, brandId: String?, duplicatedModelName: Boolean): Boolean {
        val route = normalize(providerId)?.let(routePresentations::get) ?: return false
        if (duplicatedModelName) return true
        return route.brandId == null || normalize(brandId) != route.brandId
    }
}
