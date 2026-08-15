package eu.metrora.app.network

import eu.metrora.app.data.CapabilityAvailability
import eu.metrora.app.data.MobileFoundationSnapshot
import eu.metrora.app.data.PairingCredentials
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionFoundationV1ParserTest {
    private val desktopFingerprint = "ab".repeat(32)

    @Test
    fun parsesProjectActivityAnalyzeAndSpendAsBoundedMetadata() {
        val snapshot = CompanionFoundationV1Parser.parse(foundationJson(), credentials())

        assertTrue(snapshot.available)
        assertEquals(desktopFingerprint, snapshot.desktopId)
        assertEquals("mp_project", snapshot.projectScopeId)
        assertEquals("Metrora", snapshot.projectOptions.single { it.id == "mp_project" }.name)
        assertEquals("metrora", snapshot.sourceProjects.single().name)
        assertEquals("Session · 2026-08-14", snapshot.activitySessions.single().title)
        assertEquals("openai", snapshot.analyzeModels.single().brandId)
        assertEquals(1, snapshot.spend?.trend?.size)
        assertTrue(snapshot.capabilities.isAvailable("activity.sessions"))
        assertFalse(snapshot.capabilities.isAvailable("workspace"))
        assertEquals(CapabilityAvailability.UNAVAILABLE, snapshot.capabilities.capabilities.single { it.id == "workspace" }.availability)
    }

    @Test
    fun roundTripKeepsFoundationIdentityAndBoundedRows() {
        val original = CompanionFoundationV1Parser.parse(foundationJson(), credentials())
        val restored = MobileFoundationSnapshot.fromJson(original.toJson())

        assertEquals(original.desktopId, restored.desktopId)
        assertEquals(original.projectOptions, restored.projectOptions)
        assertEquals(original.activitySessions, restored.activitySessions)
        assertEquals(original.analyzeModels, restored.analyzeModels)
        assertEquals(original.spend, restored.spend)
    }

    @Test
    fun privacyUnsafeSourceNamesAreRejected() {
        val unsafe = foundationJson().replace("\"name\":\"metrora\"", "\"name\":\"C:\\\\private\\\\metrora\"")

        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            CompanionFoundationV1Parser.parse(unsafe, credentials())
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

    private fun foundationJson(): String = """
        {
          "kind":"metrora.companion.foundation",
          "version":1,
          "generatedAt":"2026-08-14T10:00:00.000Z",
          "projectScope":{
            "selectedId":"mp_project",
            "options":[
              {"id":"all","name":"All projects","icon":"grid","color":"cyan","sourceProjectCount":1},
              {"id":"unassigned","name":"Unassigned","icon":"stack","color":"violet","sourceProjectCount":0},
              {"id":"mp_project","name":"Metrora","icon":"spark","color":"cyan","sourceProjectCount":1}
            ],
            "sourceProjects":[
              {"id":"sp_source","name":"metrora","contributors":[{"sourceId":"codex","routeIds":["openai"]}],"assignedProjectId":"mp_project"}
            ]
          },
          "capabilities":{
            "kind":"metrora.companion.capabilities",
            "version":1,
            "generatedAt":"2026-08-14T10:00:00.000Z",
            "capabilities":[
              {"id":"activity.sessions","versions":[1],"availability":"available","freshness":"cached","scopes":{"period":true,"project":true,"workspace":false}},
              {"id":"workspace","versions":[1],"availability":"unavailable","freshness":"unknown","scopes":{"period":false,"project":false,"workspace":false},"reason":"no-authority"}
            ]
          },
          "activity":{"available":true,"freshness":"cached","sessions":[
            {"id":"sessionhash","projectId":"mp_project","sourceProjectId":"sp_source","sourceProjectName":"metrora","title":"Session · 2026-08-14","sourceIds":["codex"],"routeIds":["openai"],"brandIds":["openai"],"models":["gpt-test"],"costMicrosUsd":1250000,"calls":2,"turns":1,"startedAt":"2026-08-14T09:00:00.000Z","endedAt":"2026-08-14T09:01:00.000Z"}
          ]},
          "analyze":{"models":{"available":true,"freshness":"cached","rows":[
            {"name":"gpt-test","routeId":"openai","sourceIds":["codex"],"brandId":"openai","calls":2,"costMicrosUsd":1250000,"inputTokens":10,"outputTokens":20,"cacheReadTokens":0,"cacheWriteTokens":0}
          ]},"spend":{"available":true,"freshness":"cached","data":{"costMicrosUsd":1250000,"calls":2,"sessions":1,"trend":[{"date":"2026-08-14","costMicrosUsd":1250000}]}}},
          "workspace":{"available":false,"reason":"no-authority"}
        }
    """.trimIndent()
}

class CompanionCapabilitiesV1ParserTest {
    @Test
    fun unknownVersionFailsSafeWithoutInventingCapabilities() {
        val discovery = CompanionCapabilitiesV1Parser.parse(
            """{"kind":"metrora.companion.capabilities","version":2,"generatedAt":"later","capabilities":[]}""",
        )

        assertFalse(discovery.available)
        assertTrue(discovery.capabilities.isEmpty())
    }
}
