import Foundation
import Testing
@testable import CodeBurnMenubar

private func usage(
    balance: Double? = nil,
    hasCredits: Bool = false,
    unlimited: Bool = false,
    creditLimit: CodexUsage.CreditLimit? = nil
) -> CodexUsage {
    CodexUsage(
        plan: .business,
        primary: nil,
        secondary: nil,
        additionalLimits: [],
        creditsBalance: balance,
        hasCredits: hasCredits,
        creditsUnlimited: unlimited,
        creditLimit: creditLimit,
        resetCredits: nil,
        fetchedAt: Date()
    )
}

private func limit(used: Double, of total: Double, reached: Bool = false) -> CodexUsage.CreditLimit {
    CodexUsage.CreditLimit(
        used: used,
        limit: total,
        usedPercent: used / total * 100,
        resetsAt: Date(timeIntervalSince1970: 1_785_542_400),
        windowSeconds: 31 * 86_400,
        reached: reached
    )
}

@MainActor
private func store(_ usage: CodexUsage) -> AppStore {
    let store = AppStore()
    store.codexUsage = usage
    // Pinned: the default depends on whether this machine has Codex connected.
    store.codexLoadState = .loaded
    return store
}

@MainActor
struct CodexQuotaSummaryTests {
    @Test("credit-settled balances group without a currency symbol")
    func creditSettledBalanceIsGroupedAndUnprefixed() {
        let store = store(usage(balance: 3410.4, hasCredits: true))
        #expect(store.quotaSummary(for: .codex)?.footerLines == ["Credits remaining · 3,410"])
    }

    @Test("dollar balances keep the currency formatting")
    func dollarBalanceKeepsCurrencyFormatting() {
        let store = store(usage(balance: 3410.4, hasCredits: false))
        #expect(store.quotaSummary(for: .codex)?.footerLines == ["Credits remaining · $3,410.40"])
    }

    @Test("an uncapped credit account says so instead of showing nothing")
    func uncappedAccountSaysUnlimited() {
        let store = store(usage(hasCredits: true, unlimited: true))
        #expect(store.quotaSummary(for: .codex)?.footerLines == ["Credits · Unlimited"])
    }

    @Test("the allowance row drives the chip with the short label")
    func allowanceRowUsesTheShortLabel() {
        let store = store(usage(creditLimit: limit(used: 3033, of: 10_000)))
        let summary = store.quotaSummary(for: .codex)
        #expect(summary?.primary?.label == "Monthly usage limit")
        #expect(summary?.primary?.percent == 0.3033)
        #expect(summary?.footerLines.isEmpty == true)
    }

    @Test("a spent-out allowance is called out on the chip")
    func reachedAllowanceIsCalledOut() {
        let store = store(usage(creditLimit: limit(used: 10_000, of: 10_000, reached: true)))
        #expect(store.quotaSummary(for: .codex)?.primary?.label == "Monthly usage limit · limit reached")
    }
}
