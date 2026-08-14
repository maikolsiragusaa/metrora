package eu.metrora.app.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.util.Date
import java.util.Locale
import javax.security.auth.x500.X500Principal

interface ClientIdentity {
    fun material(): IdentityMaterial

    fun fingerprint(): String = material().fingerprint
}

class DeviceIdentity : ClientIdentity {
    override fun material(): IdentityMaterial {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        if (!keyStore.containsAlias(KEY_ALIAS)) generateKeyPair()
        val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            ?: error("Metrora client identity is unavailable.")
        val certificate = entry.certificate as? X509Certificate
            ?: error("Metrora client certificate is unavailable.")
        return IdentityMaterial(
            alias = KEY_ALIAS,
            privateKey = entry.privateKey,
            certificate = certificate,
            fingerprint = certificateFingerprint(certificate),
        )
    }

    override fun fingerprint(): String = material().fingerprint

    private fun generateKeyPair() {
        val now = System.currentTimeMillis()
        val serial = BigInteger(128, SecureRandom()).abs().max(BigInteger.ONE)
        val specification = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setCertificateSubject(X500Principal("CN=Metrora Android"))
            .setCertificateSerialNumber(serial)
            .setCertificateNotBefore(Date(now - ONE_DAY_MS))
            .setCertificateNotAfter(Date(now + TEN_YEARS_MS))
            .setUserAuthenticationRequired(false)
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE)
            .apply { initialize(specification) }
            .generateKeyPair()
    }

    companion object {
        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "metrora-mobile-client-v1"
        private const val ONE_DAY_MS = 24L * 60L * 60L * 1000L
        private const val TEN_YEARS_MS = 3650L * ONE_DAY_MS

        fun certificateFingerprint(certificate: X509Certificate): String =
            MessageDigest.getInstance("SHA-256")
                .digest(certificate.encoded)
                .joinToString("") { byte -> String.format(Locale.US, "%02x", byte.toInt() and 0xff) }
    }
}

data class IdentityMaterial(
    val alias: String,
    val privateKey: PrivateKey,
    val certificate: X509Certificate,
    val fingerprint: String,
)
