package eu.metrora.app.ui

import eu.metrora.app.R

/**
 * Provider marks are selected only from the factual providerId in the payload.
 * An absent or unrecognised id deliberately uses the neutral Metrora mark.
 */
internal object MetroraProviderBranding {
    private val canonicalLogos = mapOf(
        "antigravity" to R.drawable.provider_antigravity,
        "claude" to R.drawable.provider_claude,
        "cline" to R.drawable.provider_cline,
        "codewhale" to R.drawable.provider_codewhale,
        "codex" to R.drawable.provider_codex,
        "copilot" to R.drawable.provider_copilot,
        "crush" to R.drawable.provider_crush,
        "cursor-agent" to R.drawable.provider_cursor,
        "cursor" to R.drawable.provider_cursor,
        "devin" to R.drawable.provider_devin,
        "droid" to R.drawable.provider_droid,
        "forge" to R.drawable.provider_forge,
        "gemini" to R.drawable.provider_gemini,
        "goose" to R.drawable.provider_goose,
        "grok" to R.drawable.provider_grok,
        "hermes" to R.drawable.provider_hermes,
        "ibm-bob" to R.drawable.provider_ibm_bob,
        "kilo-code" to R.drawable.provider_kilo_code,
        "kimi" to R.drawable.provider_kimi,
        "kiro" to R.drawable.provider_kiro,
        "mistral-vibe" to R.drawable.provider_mistral_vibe,
        "mux" to R.drawable.provider_mux,
        "omp" to R.drawable.provider_omp,
        "openclaw" to R.drawable.provider_openclaw,
        "opencode" to R.drawable.provider_opencode,
        "pi" to R.drawable.provider_pi,
        "qwen" to R.drawable.provider_qwen,
        "roo-code" to R.drawable.provider_roo_code,
        "vercel-gateway" to R.drawable.provider_vercel_gateway,
        "warp" to R.drawable.provider_warp,
        "zcode" to R.drawable.provider_zcode,
        "zed" to R.drawable.provider_zed,
        "zerostack" to R.drawable.provider_zerostack,
    )

    fun hasCanonicalLogo(providerId: String?): Boolean = providerId != null && canonicalLogos.containsKey(providerId)

    fun logoResource(providerId: String?): Int = canonicalLogos[providerId] ?: R.drawable.metrora_mark
}
