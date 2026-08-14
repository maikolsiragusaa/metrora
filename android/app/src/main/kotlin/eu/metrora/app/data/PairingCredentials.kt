package eu.metrora.app.data

import org.json.JSONObject

data class PairingCredentials(
    val host: String,
    val port: Int,
    val desktopName: String,
    val serverFingerprint: String,
    val clientFingerprint: String,
    val token: String,
    val pairedAtEpochMs: Long,
) {
    init {
        require(host.isNotBlank()) { "Desktop address is missing." }
        require(port in 1..65535) { "Desktop port is invalid." }
        require(desktopName.isNotBlank()) { "Desktop name is missing." }
        require(serverFingerprint.matches(FINGERPRINT_PATTERN)) { "Desktop identity is invalid." }
        require(clientFingerprint.matches(FINGERPRINT_PATTERN)) { "Phone identity is invalid." }
        require(token.isNotBlank()) { "Pairing credential is missing." }
        require(pairedAtEpochMs >= 0L) { "Pairing timestamp is invalid." }
    }

    fun toJson(): String = JSONObject()
        .put("host", host)
        .put("port", port)
        .put("desktopName", desktopName)
        .put("serverFingerprint", serverFingerprint)
        .put("clientFingerprint", clientFingerprint)
        .put("token", token)
        .put("pairedAtEpochMs", pairedAtEpochMs)
        .toString()

    companion object {
        private val FINGERPRINT_PATTERN = Regex("[0-9a-fA-F]{64}")

        fun fromJson(raw: String): PairingCredentials {
            try {
                val json = JSONObject(raw)
                return PairingCredentials(
                    host = json.getString("host"),
                    port = json.getInt("port"),
                    desktopName = json.getString("desktopName"),
                    serverFingerprint = json.getString("serverFingerprint"),
                    clientFingerprint = json.getString("clientFingerprint"),
                    token = json.getString("token"),
                    pairedAtEpochMs = json.getLong("pairedAtEpochMs"),
                )
            } catch (error: IllegalArgumentException) {
                throw error
            } catch (error: Exception) {
                throw IllegalArgumentException("Invalid pairing credentials.", error)
            }
        }
    }
}
