package eu.metrora.app.security

import eu.metrora.app.data.PairingCredentials
import eu.metrora.app.data.UsageSnapshot
import java.util.Base64
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EncryptedStateCodecTest {
    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    @Test
    fun encrypted_snapshot_round_trips_without_plaintext_storage_contract_changes() {
        val snapshot = UsageSnapshot(
            desktopId = "ab".repeat(32),
            desktopName = "Desktop",
            generatedAtEpochMs = 10L,
            periodLabel = "Today",
            costMicrosUsd = 12L,
            calls = 1L,
            sessions = 1L,
            inputTokens = 2L,
            outputTokens = 3L,
            cacheReadTokens = 4L,
            cacheWriteTokens = 5L,
            cacheHitPercent = 50.0,
            topModels = emptyList(),
            retrievedAtEpochMs = 11L,
        )
        val encoded = EncryptedStateCodec.encrypt(snapshot.toJson(), key)

        assertEquals(snapshot, UsageSnapshot.fromJson(EncryptedStateCodec.decrypt(encoded, key)))
    }

    @Test
    fun tampered_ciphertext_is_rejected() {
        val encoded = EncryptedStateCodec.encrypt("secret snapshot", key)
        val parts = encoded.split(':')
        val bytes = Base64.getDecoder().decode(parts[2])
        bytes[0] = (bytes[0].toInt() xor 1).toByte()
        val tampered = "${parts[0]}:${parts[1]}:${Base64.getEncoder().withoutPadding().encodeToString(bytes)}"

        assertThrows(Exception::class.java) { EncryptedStateCodec.decrypt(tampered, key) }
    }

    @Test
    fun credential_and_snapshot_json_reject_partial_security_state() {
        assertThrows(IllegalArgumentException::class.java) {
            PairingCredentials.fromJson("{\"host\":\"desktop\"}")
        }
        assertThrows(IllegalArgumentException::class.java) {
            UsageSnapshot.fromJson("{\"desktopId\":\"x\",\"desktopName\":\"D\",\"generatedAtEpochMs\":1,\"periodLabel\":\"Today\",\"costMicrosUsd\":-1,\"calls\":0,\"sessions\":0,\"inputTokens\":0,\"outputTokens\":0,\"cacheReadTokens\":0,\"cacheWriteTokens\":0,\"cacheHitPercent\":0}")
        }
    }

    @Test
    fun legacy_snapshot_json_defaults_new_model_and_trend_fields() {
        val snapshot = UsageSnapshot.fromJson(
            """
            {
              "desktopId":"ab${"ab".repeat(31)}",
              "desktopName":"Desktop",
              "generatedAtEpochMs":1,
              "periodLabel":"Today",
              "costMicrosUsd":12,
              "calls":1,
              "sessions":1,
              "inputTokens":2,
              "outputTokens":3,
              "cacheReadTokens":4,
              "cacheWriteTokens":5,
              "cacheHitPercent":50.0,
              "topModels":[{"name":"Model A","calls":1,"costMicrosUsd":12}]
            }
            """.trimIndent(),
        )

        assertEquals(snapshot.topModels, snapshot.models)
        assertEquals("day", snapshot.costTrendGranularity)
        assertEquals("Today", snapshot.costTrendPeriodLabel)
        assertEquals(emptyList<Any>(), snapshot.costTrend)
    }
}
