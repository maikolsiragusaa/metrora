package eu.metrora.app.security

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot

interface MetroraStore {
    suspend fun loadCredentials(): StorageRead<PairingCredentials>

    suspend fun saveCredentials(credentials: PairingCredentials)

    suspend fun loadSnapshot(): StorageRead<UsageSnapshot>

    suspend fun saveSnapshot(snapshot: UsageSnapshot)

    suspend fun clearCredentials()

    suspend fun clearSnapshot()

    suspend fun clearPairing()
}
