package eu.metrora.app.network

import eu.metrora.app.data.CapacityFreshness
import eu.metrora.app.data.PairingCredentials
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class CompanionCapacityV1ParserTest {
    private val desktopFingerprint = "ab".repeat(32)

    @Test
    fun parses_fresh_stale_zero_and_unavailable_provider_states_without_secrets() {
        val snapshot = CompanionCapacityV1Parser.parse(payload(), credentials())

        assertEquals(desktopFingerprint, snapshot.desktopId)
        assertEquals(CapacityFreshness.FRESH, snapshot.freshness)
        assertEquals(0.0, snapshot.providers[0].windows[0].usedPercent, 0.0)
        assertEquals(100.0, snapshot.providers[0].windows[0].remainingPercent, 0.0)
        assertEquals(CapacityFreshness.STALE, snapshot.providers[1].freshness)
        assertEquals(CapacityFreshness.UNAVAILABLE, snapshot.providers[2].freshness)
        assertEquals("Claude", snapshot.providers[0].provider.displayName)
        assertFalse(snapshot.toJson().contains("secret-token"))
        assertFalse(snapshot.toJson().contains("account@example.com"))
    }

    @Test
    fun rejects_wrong_identity_scope_and_provider_display_mapping() {
        assertThrows(IllegalArgumentException::class.java) {
            CompanionCapacityV1Parser.parse(payload().replace(desktopFingerprint, "cd".repeat(32)), credentials())
        }
        assertThrows(IllegalArgumentException::class.java) {
            CompanionCapacityV1Parser.parse(payload().replace("desktop-provider-capacity", "month"), credentials())
        }
        assertThrows(IllegalArgumentException::class.java) {
            CompanionCapacityV1Parser.parse(payload().replace("\"displayName\":\"Claude\"", "\"displayName\":\"private-account\""), credentials())
        }
    }

    private fun credentials() = PairingCredentials(
        host = "desktop.local",
        port = 7777,
        desktopName = "Metrora Desktop",
        serverFingerprint = desktopFingerprint,
        clientFingerprint = "cd".repeat(32),
        token = "token",
        pairedAtEpochMs = 1L,
    )

    private fun payload(): String = """
        {
          "kind":"metrora.companion.capacity",
          "version":1,
          "desktopId":"$desktopFingerprint",
          "generatedAt":"2026-08-14T10:00:00Z",
          "scope":{"id":"desktop-provider-capacity"},
          "observationId":"${"11".repeat(32)}",
          "freshness":"fresh",
          "available":true,
          "providers":[
            {
              "provider":"claude","displayName":"Claude","availability":"available","connection":"connected","freshness":"fresh","observedAt":"2026-08-14T10:00:00Z","planLabel":"Pro","accountEmail":"account@example.com","accessToken":"secret-token",
              "windows":[{"id":"primary","label":"5 hour","usedPercent":0,"remainingPercent":100,"resetsAt":null}],"credits":{"balance":0,"currency":"USD"}
            },
            {
              "provider":"codex","displayName":"Codex","availability":"unavailable","connection":"transientFailure","freshness":"stale","observedAt":"2026-08-14T09:00:00Z","planLabel":"Plus","windows":[{"id":"weekly","label":"Weekly","usedPercent":50,"remainingPercent":50,"resetsAt":"2026-08-21T09:00:00Z"}],"credits":null
            },
            {
              "provider":"copilot","displayName":"GitHub Copilot","availability":"unavailable","connection":"connected","freshness":"unavailable","observedAt":null,"planLabel":null,"windows":[],"credits":null
            }
          ]
        }
    """.trimIndent()
}
