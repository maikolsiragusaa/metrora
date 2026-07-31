package io.github.maikolsiragusaa.qovrion.data

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
        fun fromJson(raw: String): PairingCredentials {
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
        }
    }
}
