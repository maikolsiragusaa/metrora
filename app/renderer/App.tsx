import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EmptyNote } from './components/EmptyState'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Hint } from './components/Hint'
import { Onboarding } from './components/Onboarding'
import { Panel } from './components/Panel'
import { Sidebar, type Section } from './components/Sidebar'
import { Splash } from './components/Splash'
import { ToastHost } from './components/ToastHost'
import { UpdateBanner } from './components/UpdateBanner'
import { rangeLabel, TopBar } from './components/TopBar'
import { Window } from './components/Window'
import { providerName, useDesktopScope } from './hooks/useDesktopScope'
import { useDesktopShortcuts } from './hooks/useDesktopShortcuts'
import { overviewMemoKey, useProviderPrefetch } from './hooks/useProviderPrefetch'
import { clearPolledMemo, usePolled } from './hooks/usePolled'
import { readDailyBudget } from './lib/budget'
import { PERIOD_LABELS, SECTION_TITLES } from './lib/desktopSections'
import { formatCompact, formatUsd, setActiveCurrency } from './lib/format'
import { motionClass } from './lib/motion'
import { codeburn } from './lib/ipc'
import { localDateKey } from './lib/period'
import { persistRefreshValue, readRefreshValue, refreshValueToMs, RefreshCadenceContext, type RefreshCadence } from './lib/refreshCadence'
import { shortcutLabel, shortcutRangeLabel } from './lib/shortcuts'
import { readCompatStorage, writeCompatStorage } from './lib/storage'
import { OverviewContent } from './sections/Overview'
import { OptimizeContent } from './sections/Optimize'
import { Models } from './sections/Models'
import { Sessions } from './sections/Sessions'
import { PullRequestsContent } from './sections/PullRequests'
import { Compare } from './sections/Compare'
import { Plans } from './sections/Plans'
import { Settings, type SettingsPane } from './sections/Settings'
import { SpendContent } from './sections/Spend'
import { WorkspaceContent } from './sections/Workspace'
import type { MenubarPayload, ModelReportRow, TelemetryStatus } from './lib/types'

export { overviewMemoKey }

// Bucket raw dollar amounts before they leave the machine: telemetry carries
// coarse ranges, never exact spend.
function costBucket(usd: number): string {
  if (usd < 1) return '<1'
  if (usd < 10) return '1-10'
  if (usd < 50) return '10-50'
  if (usd < 200) return '50-200'
  if (usd < 1000) return '200-1k'
  return '1k+'
}

// Bucket occurrence counts (MCP-server / skill invocations) the same way costBucket
// coarsens dollars: telemetry carries usage magnitude, never an exact tally.
function countBucket(n: number): string {
  if (n < 10) return '1-10'
  if (n < 100) return '10-100'
  if (n < 1000) return '100-1k'
  return '1k+'
}

/** Map each model to its dominant task category from the default models report.
 * `topCategory` is computed only in that view (not `--by-task`). The overview's
 * `topModels[].name` is the provider display name — for Claude that's exactly
 * `modelDisplayName`, so we key on both it and the raw `model` id and take the
 * highest-cost row per key (rows arrive cost-descending). */
export function topCategoryByModel(rows: ModelReportRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    if (!row.topCategory) continue
    if (!map.has(row.modelDisplayName)) map.set(row.modelDisplayName, row.topCategory)
    if (!map.has(row.model)) map.set(row.model, row.topCategory)
  }
  return map
}

/** The once-per-day anonymous aggregate (main process dedups by calendar day). */
export function usageSnapshotProps(payload: MenubarPayload, modelCategories?: Map<string, string>): Record<string, unknown> {
  return {
    period: payload.current.label,
    providerCount: Object.keys(payload.current.providers).length,
    costBucket: costBucket(payload.current.cost),
    // Each top model with its coarse cost bucket, and — when the once-daily
    // by-model report joins — its dominant task category (a single name string,
    // never an array, so the sanitizer keeps it). This is the model x purpose cross.
    models: (payload.current.topModels ?? []).slice(0, 8).map(model => {
      const entry: Record<string, unknown> = { name: model.name, costBucket: costBucket(model.cost) }
      const topCategory = modelCategories?.get(model.name)
      if (topCategory) entry.topCategory = topCategory
      return entry
    }),
    // Per-provider spend, same cost-bucketing as models. `providers` maps lowercased
    // display name -> cost USD; sort by cost so the top spenders survive the cap.
    providers: Object.entries(payload.current.providers ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, cost]) => ({ name, costBucket: costBucket(cost) })),
    // Aggregate task categories (the "purpose" dimension across all models).
    categories: (payload.current.topActivities ?? []).slice(0, 12).map(activity => ({
      name: activity.name,
      // Task-completion signal: share of turns resolved in one shot, 2dp.
      oneShotRate: activity.oneShotRate == null ? -1 : Math.round(activity.oneShotRate * 100) / 100,
    })),
    // MCP servers and skills by name + bucketed usage. Names are config identifiers
    // (like model names), never args/paths/descriptions. Skills are measured in turns.
    mcpServers: (payload.current.mcpServers ?? []).slice(0, 12).map(server => ({
      name: server.name,
      callBucket: countBucket(server.calls),
    })),
    skills: (payload.current.skills ?? []).slice(0, 12).map(skill => ({
      name: skill.name,
      callBucket: countBucket(skill.turns),
    })),
  }
}

function refreshedLabel(lastSuccessAt: number | null, loading: boolean, now: number): string {
  if (loading && lastSuccessAt === null) return 'refreshing…'
  if (lastSuccessAt === null) return 'not refreshed yet'
  const seconds = Math.max(0, Math.floor((now - lastSuccessAt) / 1000))
  if (seconds < 1) return 'refreshed just now'
  if (seconds < 60) return `refreshed ${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `refreshed ${minutes}m ago`
}

/** Provides the app-wide refresh cadence (read persisted at boot, applied live)
 *  so every usePolled below reads it as its default interval. */
export function App() {
  const [refreshValue, setRefreshValue] = useState(readRefreshValue)
  const setValue = useCallback((value: string) => {
    setRefreshValue(value)
    persistRefreshValue(value)
  }, [])
  const cadence = useMemo<RefreshCadence>(
    () => ({ value: refreshValue, intervalMs: refreshValueToMs(refreshValue), setValue }),
    [refreshValue, setValue],
  )
  return (
    <RefreshCadenceContext.Provider value={cadence}>
      <AppMain />
    </RefreshCadenceContext.Provider>
  )
}

function AppMain() {
  const [section, setSection] = useState<Section>('overview')
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('general')
  const [detectedProviders, setDetectedProviders] = useState<Array<{ id: string; label: string }>>([])
  const {
    period,
    provider,
    customRange,
    claudeConfigSource,
    sectionCapabilities,
    scopedClaudeConfigSource,
    providerOptions,
    providerLabel,
    onPeriodChange,
    onRangeSelect,
    onProviderSelect,
    onConfigSelect,
  } = useDesktopScope({ section, detectedProviders })
  const [refreshToken, setRefreshToken] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [, setCurrencyTick] = useState(0)

  // Preserve the 2/3-arg call shapes when no config is scoped so the CLI argv
  // stays flag-free; only add --claude-config-source once a config is picked.
  const overview = usePolled<MenubarPayload>(
    () => scopedClaudeConfigSource
      ? codeburn.getOverview(period, provider, customRange ?? undefined, scopedClaudeConfigSource)
      : customRange
      ? codeburn.getOverview(period, provider, customRange)
      : codeburn.getOverview(period, provider),
    [period, provider, customRange?.from, customRange?.to, scopedClaudeConfigSource],
    { memoKey: overviewMemoKey(provider, period, customRange, scopedClaudeConfigSource) },
  )
  const refreshOverview = overview.refresh

  // Boot readiness: the overview poll is the single cold-cache warmer (long
  // timeout + progress). Other sections gate their first CLI spawn on this so a
  // cold first run hydrates ONCE here instead of fanning out into a parallel
  // full-history parse per section. Flips true the moment overview first has data
  // OR a (resolved) error; LATCHED, so a later uncached switch (which clears
  // overview.data to paint a skeleton) can never re-gate the sections.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (overview.data != null || overview.error != null) setReady(true)
  }, [overview.data, overview.error])

  // First-launch onboarding: shown until the telemetry consent screen has been
  // completed once. All telemetry bridge calls are typeof-guarded so an older
  // preload (or the test bridge mock) degrades to "no onboarding, no tracking".
  const [onboardingStatus, setOnboardingStatus] = useState<TelemetryStatus | null>(null)
  useEffect(() => {
    if (typeof codeburn.telemetryStatus !== 'function') return
    codeburn.telemetryStatus()
      .then(status => { if (status && !status.onboarded) setOnboardingStatus(status) })
      .catch(() => { /* telemetry unavailable — skip onboarding */ })
  }, [])
  const finishOnboarding = useCallback((enabled: boolean) => {
    setOnboardingStatus(null)
    if (typeof codeburn.completeOnboarding === 'function') void codeburn.completeOnboarding(enabled).catch(() => {})
  }, [])

  const trackEvent = useCallback((name: string, props?: Record<string, unknown>) => {
    if (typeof codeburn.telemetryTrack === 'function') void codeburn.telemetryTrack(name, props).catch(() => {})
  }, [])

  // Once-per-day anonymous usage aggregate, only from the canonical view
  // (all providers, standard period, no config scope) so buckets are stable.
  // Gated to the first qualifying render per calendar day so the extra by-model
  // report fetch runs at most once/day, not on every poll (main also dedups the
  // event). The fetch enriches each model with its dominant task category; if it
  // fails we still emit the snapshot, just without the model x category cross.
  const snapshotDayRef = useRef<string | null>(null)
  useEffect(() => {
    if (!overview.data || provider !== 'all' || customRange || scopedClaudeConfigSource) return
    const today = localDateKey(new Date())
    if (snapshotDayRef.current === today) return
    snapshotDayRef.current = today
    const payload = overview.data
    void (async () => {
      let modelCategories: Map<string, string> | undefined
      try {
        modelCategories = topCategoryByModel(await codeburn.getModels(period, 'all', false))
      } catch { /* degrade: emit the snapshot without per-model topCategory */ }
      trackEvent('usage_snapshot', usageSnapshotProps(payload, modelCategories))
    })()
  }, [overview.data, provider, customRange, scopedClaudeConfigSource, period, trackEvent])

  useEffect(() => {
    const saved = readCompatStorage('theme')
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved)
    else document.documentElement.removeAttribute('data-theme')
  }, [])

  useEffect(() => {
    if (!overview.data) return
    const details = overview.data.current.providerDetails
    // Prefer providerDetails (internal id + display label); fall back to the
    // providers map keys (lowercased display names) for older CLIs. The CLI
    // only emits detected providers, so keep every entry (including ones with
    // no spend this period) and sort by cost so zero-cost ones sit at the
    // bottom of the picker.
    const found = details
      ? [...details]
          .sort((a, b) => b.cost - a.cost)
          .map(entry => ({ id: entry.id, label: entry.label }))
      : Object.entries(overview.data.current.providers)
          // Fallback map keys are lowercased display names; ones with spaces
          // ("grok build") cannot round-trip as --provider, so exclude them
          // rather than offer a filter that is guaranteed to error.
          .filter(([key]) => /^[a-z0-9-]+$/.test(key))
          .sort(([, a], [, b]) => b - a)
          .map(([key]) => ({ id: key, label: providerName(key) }))
    setDetectedProviders(current => {
      const next = [...current]
      for (const item of found) if (!next.some(entry => entry.id === item.id)) next.push(item)
      return next.length === current.length ? current : next
    })
  }, [overview.data])

  useEffect(() => {
    const currency = overview.data?.currency
    if (!currency) return
    // While `switching`, `data` is a memo-served payload from a previous key that
    // may carry a STALE currency (cached before a Settings currency change): never
    // let it regress the display. Apply currency only from a freshly-resolved
    // fetch; the fresh result (switching false) re-runs this and applies the real
    // one. clearPolledMemo() on a currency mutation also purges those stale entries.
    if (overview.switching) return
    setActiveCurrency(currency)
    setCurrencyTick(tick => tick + 1)
  }, [overview.data?.currency?.code, overview.data?.currency?.rate, overview.data?.currency?.symbol, overview.switching])

  useProviderPrefetch({
    ready,
    hasOverviewData: overview.data != null,
    overviewLoading: overview.loading,
    detectedProviders,
    period,
    provider,
    customRange,
    scopedClaudeConfigSource,
  })

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const refreshVisible = useCallback(() => {
    refreshOverview()
    setRefreshToken(token => token + 1)
  }, [refreshOverview])

  // A Settings action changed config that alters computed costs/currency
  // (currency/alias/plan/price-override). The electron read-cache is flushed CLI-
  // side, but the renderer's instant-switch memo still holds payloads computed
  // under the OLD config — a later provider switch would repaint the stale currency.
  // Purge the memo, then force-refresh the active view so the new values land in a
  // couple seconds (quick like the menubar) instead of at the next poll.
  const onConfigMutated = useCallback(() => {
    clearPolledMemo()
    refreshVisible()
  }, [refreshVisible])

  const navigate = useCallback((next: Section, pane: SettingsPane = 'general') => {
    setSettingsPane(pane)
    setSection(next)
    trackEvent('section_view', { section: next })
  }, [trackEvent])

  useDesktopShortcuts({ navigate, refresh: refreshVisible })

  const claudeConfigs = overview.data?.claudeConfigs
  const activeConfigLabel = scopedClaudeConfigSource
    ? claudeConfigs?.options.find(option => option.id === scopedClaudeConfigSource)?.label ?? null
    : null
  const scope = `${customRange ? rangeLabel(customRange) : PERIOD_LABELS[period]} · ${providerLabel}${activeConfigLabel ? ` · ${activeConfigLabel}` : ''}`

  return (
    <Window>
      <Sidebar active={section} onNavigate={navigate} status={<StatusLine polled={overview} />} />
      <ToastHost />
      <Splash hasData={overview.data != null} hasError={overview.error != null} />
      {onboardingStatus && <Onboarding defaultEnabled={onboardingStatus.defaultEnabled} onDone={finishOnboarding} />}
      <div className="ct">
        <div className={overview.switching ? 'switch-line on' : 'switch-line'} aria-hidden="true" />
        <UpdateBanner />
        <DailyBudgetBanner payload={overview.data ?? null} provider={provider} />
        <ErrorBoundary key={section}>
        {section === 'plans' ? (
          <Plans period={period} refreshToken={refreshToken} onNavigate={navigate} ready={ready} />
        ) : section === 'settings' ? (
          <Settings period={period} refreshToken={refreshToken} onNavigate={navigate} initialPane={settingsPane} claudeConfigs={claudeConfigs} claudeConfigSource={claudeConfigSource} onConfigMutated={onConfigMutated} />
        ) : (
          <>
            <TopBar
              title={SECTION_TITLES[section]}
              scope={scope}
              period={period}
              onPeriodChange={onPeriodChange}
              customRange={customRange}
              onRangeSelect={onRangeSelect}
              provider={provider}
              providerLabel={providerLabel}
              providerOptions={providerOptions}
              onProviderSelect={onProviderSelect}
              claudeConfigs={claudeConfigs}
              configSource={claudeConfigSource}
              onConfigSelect={onConfigSelect}
              capabilities={sectionCapabilities}
            />
            <div className={motionClass('body', 'section-fade')}>
              {section === 'overview' ? (
                <OverviewContent period={period} provider={provider} range={customRange} overview={overview} onNavigate={navigate} ready={ready} />
              ) : section === 'sessions' ? (
                <Sessions period={period} provider={provider} range={customRange} refreshToken={refreshToken} detectedProviders={detectedProviders} onProviderChange={onProviderSelect} ready={ready} />
              ) : section === 'pullRequests' ? (
                <PullRequestsContent overview={overview} />
              ) : section === 'spend' ? (
                <SpendContent period={period} provider={provider} range={customRange} overview={overview} refreshToken={refreshToken} ready={ready} />
              ) : section === 'optimize' ? (
                <OptimizeContent period={period} provider={provider} range={customRange} overview={overview} refreshToken={refreshToken} ready={ready} />
              ) : section === 'models' ? (
                <Models period={period} provider={provider} range={customRange} refreshToken={refreshToken} onNavigate={navigate} ready={ready} />
              ) : section === 'compare' ? (
                <Compare period={period} provider={provider} range={customRange} refreshToken={refreshToken} ready={ready} />
              ) : section === 'workspace' ? (
                <WorkspaceContent payload={overview.data ?? null} scope={scope} analyticsLoading={overview.loading} />
              ) : (
                <SectionPlaceholder title={SECTION_TITLES[section]} />
              )}
            </div>
          </>
        )}
        </ErrorBoundary>
        {section !== 'settings' && (
          <Hint
            items={[
              { k: shortcutRangeLabel('1', '9'), label: 'Navigate' },
              { k: shortcutLabel(','), label: 'Settings' },
              { k: shortcutLabel('R'), label: 'Refresh' },
            ]}
            right={refreshedLabel(overview.lastSuccessAt, overview.loading, now)}
          />
        )}
      </div>
    </Window>
  )
}

function StatusLine({ polled }: { polled: ReturnType<typeof usePolled<MenubarPayload>> }) {
  if (polled.data) {
    return (
      <>
        {polled.data.current.label} <b>{formatUsd(polled.data.current.cost)}</b>
      </>
    )
  }
  if (polled.error?.kind === 'not-found') return <>CLI not found</>
  if (polled.loading) return <>scanning…</>
  return <>—</>
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <EmptyNote>{title} lands in a later task. The shell, data bridge, and design system are in place.</EmptyNote>
    </Panel>
  )
}

/** App-wide daily-budget alert: reads today's usage from the overview payload and
 * warns at >=80% / alerts at >=100% of the configured cap. Dismissible per day. */
function DailyBudgetBanner({ payload, provider }: { payload: MenubarPayload | null; provider: string }) {
  const [, bumpDismiss] = useState(0)
  const budget = readDailyBudget()
  if (!budget || !payload) return null

  // Token totals in history.daily are zeroed under a specific-provider filter
  // (only cost is per-provider), so a token cap can only be evaluated honestly on
  // the all-providers view; otherwise we'd compare usage against a false zero.
  if (budget.kind === 'tokens' && provider !== 'all') return null

  const todayKey = localDateKey(new Date())
  const dismissed = readCompatStorage('dailyBudget.dismissed')
  if (dismissed === todayKey) return null

  // Today's entry may be absent when there has been no activity yet: that's 0 used.
  const entry = payload.history.daily.find(day => day.date === todayKey)
  const used = budget.kind === 'usd'
    ? entry?.cost ?? 0
    : entry ? entry.inputTokens + entry.outputTokens : 0
  const percent = (used / budget.value) * 100
  if (percent < 80) return null

  const exceeded = percent >= 100
  const spent = budget.kind === 'usd' ? formatUsd(used) : formatCompact(used)
  const cap = budget.kind === 'usd' ? formatUsd(budget.value) : formatCompact(budget.value)
  const text = exceeded
    ? `Daily budget exceeded: ${spent} of ${cap}`
    : `Today's spend is at ${Math.floor(percent)}% of your daily budget`

  const dismiss = () => {
    writeCompatStorage('dailyBudget.dismissed', todayKey)
    bumpDismiss(tick => tick + 1)
  }

  return (
    <div role="status" className={exceeded ? 'budget-banner exceeded' : 'budget-banner'}>
      <span>{text}</span>
      <button type="button" className="set-text-button" onClick={dismiss}>Dismiss</button>
    </div>
  )
}
