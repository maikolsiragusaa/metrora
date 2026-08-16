package eu.metrora.app.security

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot

interface MetroraStore {
    suspend fun loadCredentials(): StorageRead<PairingCredentials>

    suspend fun saveCredentials(credentials: PairingCredentials)

    suspend fun loadSnapshot(): StorageRead<UsageSnapshot>

    suspend fun saveSnapshot(snapshot: UsageSnapshot)

    /** Commit the usage snapshot and its same-scope foundation as one cache transaction. */
    suspend fun saveSnapshotAndFoundation(snapshot: UsageSnapshot, foundation: MobileFoundationSnapshot?) {
        // Legacy/custom stores remain source-compatible; SecureStore overrides
        // this with one DataStore edit so production persistence is atomic.
        saveSnapshot(snapshot)
        if (foundation == null) clearFoundation() else saveFoundation(foundation)
    }

    /** Commit period domains and the independent Project catalog as one cache transaction. */
    suspend fun saveSnapshotFoundationAndCatalog(
        snapshot: UsageSnapshot,
        foundation: MobileFoundationSnapshot?,
        catalog: ProjectCatalogSnapshot?,
    ) {
        saveSnapshotAndFoundation(snapshot, foundation)
        // A missing catalog means that this Desktop did not expose the
        // additive endpoint (or the request was unavailable). Preserve an
        // already-valid catalog; only a newly fetched catalog can replace it.
        if (catalog != null) saveProjectCatalog(catalog)
    }

    /** Additive encrypted cache; old stores remain source-compatible. */
    suspend fun loadFoundation(): StorageRead<MobileFoundationSnapshot> = StorageRead.Missing

    suspend fun saveFoundation(foundation: MobileFoundationSnapshot) = Unit

    suspend fun clearCredentials()

    suspend fun clearSnapshot()

    suspend fun clearFoundation() = Unit

    /** Additive encrypted Project authority cache; old stores remain compatible. */
    suspend fun loadProjectCatalog(): StorageRead<ProjectCatalogSnapshot> = StorageRead.Missing

    suspend fun saveProjectCatalog(catalog: ProjectCatalogSnapshot) = Unit

    suspend fun clearProjectCatalog() = Unit

    suspend fun clearPairing()
}
