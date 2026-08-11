export type ModelDayStats = {
  calls: number
  cost: number
  savingsUSD: number
  inputTokens: number
  outputTokens: number
  /// Separately observed reasoning/thinking tokens. Optional for legacy days.
  reasoningTokens?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /// Source-recorded model/API provider when the collector exposes it.
  modelProvider?: string
  /// Collector/tool names contributing to this model row. Additive provenance;
  /// it is not used to split otherwise equivalent accounting rows.
  sourceProviders?: string[]
}

export type CategoryDayStats = { turns: number; cost: number; savingsUSD: number; editTurns: number; oneShotTurns: number }

/// `path` is the project's filesystem path when known — it is what display
/// layers derive a friendly name from once the sessions that carried the
/// mapping are gone.
export type ProjectDayStats = { cost: number; calls: number; savingsUSD: number; sessions: number; path?: string }

export type ProviderDaySlice = {
  calls: number
  cost: number
  savingsUSD: number
  /// Full per-provider breakdown, written since v14. Slices adopted from older
  /// caches carry only the three fields above; carrying such a slice forward
  /// restores exact cost/calls/savings but not the day's token/model/category
  /// split for that provider.
  sessions?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  editTurns?: number
  oneShotTurns?: number
  models?: Record<string, ModelDayStats>
  categories?: Record<string, CategoryDayStats>
  projects?: Record<string, ProjectDayStats>
}

export type DailyEntry = {
  date: string
  cost: number
  savingsUSD: number
  calls: number
  sessions: number
  inputTokens: number
  outputTokens: number
  /// Separately observed reasoning/thinking tokens. Optional for legacy days.
  reasoningTokens?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  editTurns: number
  oneShotTurns: number
  models: Record<string, ModelDayStats>
  categories: Record<string, CategoryDayStats>
  providers: Record<string, ProviderDaySlice>
  /// Per-project rollup (session-level project attribution). Absent on days
  /// recorded before v15 — those days keep their totals but have no project
  /// split, and nothing can reconstruct one once the sources are gone.
  projects?: Record<string, ProjectDayStats>
  /// Present when some of this day's data was carried forward from an earlier
  /// cache generation instead of re-derived from session files (the files no
  /// longer exist). Carried values keep the accounting of the version that
  /// recorded them — stale accounting beats a silent zero.
  carried?: true
}

export type DailyCache = {
  version: number
  /// Hash of the active `localModelSavings` config at the time the cache
  /// was last written. When the user changes their baseline mapping the
  /// hash mismatches and `ensureCacheHydrated` re-derives available history,
  /// then carries forward slices whose sources are gone.
  savingsConfigHash: string
  /// IANA local timezone the days were bucketed under (day boundaries are
  /// local-time). If the machine's timezone changes, previously-cached days are
  /// bucketed against the wrong midnight, so a mismatch forces a full re-hydrate
  /// (same self-heal as `savingsConfigHash`). Absent on caches written before
  /// this field existed → not treated as a mismatch (no gratuitous rebuild).
  tzKey?: string
  /// Durable-source evidence was materialized into the daily ledger under this
  /// authority. Absent on pre-remediation caches, which triggers one wide
  /// reconciliation when the caller opts into the authority.
  durableHistoryAuthority?: string
  lastComputedDate: string | null
  days: DailyEntry[]
  /// True only once the full backfill window has been hydrated from a COMPLETE
  /// session parse. A cache that was finalized against a partial (interrupted)
  /// session hydration — the "chart is empty for the first ~20 days" bug — reads
  /// as incomplete and is fully re-backfilled. Absent on caches written before
  /// this field existed → treated as incomplete (one self-healing re-backfill).
  complete?: boolean
}
