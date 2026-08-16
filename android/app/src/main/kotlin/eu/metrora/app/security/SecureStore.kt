package eu.metrora.app.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.ProjectCatalogSnapshot
import eu.metrora.app.data.StorageIssue
import eu.metrora.app.data.StorageRead
import eu.metrora.app.data.UsageSnapshot
import eu.metrora.app.data.ActivitySnapshot
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlinx.coroutines.flow.first

private val Context.metroraDataStore by preferencesDataStore(name = "metrora_secure_state")

class SecureStore(context: Context) : MetroraStore {
    private val dataStore = context.applicationContext.metroraDataStore

    override suspend fun loadCredentials(): StorageRead<PairingCredentials> =
        read(CREDENTIALS_KEY, PairingCredentials::fromJson)

    override suspend fun saveCredentials(credentials: PairingCredentials) {
        dataStore.edit { preferences -> preferences[CREDENTIALS_KEY] = encrypt(credentials.toJson()) }
    }

    override suspend fun loadSnapshot(): StorageRead<UsageSnapshot> =
        read(SNAPSHOT_KEY, UsageSnapshot::fromJson)

    override suspend fun saveSnapshot(snapshot: UsageSnapshot) {
        dataStore.edit { preferences -> preferences[SNAPSHOT_KEY] = encrypt(snapshot.toJson()) }
    }

    override suspend fun saveSnapshotAndFoundation(snapshot: UsageSnapshot, foundation: MobileFoundationSnapshot?) {
        dataStore.edit { preferences ->
            preferences[SNAPSHOT_KEY] = encrypt(snapshot.toJson())
            if (foundation == null) {
                preferences.remove(FOUNDATION_KEY)
            } else {
                preferences[FOUNDATION_KEY] = encrypt(foundation.toJson())
            }
        }
    }

    override suspend fun saveSnapshotFoundationAndCatalog(
        snapshot: UsageSnapshot,
        foundation: MobileFoundationSnapshot?,
        catalog: ProjectCatalogSnapshot?,
    ) {
        dataStore.edit { preferences ->
            preferences[SNAPSHOT_KEY] = encrypt(snapshot.toJson())
            if (foundation == null) preferences.remove(FOUNDATION_KEY)
            else preferences[FOUNDATION_KEY] = encrypt(foundation.toJson())
            if (catalog != null) preferences[PROJECT_CATALOG_KEY] = encrypt(catalog.toJson())
        }
    }

    override suspend fun loadFoundation(): StorageRead<MobileFoundationSnapshot> =
        read(FOUNDATION_KEY) { raw -> MobileFoundationSnapshot.fromJson(raw) }

    override suspend fun saveFoundation(foundation: MobileFoundationSnapshot) {
        dataStore.edit { preferences -> preferences[FOUNDATION_KEY] = encrypt(foundation.toJson()) }
    }

    override suspend fun clearCredentials() {
        dataStore.edit { preferences -> preferences.remove(CREDENTIALS_KEY) }
    }

    override suspend fun clearSnapshot() {
        dataStore.edit { preferences -> preferences.remove(SNAPSHOT_KEY) }
    }

    override suspend fun clearFoundation() {
        dataStore.edit { preferences -> preferences.remove(FOUNDATION_KEY) }
    }

    override suspend fun loadProjectCatalog(): StorageRead<ProjectCatalogSnapshot> =
        read(PROJECT_CATALOG_KEY) { raw -> ProjectCatalogSnapshot.fromJson(raw) }

    override suspend fun saveProjectCatalog(catalog: ProjectCatalogSnapshot) {
        dataStore.edit { preferences -> preferences[PROJECT_CATALOG_KEY] = encrypt(catalog.toJson()) }
    }

    override suspend fun clearProjectCatalog() {
        dataStore.edit { preferences -> preferences.remove(PROJECT_CATALOG_KEY) }
    }

    override suspend fun loadActivity(): StorageRead<ActivitySnapshot> =
        read(ACTIVITY_KEY) { raw -> ActivitySnapshot.fromJson(raw) }

    override suspend fun saveActivity(snapshot: ActivitySnapshot) {
        dataStore.edit { preferences -> preferences[ACTIVITY_KEY] = encrypt(snapshot.toJson()) }
    }

    override suspend fun clearActivity() {
        dataStore.edit { preferences -> preferences.remove(ACTIVITY_KEY) }
    }

    override suspend fun clearPairing() {
        dataStore.edit { preferences ->
            preferences.remove(CREDENTIALS_KEY)
            preferences.remove(SNAPSHOT_KEY)
            preferences.remove(FOUNDATION_KEY)
            preferences.remove(PROJECT_CATALOG_KEY)
            preferences.remove(ACTIVITY_KEY)
        }
    }

    private fun encrypt(plainText: String): String {
        return EncryptedStateCodec.encrypt(plainText, secretKeyForWrite())
    }

    private fun decrypt(encoded: String): String {
        return EncryptedStateCodec.decrypt(encoded, existingSecretKey() ?: throw KeyUnavailableException)
    }

    private suspend fun <T> read(
        key: androidx.datastore.preferences.core.Preferences.Key<String>,
        decode: (String) -> T,
    ): StorageRead<T> {
        val encoded = dataStore.data.first()[key] ?: return StorageRead.Missing
        return try {
            StorageRead.Present(decode(decrypt(encoded)))
        } catch (_: KeyUnavailableException) {
            StorageRead.Corrupted(StorageIssue.KEY_UNAVAILABLE)
        } catch (_: IllegalArgumentException) {
            StorageRead.Corrupted(StorageIssue.CORRUPTED)
        } catch (_: Exception) {
            StorageRead.Corrupted(StorageIssue.UNREADABLE)
        }
    }

    private fun existingSecretKey(): SecretKey? {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        return keyStore.getKey(ENCRYPTION_KEY_ALIAS, null) as? SecretKey
    }

    private fun secretKeyForWrite(): SecretKey {
        existingSecretKey()?.let { return it }
        val specification = KeyGenParameterSpec.Builder(
            ENCRYPTION_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
            .apply { init(specification) }
            .generateKey()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val ENCRYPTION_KEY_ALIAS = "metrora-mobile-state-v1"
        val CREDENTIALS_KEY = stringPreferencesKey("encrypted_pairing_credentials_v1")
        val SNAPSHOT_KEY = stringPreferencesKey("encrypted_usage_snapshot_v1")
        val FOUNDATION_KEY = stringPreferencesKey("encrypted_mobile_foundation_v1")
        val PROJECT_CATALOG_KEY = stringPreferencesKey("encrypted_project_catalog_v1")
        val ACTIVITY_KEY = stringPreferencesKey("encrypted_activity_cache_v1")
    }

    private object KeyUnavailableException : Exception()
}
