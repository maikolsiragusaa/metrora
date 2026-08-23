import Foundation
import Testing
@testable import MetroraMenubar

@Suite("Native provider quota parity")
struct ProviderQuotaSnapshotTests {
    private let observedAt = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("Codex preserves a factual zero credit balance")
    func zeroCreditsRemainFactual() throws {
        let usage = CodexUsage(
            plan: .plus,
            primary: .init(usedPercent: 0, resetsAt: observedAt.addingTimeInterval(3600), limitWindowSeconds: 18_000),
            secondary: nil,
            additionalLimits: [],
            creditsBalance: 0,
            resetCredits: nil,
            fetchedAt: observedAt
        )

        let snapshot = ProviderQuotaSnapshotAdapter.codex(usage: usage, state: .loaded)

        #expect(snapshot.availability == .available)
        #expect(snapshot.freshness == .fresh)
        #expect(snapshot.observedAt == observedAt)
        #expect(snapshot.credits?.balance == 0)
        #expect(snapshot.windows.first?.usedFraction == 0)
        #expect(snapshot.windows.first?.windowSeconds == 18_000)
    }

    @Test("failed refresh retains the provider observation but is unavailable")
    func staleObservationIsExplicit() {
        let usage = CodexUsage(
            plan: .plus,
            primary: .init(usedPercent: 42, resetsAt: observedAt.addingTimeInterval(3600), limitWindowSeconds: 18_000),
            secondary: nil,
            additionalLimits: [],
            creditsBalance: 0,
            resetCredits: nil,
            fetchedAt: observedAt
        )
        let retryAt = observedAt.addingTimeInterval(300)

        let snapshot = ProviderQuotaSnapshotAdapter.codex(
            usage: usage,
            state: .transientFailure(retryAt: retryAt)
        )

        #expect(snapshot.availability == .unavailable)
        #expect(snapshot.freshness == .stale)
        #expect(snapshot.connection == .transientFailure)
        #expect(snapshot.observedAt == observedAt)
        #expect(snapshot.windows.first?.usedFraction == 0.42)
        #expect(snapshot.credits?.balance == 0)
        #expect(snapshot.rateLimit.state == .backoff)
        #expect(snapshot.rateLimit.retryAt == retryAt)
    }

    @Test("a connected response without provider facts is unavailable, never zero")
    func noFactsAreNotZero() {
        let usage = SubscriptionUsage(
            tier: .unknown,
            rawTier: nil,
            fiveHourPercent: nil,
            fiveHourResetsAt: nil,
            sevenDayPercent: nil,
            sevenDayResetsAt: nil,
            sevenDayOpusPercent: nil,
            sevenDayOpusResetsAt: nil,
            sevenDaySonnetPercent: nil,
            sevenDaySonnetResetsAt: nil,
            scopedWeekly: [],
            fetchedAt: observedAt
        )

        let snapshot = ProviderQuotaSnapshotAdapter.claude(usage: usage, state: .loaded)

        #expect(snapshot.availability == .unavailable)
        #expect(snapshot.freshness == .unavailable)
        #expect(snapshot.observedAt == nil)
        #expect(snapshot.planLabel == nil)
        #expect(snapshot.windows.isEmpty)
        #expect(snapshot.credits == nil)
    }

    @Test("an empty Claude raw tier without quota facts is unavailable")
    func emptyClaudeRawTierIsNotAProviderFact() {
        assertBlankClaudeRawTierIsUnavailable("")
    }

    @Test("a whitespace Claude raw tier without quota facts is unavailable")
    func whitespaceClaudeRawTierIsNotAProviderFact() {
        assertBlankClaudeRawTierIsUnavailable(" \t\n ")
    }

    @Test("native payload has no credential or account fields")
    func payloadAllowlistExcludesSecrets() throws {
        let usage = CodexUsage(
            plan: .plus,
            primary: .init(usedPercent: 10, resetsAt: nil, limitWindowSeconds: 18_000),
            secondary: nil,
            additionalLimits: [],
            creditsBalance: 0,
            resetCredits: nil,
            fetchedAt: observedAt
        )
        let snapshot = ProviderQuotaSnapshotAdapter.codex(usage: usage, state: .loaded)
        let data = try JSONEncoder().encode(snapshot)
        let json = String(decoding: data, as: UTF8.self)

        #expect(!json.contains("accessToken"))
        #expect(!json.contains("refreshToken"))
        #expect(!json.contains("accountId"))
        #expect(!json.contains("account_id"))
        #expect(!json.contains("credential"))
    }

    @Test("diagnostics redact token, account and local path material")
    func diagnosticsAreSanitized() {
        let raw = #"HTTP 401 Bearer super-secret-token {"account_id":"acct_123","refresh_token":"refresh-secret"} /Users/alice/.codex/auth.json"#
        let sanitized = ProviderQuotaDiagnostics.sanitize(raw) ?? ""

        #expect(!sanitized.contains("super-secret-token"))
        #expect(!sanitized.contains("acct_123"))
        #expect(!sanitized.contains("refresh-secret"))
        #expect(!sanitized.contains("/Users/alice"))
        #expect(sanitized.contains("[REDACTED]"))
    }

    private func assertBlankClaudeRawTierIsUnavailable(_ rawTier: String) {
        let usage = SubscriptionUsage(
            tier: .unknown,
            rawTier: rawTier,
            fiveHourPercent: nil,
            fiveHourResetsAt: nil,
            sevenDayPercent: nil,
            sevenDayResetsAt: nil,
            sevenDayOpusPercent: nil,
            sevenDayOpusResetsAt: nil,
            sevenDaySonnetPercent: nil,
            sevenDaySonnetResetsAt: nil,
            scopedWeekly: [],
            fetchedAt: observedAt
        )

        let snapshot = ProviderQuotaSnapshotAdapter.claude(usage: usage, state: .loaded)

        #expect(snapshot.availability == .unavailable)
        #expect(snapshot.freshness == .unavailable)
        #expect(snapshot.observedAt == nil)
        #expect(snapshot.planLabel == nil)
        #expect(snapshot.windows.isEmpty)
        #expect(snapshot.credits == nil)
    }
}
