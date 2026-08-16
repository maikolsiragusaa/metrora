package eu.metrora.app.network

import eu.metrora.app.data.ActivityQuery
import eu.metrora.app.data.DetailCoverage
import eu.metrora.app.testCredentials
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityV1ParserTest {
    private val credentials = testCredentials()
    private val sourceProjectId = "sp_" + "a".repeat(64)
    private val otherSourceProjectId = "sp_" + "b".repeat(64)
    private val query = ActivityQuery(
        period = "month",
        projectScopeId = "mp_demo",
        provider = "claude",
        route = "anthropic-api",
        model = "claude-opus-4-6",
        source = sourceProjectId,
        limit = 1,
    )

    @Test
    fun parsesBoundedSessionsAndKeepsOpaqueCursor() {
        val page = ActivityV1Parser.parseSessions(sessionPage(), credentials, query)

        assertEquals(credentials.serverFingerprint, page.meta.desktopId)
        assertEquals(DetailCoverage.PARTIAL, page.meta.coverage)
        assertEquals(2L, page.meta.totalCount)
        assertEquals("opaque-cursor", page.meta.nextCursor)
        assertEquals("2026-08-01", page.meta.query.effectiveFrom)
        assertEquals("2026-08-15", page.meta.query.effectiveTo)
        assertEquals(sourceProjectId, page.meta.query.source)
        assertEquals("Session · 2026-08-14", page.sessions.single().title)
        assertEquals(35L, page.sessions.single().totalTokens)
        assertTrue(page.sessions.single().sourceProjectName == "metrora")
        assertEquals("claude-cli", page.sessions.single().sourceIds.single())
    }

    @Test
    fun rejectsAResponseBoundToAnotherScopeOrFilter() {
        assertThrows(IllegalArgumentException::class.java) {
            ActivityV1Parser.parseSessions(sessionPage(), credentials, query.copy(projectScopeId = "all"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ActivityV1Parser.parseSessions(sessionPage(), credentials, query.copy(model = "different"))
        }
    }

    @Test
    fun rejectsSessionsFromAnotherSourceProject() {
        val response = sessionPage().replace(
            "\"sourceProjectId\":\"$sourceProjectId\"",
            "\"sourceProjectId\":\"$otherSourceProjectId\"",
        )
        assertThrows(IllegalArgumentException::class.java) {
            ActivityV1Parser.parseSessions(response, credentials, query)
        }
    }

    @Test
    fun parsesDetailWithoutTurningUnavailableFieldsIntoZero() {
        val detail = ActivityV1Parser.parseSessionDetail(detailPage(), credentials, query)

        assertEquals(60_000L, detail.durationMs)
        assertEquals(10L, detail.inputTokens)
        assertNull(detail.reasoningTokens)
        assertEquals(DetailCoverage.PARTIAL, detail.detailCoverage)
    }

    @Test
    fun preservesUnavailableAccountingAndUnknownIdentityWithoutInference() {
        val raw = sessionPage()
            .replace(
                "\"provider\":\"claude\",\"route\":\"anthropic-api\",\"model\":\"claude-opus-4-6\",\"source\":\"$sourceProjectId\",",
                "",
            )
            .replace("\"sourceIds\":[\"claude-cli\"],\"routeIds\":[\"anthropic-api\"],\"brandIds\":[\"anthropic\"],\"models\":[\"claude-opus-4-6\"]", "\"sourceIds\":[],\"routeIds\":[],\"brandIds\":[],\"models\":[]")
            .replace("\"costMicrosUsd\":1500000", "\"costMicrosUsd\":null")
            .replace("\"totalTokens\":35", "\"totalTokens\":null")
        val page = ActivityV1Parser.parseSessions(
            raw,
            credentials,
            ActivityQuery(period = "month", projectScopeId = "mp_demo", limit = 1),
        )

        assertNull(page.sessions.single().costMicrosUsd)
        assertNull(page.sessions.single().totalTokens)
        assertTrue(page.sessions.single().sourceIds.isEmpty())
        assertTrue(page.sessions.single().routeIds.isEmpty())
        assertTrue(page.sessions.single().models.isEmpty())
    }

    @Test
    fun keepsPullRequestAttributionSplitAndApproximateMarker() {
        val page = ActivityV1Parser.parsePullRequests(pullRequestPage(), credentials, query)

        assertEquals(1_500_000L, page.attributedCostMicrosUsd)
        assertEquals(250_000L, page.unattributedCostMicrosUsd)
        assertEquals("acme/repo#42", page.pullRequests.single().reference)
        assertEquals(true, page.pullRequests.single().approximate)
        assertEquals(DetailCoverage.UNAVAILABLE, page.pullRequests.single().categoryCoverage)
    }

    @Test
    fun doesNotExposeRawPromptOrFilesystemFieldsThroughTheParsedRows() {
        val raw = sessionPage().replace(
            "\"endedAt\":\"2026-08-14T10:01:00.000Z\"",
            "\"endedAt\":\"2026-08-14T10:01:00.000Z\",\"prompt\":\"private prompt\",\"path\":\"C:/private/source\"",
        )
        val session = ActivityV1Parser.parseSessions(raw, credentials, query).sessions.single()
        assertTrue(session.title.startsWith("Session"))
        assertEquals(false, session.toString().contains("private prompt"))
        assertEquals(false, session.toString().contains("C:/private/source"))
    }

    @Test
    fun rejectsSourceProjectFilesystemPaths() {
        val raw = sessionPage().replace(
            "\"sourceProjectName\":\"metrora\"",
            "\"sourceProjectName\":\"C:/private/source\"",
        )
        assertThrows(IllegalArgumentException::class.java) {
            ActivityV1Parser.parseSessions(raw, credentials, query)
        }
    }

    private fun sessionPage(): String = """
        {
          "kind":"metrora.companion.activity.sessions",
          "version":1,
          "desktopId":"${credentials.serverFingerprint}",
          "generatedAt":"2026-08-15T10:00:00.000Z",
          "query":{"period":"month","projectScopeId":"mp_demo","effectiveFrom":"2026-08-01","effectiveTo":"2026-08-15","provider":"claude","route":"anthropic-api","model":"claude-opus-4-6","source":"$sourceProjectId","order":"newest","limit":1},
          "freshness":"live",
          "coverage":"partial",
          "totalCount":2,
          "availableCount":1,
          "hasMore":true,
          "nextCursor":"opaque-cursor",
          "sessions":[{
            "id":"session_1","projectId":"mp_demo","sourceProjectId":"$sourceProjectId","sourceProjectName":"metrora","title":"Session · 2026-08-14",
            "sourceIds":["claude-cli"],"routeIds":["anthropic-api"],"brandIds":["anthropic"],"models":["claude-opus-4-6"],
            "costMicrosUsd":1500000,"estimatedCostMicrosUsd":null,"calls":2,"turns":1,"totalTokens":35,"tokenCoverage":"partial","pricingCoverage":"complete",
            "startedAt":"2026-08-14T10:00:00.000Z","endedAt":"2026-08-14T10:01:00.000Z"
          }]
        }
    """.trimIndent()

    private fun detailPage(): String = """
        {
          "kind":"metrora.companion.activity.session","version":1,"desktopId":"${credentials.serverFingerprint}","generatedAt":"2026-08-15T10:00:00.000Z",
          "query":{"period":"month","projectScopeId":"mp_demo","effectiveFrom":"2026-08-01","effectiveTo":"2026-08-15","provider":"claude","route":"anthropic-api","model":"claude-opus-4-6","source":"$sourceProjectId","order":"newest","limit":1},
          "session":{
            "id":"session_1","projectId":"mp_demo","sourceProjectId":"$sourceProjectId","sourceProjectName":"metrora","title":"Session · 2026-08-14",
            "sourceIds":["claude-cli"],"routeIds":["anthropic-api"],"brandIds":["anthropic"],"models":["claude-opus-4-6"],
            "costMicrosUsd":1500000,"estimatedCostMicrosUsd":null,"calls":2,"turns":1,"totalTokens":35,"tokenCoverage":"partial","pricingCoverage":"complete",
            "startedAt":"2026-08-14T10:00:00.000Z","endedAt":"2026-08-14T10:01:00.000Z",
            "durationMs":60000,"inputTokens":10,"outputTokens":25,"reasoningTokens":null,"cacheReadTokens":0,"cacheWriteTokens":0,"cacheReusePercent":0.0,
            "reasoningSemantics":"unavailable","detailCoverage":"partial"
          }
        }
    """.trimIndent()

    private fun pullRequestPage(): String = """
        {
          "kind":"metrora.companion.activity.pullRequests","version":1,"desktopId":"${credentials.serverFingerprint}","generatedAt":"2026-08-15T10:00:00.000Z",
          "query":{"period":"month","projectScopeId":"mp_demo","effectiveFrom":"2026-08-01","effectiveTo":"2026-08-15","provider":"claude","route":"anthropic-api","model":"claude-opus-4-6","source":"$sourceProjectId","order":"newest","limit":1},
          "freshness":"live","coverage":"partial","attributedCostMicrosUsd":1500000,"unattributedCostMicrosUsd":250000,"totalCount":1,"availableCount":1,"hasMore":false,
          "pullRequests":[{"id":"pr_1","reference":"acme/repo#42","url":"https://github.com/acme/repo/pull/42","dateFrom":"2026-08-14T10:00:00.000Z","dateTo":"2026-08-14T10:01:00.000Z","costMicrosUsd":1500000,"calls":2,"linkedSessionCount":1,"models":["claude-opus-4-6"],"approximate":true,"categoryCoverage":"unavailable"}]
        }
    """.trimIndent()
}
