import Foundation

/// Pure display-decision helpers for the Kimi Code quota surfaces.
///
/// Kimi Code tokens live ~15 min and only the Kimi CLI renews them, so the
/// load state sits in `.terminalFailure` as its dominant steady state between
/// CLI uses. The always-visible surfaces (Plan tab, tab-strip chip) must keep
/// showing the last good snapshot with a quiet caption instead of flapping to
/// a reconnect screen every cycle. The reconnect screen is reserved for the
/// no-data case, where there is genuinely nothing to show.
enum KimiQuotaPresentation {
    /// Which Plan-tab subview to render, given the load state and whether a
    /// last-known snapshot exists.
    enum PlanContent: Equatable {
        case noCredentials
        case loading
        case failed
        case transientFailed
        case reconnect(reason: String?)
        /// Render the loaded usage bars. `idle` is true when the login has
        /// gone terminal but a snapshot is still on hand — the caller stamps a
        /// quiet "run the CLI" caption instead of hiding the data.
        case usage(idle: Bool)
    }

    static func planContent(loadState: SubscriptionLoadState, hasUsage: Bool) -> PlanContent {
        switch loadState {
        case .notBootstrapped, .noCredentials:
            return .noCredentials
        case .dormant, .bootstrapping:
            return .loading
        case .loading, .loaded:
            return hasUsage ? .usage(idle: false) : .loading
        case .failed:
            return .failed
        case .transientFailure:
            return hasUsage ? .usage(idle: false) : .transientFailed
        case .terminalFailure(let reason):
            return hasUsage ? .usage(idle: true) : .reconnect(reason: reason)
        }
    }

    /// Snapshot age past which a loaded view stamps an "as of <time>" caption,
    /// so a bar can never silently masquerade as current. Kimi's ~15-min token
    /// life makes 10 minutes the point where a snapshot is likely a cycle old.
    static let stalenessThreshold: TimeInterval = 10 * 60

    static func isStale(fetchedAt: Date, now: Date = Date()) -> Bool {
        now.timeIntervalSince(fetchedAt) > stalenessThreshold
    }
}
