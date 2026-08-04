import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { useDesktopScope } from './hooks/useDesktopScope'
import { useDesktopShortcuts } from './hooks/useDesktopShortcuts'
import { useDesktopTelemetry } from './hooks/useDesktopTelemetry'
import { useOverviewRuntime } from './hooks/useOverviewRuntime'
import type { Polled } from './hooks/usePolled'
import { readDailyBudget } from './lib/budget'
import { PERIOD_LABELS, SECTION_TITLES } from './lib/desktopSections'
import { formatCompact, formatUsd } from './lib/format'
import { motionClass } from './lib/motion'
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
import type { MenubarPayload } from './lib/types'

export { overviewMemoKey } from './hooks/useProviderPrefetch'
export { topCategoryByModel, usageSnapshotProps } from './hooks/useDesktopTelemetry'

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
  const { overview, ready, refreshToken, refreshVisible, onConfigMutated } = useOverviewRuntime({
    period,
    provider,
    customRange,
    scopedClaudeConfigSource,
    detectedProviders,
    setDetectedProviders,
  })
  const { onboardingStatus, finishOnboarding, trackEvent } = useDesktopTelemetry({
    overviewData: overview.data,
    period,
    provider,
    customRange,
    scopedClaudeConfigSource,
  })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const saved = readCompatStorage('theme')
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved)
    else document.documentElement.removeAttribute('data-theme')
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

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

function StatusLine({ polled }: { polled: Polled<MenubarPayload> }) {
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
