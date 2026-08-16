package eu.metrora.app.network

import eu.metrora.app.data.CapabilityAvailability
import eu.metrora.app.data.CapabilityDescriptor
import eu.metrora.app.data.CapabilityDiscovery
import eu.metrora.app.data.CapabilityFreshness
import org.json.JSONArray
import org.json.JSONObject

internal object CompanionCapabilitiesV1Parser {
    private const val MAX_CAPABILITIES = 16

    fun parse(raw: String): CapabilityDiscovery {
        val root = JSONObject(raw)
        if (root.optString("kind") != MetroraProtocol.CAPABILITIES_KIND ||
            root.optInt("version", -1) != MetroraProtocol.API_VERSION
        ) {
            // Capability discovery is intentionally fail-safe for older or
            // newer Desktops: callers retain Home/Usage and expose no guessed
            // domain surface.
            return CapabilityDiscovery.unavailable()
        }
        val values = root.optJSONArray("capabilities") ?: JSONArray()
        val descriptors = buildList {
            for (index in 0 until minOf(values.length(), MAX_CAPABILITIES)) {
                val value = values.getJSONObject(index)
                val scopes = value.optJSONObject("scopes") ?: JSONObject()
                add(
                    CapabilityDescriptor(
                        id = value.getString("id").trim(),
                        versions = parseVersions(value.optJSONArray("versions")),
                        availability = when (value.getString("availability")) {
                            "available" -> CapabilityAvailability.AVAILABLE
                            "unavailable" -> CapabilityAvailability.UNAVAILABLE
                            else -> throw IllegalArgumentException("Unsupported capability availability.")
                        },
                        freshness = when (value.optString("freshness", "unknown")) {
                            "live" -> CapabilityFreshness.LIVE
                            "cached" -> CapabilityFreshness.CACHED
                            else -> CapabilityFreshness.UNKNOWN
                        },
                        periodScoped = scopes.optBoolean("period", false),
                        projectScoped = scopes.optBoolean("project", false),
                        workspaceScoped = scopes.optBoolean("workspace", false),
                        reason = value.optString("reason").trim().ifBlank { null },
                    ),
                )
            }
        }
        return CapabilityDiscovery(
            generatedAt = root.optString("generatedAt", "unknown").trim().ifBlank { "unknown" },
            capabilities = descriptors,
        )
    }

    private fun parseVersions(array: JSONArray?): List<Int> = buildList {
        require(array != null && array.length() in 1..4) { "Capability versions are missing." }
        for (index in 0 until array.length()) add(array.getInt(index))
    }
}
