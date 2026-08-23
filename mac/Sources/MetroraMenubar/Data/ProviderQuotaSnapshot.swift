import Foundation

/// Native counterpart of the Electron ProviderQuotaSnapshot contract.
///
/// This is deliberately a product-only payload: provider credentials,
/// account identifiers, source paths and raw response bodies cannot be
/// represented by this type. Provider quota, local usage and local budgets
/// remain separate authorities.
struct ProviderQuotaSnapshot: Codable, Sendable, Equatable {
    static let currentSchemaVersion = 1

    enum Provider: String, Codable, Sendable, Equatable {
        case claude
        case codex
    }

    enum Authority: String, Codable, Sendable, Equatable {
        case providerReported = "provider-reported"
    }

    enum Connection: String, Codable, Sendable, Equatable {
        case connected
        case disconnected
        case accessDenied
        case loading
        case stale
        case transientFailure
        case terminalFailure
    }

    enum Availability: String, Codable, Sendable, Equatable {
        case available
        case unavailable
    }

    enum Freshness: String, Codable, Sendable, Equatable {
        case fresh
        case stale
        case unavailable
    }

    struct Window: Codable, Sendable, Equatable {
        let id: String
        let label: String
        let usedFraction: Double
        let resetsAt: Date?
        let windowSeconds: Int?
    }

    struct Credits: Codable, Sendable, Equatable {
        let balance: Double
        let currency: String

        init(balance: Double, currency: String = "USD") {
            self.balance = balance
            self.currency = currency
        }
    }

    struct RateLimit: Codable, Sendable, Equatable {
        enum State: String, Codable, Sendable, Equatable {
            case clear
            case backoff
        }

        let state: State
        let retryAt: Date?

        static let clear = RateLimit(state: .clear, retryAt: nil)

        static func backoff(until: Date?) -> RateLimit {
            RateLimit(state: .backoff, retryAt: until)
        }
    }

    let schemaVersion: Int
    let provider: Provider
    let authority: Authority
    let availability: Availability
    let connection: Connection
    let freshness: Freshness
    /// The provider response observation time. A failed refresh never moves
    /// this timestamp forward; stale snapshots retain the original value.
    let observedAt: Date?
    let planLabel: String?
    let windows: [Window]
    /// A provider-reported balance. Zero is factual and must not be treated as
    /// missing; nil means the provider did not report a balance.
    let credits: Credits?
    let rateLimit: RateLimit

    /// Builds a product-safe snapshot and fail-closes malformed or
    /// non-factual values. Connection is supplied by the adapter from the
    /// native refresh state; this initializer decides whether the facts are
    /// fresh, stale or unavailable.
    init(
        provider: Provider,
        connection: Connection,
        observedAt: Date?,
        planLabel: String?,
        windows: [Window],
        credits: Credits?,
        rateLimit: RateLimit = .clear
    ) {
        let safeWindows = windows.compactMap { row -> Window? in
            guard !row.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !row.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  row.usedFraction.isFinite
            else { return nil }
            return Window(
                id: row.id,
                label: row.label,
                usedFraction: min(1, max(0, row.usedFraction)),
                resetsAt: row.resetsAt,
                windowSeconds: row.windowSeconds.flatMap { $0 > 0 ? $0 : nil }
            )
        }
        let safePlan = planLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
            .flatMap { $0.isEmpty ? nil : $0 }
        let safeCredits = credits.flatMap { $0.balance.isFinite ? Credits(balance: $0.balance) : nil }
        let factual = !safeWindows.isEmpty || safeCredits != nil || safePlan != nil
        let hasObservation = factual && observedAt != nil
        let isFresh = connection == .connected && hasObservation
        let isStale = (connection == .stale || connection == .transientFailure) && hasObservation

        schemaVersion = Self.currentSchemaVersion
        self.provider = provider
        authority = .providerReported
        self.connection = connection
        availability = isFresh ? .available : .unavailable
        freshness = isFresh ? .fresh : (isStale ? .stale : .unavailable)
        // Terminal/loading/disconnected snapshots do not claim provider facts.
        // A stale/transient snapshot retains the provider original time.
        self.observedAt = (isFresh || isStale) ? observedAt : nil
        self.planLabel = (isFresh || isStale) ? safePlan : nil
        self.windows = (isFresh || isStale) ? safeWindows : []
        self.credits = (isFresh || isStale) ? safeCredits : nil
        self.rateLimit = Self.sanitizeRateLimit(rateLimit)
    }

    static func empty(provider: Provider, connection: Connection, rateLimit: RateLimit = .clear) -> ProviderQuotaSnapshot {
        ProviderQuotaSnapshot(
            provider: provider,
            connection: connection,
            observedAt: nil,
            planLabel: nil,
            windows: [],
            credits: nil,
            rateLimit: rateLimit
        )
    }

    var hasProviderFacts: Bool {
        !windows.isEmpty || credits != nil || planLabel != nil
    }

    private static func sanitizeRateLimit(_ value: RateLimit) -> RateLimit {
        switch value.state {
        case .clear:
            return .clear
        case .backoff:
            return .backoff(until: value.retryAt)
        }
    }
}

/// Maps already-decoded native service values into the shared conceptual
/// provider-quota model. The adapter is observational only: it never reads,
/// refreshes or writes provider credentials.
enum ProviderQuotaSnapshotAdapter {
    static func claude(
        usage: SubscriptionUsage?,
        state: SubscriptionLoadState
    ) -> ProviderQuotaSnapshot {
        let connection = connection(for: state, hasUsage: usage != nil)
        let windows: [ProviderQuotaSnapshot.Window] = usage.map { value in
            var rows: [ProviderQuotaSnapshot.Window] = []
            append(&rows, id: "five_hour", label: "5-hour", percent: value.fiveHourPercent, resetsAt: value.fiveHourResetsAt)
            append(&rows, id: "seven_day", label: "Weekly", percent: value.sevenDayPercent, resetsAt: value.sevenDayResetsAt)
            append(&rows, id: "seven_day_opus", label: "Weekly · Opus", percent: value.sevenDayOpusPercent, resetsAt: value.sevenDayOpusResetsAt)
            append(&rows, id: "seven_day_sonnet", label: "Weekly · Sonnet", percent: value.sevenDaySonnetPercent, resetsAt: value.sevenDaySonnetResetsAt)
            for scoped in value.scopedWeekly {
                append(
                    &rows,
                    id: "weekly_scoped:\(scoped.label)",
                    label: "Weekly · \(scoped.label)",
                    percent: scoped.percent,
                    resetsAt: scoped.resetsAt
                )
            }
            return rows
        } ?? []
        // rawTier nil means Claude did not report a plan. Do not turn the
        // UI fallback label Subscription into a provider fact.
        let plan = usage?.rawTier == nil ? nil : usage?.tier.displayName
        return ProviderQuotaSnapshot(
            provider: .claude,
            connection: connection,
            observedAt: usage?.fetchedAt,
            planLabel: plan,
            windows: windows,
            credits: nil,
            rateLimit: rateLimit(for: state)
        )
    }

    static func codex(
        usage: CodexUsage?,
        state: SubscriptionLoadState
    ) -> ProviderQuotaSnapshot {
        let connection = connection(for: state, hasUsage: usage != nil)
        let windows: [ProviderQuotaSnapshot.Window] = usage.map { value in
            var rows: [ProviderQuotaSnapshot.Window] = []
            append(&rows, id: "primary", window: value.primary)
            append(&rows, id: "secondary", window: value.secondary)
            for extra in value.additionalLimits {
                append(&rows, id: "additional:\(extra.name):primary", window: extra.primary, labelPrefix: extra.name)
                append(&rows, id: "additional:\(extra.name):secondary", window: extra.secondary, labelPrefix: extra.name)
            }
            return rows
        } ?? []
        let plan: String? = {
            guard let usage else { return nil }
            if case let .unknown(raw) = usage.plan, raw.isEmpty { return nil }
            return usage.plan.displayName
        }()
        let credits = usage?.creditsBalance.flatMap { $0.isFinite ? ProviderQuotaSnapshot.Credits(balance: $0) : nil }
        return ProviderQuotaSnapshot(
            provider: .codex,
            connection: connection,
            observedAt: usage?.fetchedAt,
            planLabel: plan,
            windows: windows,
            credits: credits,
            rateLimit: rateLimit(for: state)
        )
    }

    private static func connection(for state: SubscriptionLoadState, hasUsage: Bool) -> ProviderQuotaSnapshot.Connection {
        switch state {
        case .notBootstrapped, .noCredentials:
            return .disconnected
        case .dormant, .bootstrapping:
            return .loading
        case .loading:
            return hasUsage ? .stale : .loading
        case .loaded:
            return .connected
        case .failed:
            return .transientFailure
        case .terminalFailure:
            return .terminalFailure
        case .transientFailure:
            return .transientFailure
        }
    }

    private static func rateLimit(for state: SubscriptionLoadState) -> ProviderQuotaSnapshot.RateLimit {
        if case let .transientFailure(retryAt) = state {
            return .backoff(until: retryAt)
        }
        return .clear
    }

    private static func append(
        _ rows: inout [ProviderQuotaSnapshot.Window],
        id: String,
        label: String,
        percent: Double?,
        resetsAt: Date?
    ) {
        guard let percent, percent.isFinite else { return }
        rows.append(.init(id: id, label: label, usedFraction: percent / 100, resetsAt: resetsAt, windowSeconds: nil))
    }

    private static func append(
        _ rows: inout [ProviderQuotaSnapshot.Window],
        id: String,
        window: CodexUsage.Window?,
        labelPrefix: String? = nil
    ) {
        guard let window else { return }
        let label = labelPrefix.map { "\($0) · \(window.windowLabel)" } ?? window.windowLabel
        rows.append(.init(
            id: id,
            label: label,
            usedFraction: window.usedPercent / 100,
            resetsAt: window.resetsAt,
            windowSeconds: window.limitWindowSeconds > 0 ? window.limitWindowSeconds : nil
        ))
    }
}
