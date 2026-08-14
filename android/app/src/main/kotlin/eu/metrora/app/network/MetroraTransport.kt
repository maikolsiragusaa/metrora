package eu.metrora.app.network

data class MetroraResponse(
    val status: Int,
    val body: String,
    val serverFingerprint: String,
)

interface MetroraTransport {
    suspend fun request(
        host: String,
        port: Int,
        method: String,
        path: String,
        expectedFingerprint: String?,
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        readTimeoutMs: Int = DEFAULT_READ_TIMEOUT_MS,
    ): MetroraResponse

    companion object {
        const val DEFAULT_READ_TIMEOUT_MS = 20_000
        // Usage can require a cold full-period Desktop aggregation. Keep this
        // bounded, but do not make pairing/discovery/revocation wait longer.
        const val USAGE_READ_TIMEOUT_MS = 45_000
    }
}
