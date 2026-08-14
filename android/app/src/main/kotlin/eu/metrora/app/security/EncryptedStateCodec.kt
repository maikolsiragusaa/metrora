package eu.metrora.app.security

import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small pure-JVM-testable codec used by the Android Keystore-backed store. */
internal object EncryptedStateCodec {
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val FORMAT_VERSION = "v1"

    fun encrypt(plainText: String, secretKey: SecretKey): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val encrypted = cipher.doFinal(plainText.toByteArray(StandardCharsets.UTF_8))
        return listOf(
            FORMAT_VERSION,
            Base64.getEncoder().withoutPadding().encodeToString(cipher.iv),
            Base64.getEncoder().withoutPadding().encodeToString(encrypted),
        ).joinToString(":")
    }

    fun decrypt(encoded: String, secretKey: SecretKey): String {
        val parts = encoded.split(':', limit = 3)
        require(parts.size == 3 && parts[0] == FORMAT_VERSION) { "Unsupported encrypted state." }
        val iv = Base64.getDecoder().decode(parts[1])
        val encrypted = Base64.getDecoder().decode(parts[2])
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(encrypted).toString(StandardCharsets.UTF_8)
    }
}
