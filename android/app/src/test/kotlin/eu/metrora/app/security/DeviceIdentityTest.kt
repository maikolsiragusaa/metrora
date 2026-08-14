package eu.metrora.app.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceIdentityTest {
    @Test
    fun sha256_only_identity_requires_tls_digest_upgrade() {
        assertTrue(requiresTlsDigestUpgrade(arrayOf("SHA-256")))
    }

    @Test
    fun identity_with_raw_tls_digest_does_not_require_upgrade() {
        assertFalse(requiresTlsDigestUpgrade(arrayOf("NONE", "SHA-256")))
    }
}
