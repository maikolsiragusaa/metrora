package eu.metrora.app.network

import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.PairingCredentials

internal object CompanionFoundationV1Parser {
    fun parse(
        raw: String,
        credentials: PairingCredentials,
        retrievedAtEpochMs: Long = System.currentTimeMillis(),
    ): MobileFoundationSnapshot = MobileFoundationSnapshot.fromJson(
        raw = raw,
        desktopId = credentials.serverFingerprint,
        retrievedAtEpochMs = retrievedAtEpochMs,
    )
}
