package eu.metrora.app.network

import eu.metrora.app.data.ActivityQuery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ProtocolTest {
    @Test
    fun exposesStableV1Routes() {
        assertEquals("/api/v1/peer/hello", MetroraProtocol.HELLO_PATH)
        assertEquals("/api/v1/peer/pair-request", MetroraProtocol.PAIR_REQUEST_PATH)
        assertEquals("/api/v1/peer/revoke", MetroraProtocol.REVOKE_PATH)
        assertEquals("/api/v1/capabilities", MetroraProtocol.CAPABILITIES_PATH)
        assertEquals("/api/v1/foundation", MetroraProtocol.FOUNDATION_PATH)
        assertEquals("/api/v1/projects", MetroraProtocol.PROJECTS_PATH)
        assertEquals("/api/v1/projects", MetroraProtocol.projectCatalogPath())
        assertEquals("/api/v1/usage?period=month", MetroraProtocol.usagePath("month"))
        assertEquals(
            "/api/v1/usage?period=all&granularity=week",
            MetroraProtocol.usagePath("all", "week"),
        )
        assertEquals("metrora.companion.usage", MetroraProtocol.USAGE_KIND)
        assertEquals("metrora.companion.capabilities", MetroraProtocol.CAPABILITIES_KIND)
    }

    @Test
    fun maps_every_supported_period_without_aliasing_lifetime() {
        val periods = listOf("today", "week", "30days", "month", "all", "lifetime")
        periods.forEach { period ->
            assertEquals("/api/v1/usage?period=$period", MetroraProtocol.usagePath(period))
        }
    }

    @Test
    fun projectScopeIsAnAdditiveCanonicalQuery() {
        assertEquals(
            "/api/v1/usage?period=month&granularity=week&projectScopeId=mp_project",
            MetroraProtocol.usagePath("month", "week", "mp_project"),
        )
        assertEquals(
            "/api/v1/foundation?period=month&projectScopeId=unassigned",
            MetroraProtocol.foundationPath("month", projectScopeId = "unassigned"),
        )
        assertThrows(IllegalArgumentException::class.java) {
            MetroraProtocol.usagePath("month", projectScopeId = "C:\\private")
        }
    }

    @Test
    fun activityPathsBindEveryQueryDimensionAndKeepCursorOpaque() {
        val sourceProjectId = "sp_" + "a".repeat(64)
        val query = ActivityQuery(
            period = "month",
            projectScopeId = "mp_project",
            provider = "claude",
            route = "anthropic-api",
            model = "claude opus/4",
            source = sourceProjectId,
            order = "cost",
            limit = 25,
        )
        val page = MetroraProtocol.activitySessionsPath(query, "opaque.cursor/value")
        assertEquals(
            "/api/v1/activity/sessions?period=month&order=cost&limit=25&projectScopeId=mp_project&provider=claude&route=anthropic-api&model=claude%20opus%2F4&source=$sourceProjectId&cursor=opaque.cursor%2Fvalue",
            page,
        )
        assertEquals(
            "/api/v1/activity/sessions/session_1?period=month&order=cost&limit=25&projectScopeId=mp_project&provider=claude&route=anthropic-api&model=claude%20opus%2F4&source=$sourceProjectId",
            MetroraProtocol.activitySessionDetailPath(query, "session_1"),
        )
        assertEquals(
            "/api/v1/activity/pull-requests?period=month&order=cost&limit=25&projectScopeId=mp_project&provider=claude&route=anthropic-api&model=claude%20opus%2F4&source=$sourceProjectId",
            MetroraProtocol.activityPullRequestsPath(query),
        )
    }

    @Test
    fun validatesConnectionInput() {
        assertEquals("192.168.1.24", MetroraProtocol.normalizeHost(" 192.168.1.24 "))
        assertEquals("fe80::1", MetroraProtocol.normalizeHost("[fe80::1]"))
        assertEquals(7777, MetroraProtocol.validatePort(7777))
    }

    @Test
    fun rejectsUrlsInvalidPortsAndUnknownPeriods() {
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.normalizeHost("https://desktop") }
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.validatePort(0) }
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.usagePath("year") }
        assertThrows(IllegalArgumentException::class.java) { MetroraProtocol.usagePath("month", "quarter") }
    }

    @Test
    fun normalizesSha256Fingerprint() {
        val raw = List(32) { "AB" }.joinToString(":")
        assertEquals("ab".repeat(32), MetroraProtocol.normalizeFingerprint(raw))
    }

    @Test
    fun derivesTheSameSixDigitSasAsDesktop() {
        assertEquals("404542", MetroraProtocol.pairingCode("00".repeat(32), "ff".repeat(32)))
        assertEquals("404542", MetroraProtocol.pairingCode("ff".repeat(32), "00".repeat(32)))
    }
}
