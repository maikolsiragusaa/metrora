package eu.metrora.app.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

const val CAPACITY_CONTRACT_VERSION = 1
const val CAPACITY_SCOPE_KEY = "desktop-provider-capacity"

private const val CAPACITY_KIND = "metrora.companion.capacity"
private const val MAX_CAPACITY_PROVIDERS = 5
private const val MAX_CAPACITY_WINDOWS = 8
private const val MAX_CAPACITY_DISPLAY_LENGTH = 80
private const val MAX_CAPACITY_TIMESTAMP_LENGTH = 80
private val CAPACITY_SAFE_ID = Regex("[a-zA-Z0-9_.:-]{1,120}")
private val CAPACITY_SAFE_DISPLAY = Regex("[A-Za-z0-9][A-Za-z0-9 .+()_:-]{0,79}")
private val CAPACITY_FINGERPRINT = Regex("[a-f0-9]{64}")
private val CAPACITY_OBSERVATION_ID = Regex("[a-f0-9]{64}")

enum class CapacityAvailability {
    AVAILABLE,
    UNAVAILABLE;

    companion object {
        fun fromWire(value: String?): CapacityAvailability = when (value?.trim()?.lowercase()) {
            "available" -> AVAILABLE
            "unavailable" -> UNAVAILABLE
            else -> throw IllegalArgumentException("Capacity availability is invalid.")
        }

        fun toWire(value: CapacityAvailability): String = value.name.lowercase()
    }
}

enum class CapacityFreshness {
    FRESH,
    STALE,
    UNAVAILABLE;

    companion object {
        fun fromWire(value: String?): CapacityFreshness = when (value?.trim()?.lowercase()) {
            "fresh" -> FRESH
            "stale" -> STALE
            "unavailable" -> UNAVAILABLE
            else -> throw IllegalArgumentException("Capacity freshness is invalid.")
        }

        fun toWire(value: CapacityFreshness): String = value.name.lowercase()
    }
}

enum class CapacityConnection {
    CONNECTED,
    DISCONNECTED,
    ACCESS_DENIED,
    LOADING,
    STALE,
    TRANSIENT_FAILURE,
    TERMINAL_FAILURE;

    companion object {
        fun fromWire(value: String?): CapacityConnection = when (value) {
            "connected" -> CONNECTED
            "disconnected" -> DISCONNECTED
            "accessDenied" -> ACCESS_DENIED
            "loading" -> LOADING
            "stale" -> STALE
            "transientFailure" -> TRANSIENT_FAILURE
            "terminalFailure" -> TERMINAL_FAILURE
            else -> throw IllegalArgumentException("Capacity connection is invalid.")
        }

        fun toWire(value: CapacityConnection): String = when (value) {
            CONNECTED -> "connected"
            DISCONNECTED -> "disconnected"
            ACCESS_DENIED -> "accessDenied"
            LOADING -> "loading"
            STALE -> "stale"
            TRANSIENT_FAILURE -> "transientFailure"
            TERMINAL_FAILURE -> "terminalFailure"
        }
    }
}

enum class CapacityProvider(val wireName: String, val displayName: String) {
    CLAUDE("claude", "Claude"),
    CODEX("codex", "Codex"),
    COPILOT("copilot", "GitHub Copilot"),
    KIMI("kimi", "Kimi Code"),
    ANTIGRAVITY("antigravity", "Antigravity");

    companion object {
        fun fromWire(value: String): CapacityProvider = entries.firstOrNull { it.wireName == value }
            ?: throw IllegalArgumentException("Capacity provider is invalid.")
    }
}

data class CapacitySource(
    val kind: String,
    val stability: String,
) {
    init {
        require(kind in setOf("provider-api", "provider-cli", "provider-loopback", "provider-internal-api")) {
            "Capacity source kind is invalid."
        }
        require(stability in setOf("documented", "provider-owned", "experimental")) {
            "Capacity source stability is invalid."
        }
    }
}

data class CapacityWindow(
    val id: String,
    val label: String,
    val usedPercent: Double,
    val remainingPercent: Double,
    val resetsAt: String?,
) {
    init {
        require(id.matches(CAPACITY_SAFE_ID)) { "Capacity window id is invalid." }
        require(safeCapacityDisplay(label)) { "Capacity window label is not privacy-safe." }
        require(usedPercent.isFinite() && usedPercent in 0.0..100.0) { "Capacity used percentage is invalid." }
        require(remainingPercent.isFinite() && remainingPercent in 0.0..100.0) { "Capacity remaining percentage is invalid." }
        require(kotlin.math.abs(usedPercent + remainingPercent - 100.0) < 0.01) {
            "Capacity percentages do not reconcile."
        }
        require(resetsAt == null || safeCapacityTimestamp(resetsAt)) { "Capacity reset timestamp is invalid." }
    }
}

data class CapacityCredits(
    val balance: Double,
    val currency: String = "USD",
) {
    init {
        require(balance.isFinite() && balance >= 0.0) { "Capacity credits cannot be negative." }
        require(currency == "USD") { "Capacity credit currency is invalid." }
    }
}

data class CapacityProviderSnapshot(
    val provider: CapacityProvider,
    val availability: CapacityAvailability,
    val connection: CapacityConnection,
    val freshness: CapacityFreshness,
    val observedAt: String?,
    val planLabel: String?,
    val windows: List<CapacityWindow>,
    val credits: CapacityCredits?,
    val source: CapacitySource?,
) {
    init {
        require(observedAt == null || safeCapacityTimestamp(observedAt)) { "Capacity observation timestamp is invalid." }
        require(planLabel == null || safeCapacityDisplay(planLabel)) { "Capacity plan label is not privacy-safe." }
        require(windows.size <= MAX_CAPACITY_WINDOWS) { "Too many capacity windows." }
        val facts = hasFacts
        when (freshness) {
            CapacityFreshness.FRESH -> require(
                facts && availability == CapacityAvailability.AVAILABLE &&
                    connection == CapacityConnection.CONNECTED && observedAt != null,
            ) { "Fresh capacity facts are inconsistent." }
            CapacityFreshness.STALE -> require(
                facts && availability == CapacityAvailability.UNAVAILABLE &&
                    (connection == CapacityConnection.STALE || connection == CapacityConnection.TRANSIENT_FAILURE) && observedAt != null,
            ) { "Stale capacity facts are inconsistent." }
            CapacityFreshness.UNAVAILABLE -> require(
                !facts && availability == CapacityAvailability.UNAVAILABLE && observedAt == null,
            ) { "Unavailable capacity cannot carry quota facts." }
        }
    }

    val hasFacts: Boolean
        get() = windows.isNotEmpty() || credits != null || planLabel != null

    fun asLocallyCached(): CapacityProviderSnapshot = if (!hasFacts) {
        this
    } else {
        copy(
            availability = CapacityAvailability.UNAVAILABLE,
            connection = if (freshness == CapacityFreshness.FRESH) CapacityConnection.STALE else connection,
            freshness = CapacityFreshness.STALE,
        )
    }
}

data class CapacitySnapshot(
    val desktopId: String,
    val contractVersion: Int,
    val scopeKey: String,
    val generatedAtEpochMs: Long,
    val retrievedAtEpochMs: Long,
    val observationId: String,
    val freshness: CapacityFreshness,
    val available: Boolean,
    val providers: List<CapacityProviderSnapshot>,
) {
    init {
        require(desktopId.isNotBlank()) { "Capacity Desktop identity is missing." }
        require(contractVersion == CAPACITY_CONTRACT_VERSION) { "Capacity contract version is unsupported." }
        require(scopeKey == CAPACITY_SCOPE_KEY) { "Capacity scope is unsupported." }
        require(generatedAtEpochMs >= 0L && retrievedAtEpochMs >= 0L) { "Capacity timestamp is invalid." }
        require(observationId.matches(CAPACITY_OBSERVATION_ID)) { "Capacity observation identity is invalid." }
        require(providers.size <= MAX_CAPACITY_PROVIDERS) { "Too many capacity providers." }
        require(providers.map { it.provider }.toSet().size == providers.size) { "Capacity providers must be unique." }
        val expectedFreshness = when {
            providers.any { it.freshness == CapacityFreshness.FRESH } -> CapacityFreshness.FRESH
            providers.any { it.freshness == CapacityFreshness.STALE } -> CapacityFreshness.STALE
            else -> CapacityFreshness.UNAVAILABLE
        }
        require(freshness == expectedFreshness) { "Capacity freshness does not match provider facts." }
        require(available == providers.any { it.hasFacts }) { "Capacity availability does not match provider facts." }
    }

    fun isCompatible(desktopFingerprint: String): Boolean =
        desktopId == desktopFingerprint &&
            contractVersion == CAPACITY_CONTRACT_VERSION &&
            scopeKey == CAPACITY_SCOPE_KEY &&
            observationId.matches(CAPACITY_OBSERVATION_ID)

    fun asLocallyCached(): CapacitySnapshot = if (!available) {
        this
    } else {
        copy(
            freshness = CapacityFreshness.STALE,
            providers = providers.map { it.asLocallyCached() },
        )
    }

    fun toJson(): String = JSONObject()
        .put("kind", CAPACITY_KIND)
        .put("version", contractVersion)
        .put("desktopId", desktopId)
        .put("generatedAtEpochMs", generatedAtEpochMs)
        .put("retrievedAtEpochMs", retrievedAtEpochMs)
        .put("scopeKey", scopeKey)
        .put("observationId", observationId)
        .put("freshness", CapacityFreshness.toWire(freshness))
        .put("available", available)
        .put("providers", JSONArray().apply {
            providers.forEach { provider ->
                put(JSONObject()
                    .put("provider", provider.provider.wireName)
                    .put("displayName", provider.provider.displayName)
                    .put("availability", CapacityAvailability.toWire(provider.availability))
                    .put("connection", CapacityConnection.toWire(provider.connection))
                    .put("freshness", CapacityFreshness.toWire(provider.freshness))
                    .putOpt("observedAt", provider.observedAt)
                    .putOpt("planLabel", provider.planLabel)
                    .put("windows", JSONArray().apply {
                        provider.windows.forEach { window ->
                            put(JSONObject()
                                .put("id", window.id)
                                .put("label", window.label)
                                .put("usedPercent", window.usedPercent)
                                .put("remainingPercent", window.remainingPercent)
                                .putOpt("resetsAt", window.resetsAt))
                        }
                    })
                    .putOpt("credits", provider.credits?.let { credits ->
                        JSONObject().put("balance", credits.balance).put("currency", credits.currency)
                    })
                    .putOpt("source", provider.source?.let { source ->
                        JSONObject().put("kind", source.kind).put("stability", source.stability)
                    }))
            }
        })
        .toString()

    companion object {
        fun unavailable(desktopId: String = "unknown", retrievedAtEpochMs: Long = System.currentTimeMillis()): CapacitySnapshot =
            CapacitySnapshot(
                desktopId = desktopId,
                contractVersion = CAPACITY_CONTRACT_VERSION,
                scopeKey = CAPACITY_SCOPE_KEY,
                generatedAtEpochMs = 0L,
                retrievedAtEpochMs = retrievedAtEpochMs.coerceAtLeast(0L),
                observationId = "0".repeat(64),
                freshness = CapacityFreshness.UNAVAILABLE,
                available = false,
                providers = emptyList(),
            )

        fun fromJson(raw: String): CapacitySnapshot {
            val root = JSONObject(raw)
            require(root.optString("kind") == CAPACITY_KIND) { "Unsupported Capacity cache." }
            val version = root.getInt("version")
            require(version == CAPACITY_CONTRACT_VERSION) { "Unsupported Capacity cache version." }
            val providers = buildList {
                val array = root.optJSONArray("providers") ?: JSONArray()
                for (index in 0 until minOf(array.length(), MAX_CAPACITY_PROVIDERS)) {
                    add(parseProvider(array.getJSONObject(index)))
                }
            }
            return CapacitySnapshot(
                desktopId = root.getString("desktopId").trim(),
                contractVersion = version,
                scopeKey = root.getString("scopeKey").trim(),
                generatedAtEpochMs = root.getLong("generatedAtEpochMs"),
                retrievedAtEpochMs = root.getLong("retrievedAtEpochMs"),
                observationId = root.getString("observationId").trim(),
                freshness = CapacityFreshness.fromWire(root.getString("freshness")),
                available = root.getBoolean("available"),
                providers = providers,
            )
        }

        private fun parseProvider(value: JSONObject): CapacityProviderSnapshot {
            val provider = CapacityProvider.fromWire(value.getString("provider").trim())
            require(value.getString("displayName") == provider.displayName) { "Capacity provider display mapping is invalid." }
            val windows = buildList {
                val array = value.optJSONArray("windows") ?: JSONArray()
                for (index in 0 until minOf(array.length(), MAX_CAPACITY_WINDOWS)) {
                    val window = array.getJSONObject(index)
                    add(
                        CapacityWindow(
                            id = window.getString("id").trim(),
                            label = window.getString("label").trim(),
                            usedPercent = window.getDouble("usedPercent"),
                            remainingPercent = window.getDouble("remainingPercent"),
                            resetsAt = window.optNullableString("resetsAt"),
                        ),
                    )
                }
            }
            val credits = value.optJSONObject("credits")?.let { credit ->
                CapacityCredits(
                    balance = credit.getDouble("balance"),
                    currency = credit.getString("currency"),
                )
            }
            val source = value.optJSONObject("source")?.let { raw ->
                CapacitySource(raw.getString("kind"), raw.getString("stability"))
            }
            return CapacityProviderSnapshot(
                provider = provider,
                availability = CapacityAvailability.fromWire(value.getString("availability")),
                connection = CapacityConnection.fromWire(value.getString("connection")),
                freshness = CapacityFreshness.fromWire(value.getString("freshness")),
                observedAt = value.optNullableString("observedAt"),
                planLabel = value.optNullableString("planLabel"),
                windows = windows,
                credits = credits,
                source = source,
            )
        }

        private fun JSONObject.optNullableString(name: String): String? =
            if (!has(name) || isNull(name)) null else optString(name).trim().takeIf { it.isNotBlank() }
    }
}

private fun safeCapacityDisplay(value: String): Boolean =
    value.isNotBlank() && value.length <= MAX_CAPACITY_DISPLAY_LENGTH && CAPACITY_SAFE_DISPLAY.matches(value)

private fun safeCapacityTimestamp(value: String): Boolean =
    value.length <= MAX_CAPACITY_TIMESTAMP_LENGTH && runCatching { Instant.parse(value) }.isSuccess
