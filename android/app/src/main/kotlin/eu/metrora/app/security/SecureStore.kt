package eu.metrora.app.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.first

private val Context.metroraDataStore by preferencesDataStore(name = "metrora_secure_state")

class SecureStore(context: Context) {
    private val dataStore = context.applicationContext.metroraDataStore

    suspend fun loadCredentials(): PairingCredentials? =
        dataStore.data.first()[CREDENTIALS_KEY]?.let { PairingCredentials.fromJson(decrypt(it)) }

    suspend fun saveCredentials(credentials: PairingCredentials) {
        dataStore.edit { preferences -> preferences[CREDENTIALS_KEY] = encrypt(credentials.toJson()) }
    }

    suspend fun loadSnapshot(): UsageSnapshot? =
        dataStore.data.first()[SNAPSHOT_KEY]?.let { UsageSnapshot.fromJson(decrypt(it)) }

    suspend fun saveSnapshot(snapshot: UsageSnapshot) {
        dataStore.edit { preferences -> preferences[SNAPSHOT_KEY] = encrypt(snapshot.toJson()) }
    }

    suspend fun clearPairing() {
        dataStore.edit { preferences ->
            preferences.remove(CREDENTIALS_KEY)
            preferences.remove(SNAPSHOT_KEY)
        }
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return listOf(
            FORMAT_VERSION,
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(encrypted, Base64.NO_WRAP),
        ).joinToString(":")
    }

    private fun decrypt(encoded: String): String {
        val parts = encoded.split(':', limit = 3)
        require(parts.size == 3 && parts[0] == FORMAT_VERSION) { "Unsupported encrypted state." }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val encrypted = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (keyStore.getKey(ENCRYPTION_KEY_ALIAS, null) as? SecretKey)?.let { return it }
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
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        const val FORMAT_VERSION = "v1"
        val CREDENTIALS_KEY = stringPreferencesKey("encrypted_pairing_credentials_v1")
        val SNAPSHOT_KEY = stringPreferencesKey("encrypted_usage_snapshot_v1")
    }
}
