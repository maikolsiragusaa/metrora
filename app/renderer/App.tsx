import { useCallback, useEffect, useMemo, useState } from 'react'

import { DailyBudgetBanner } from './components/DailyBudgetBanner'
import { EmptyNote } from './components/EmptyState'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Hint } from './components/Hint'
import { Onboarding } from './components/Onboarding'
import { Panel } from './components/Panel'
import type { Section } from './components/Sidebar'
import { Splash } from './components/Splash'
import { ToastHost } from './components/ToastHost'
import { UpdateBanner } from './components/UpdateBanner'
import { rangeLabel, TopBar } from './components/TopBar'
import { useDesktopScope } from './hooks/useDesktopScope'
import { useDesktopShortcuts } from './hooks/useDesktopShortcuts'
import { useOverviewRuntime } from './hooks/useOverviewRuntime'
import { usePolled } from './hooks/usePolled'
import { PERIOD_LABELS, SECTION_TITLES } from './lib/desktopSections'
import { motionClass } from './lib/motion'
import { completeOnboarding, shouldShowOnboarding } from './lib/onboardingState'
import { metrora } from './lib/ipc'
import { persistRefreshValue, readRefreshValue, refreshValueToMs, RefreshCadenceContext, type RefreshCadence } from './lib/refreshCadence'
import { shortcutLabel, shortcutRangeLabel } from './lib/shortcuts'
import { readStorage } from './lib/storage'
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
import { Bench } from './sections/Bench'
import { Code } from './sections/Code'
import { MetroraShell } from './shell/MetroraShell'
import { MetroraSidebar } from './shell/sidebar/MetroraSidebar'
import { Activity } from './sections/Activity'
import { Companion } from './sections/Companion'

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
    metroraProjectId,
    onPeriodChange,
    onRangeSelect,
    onProviderSelect,
    onConfigSelect,
    onProjectScopeSelect,
  } = useDesktopScope({ section, detectedProviders })
  const { overview, ready, refreshToken, refreshVisible, onConfigMutated } = useOverviewRuntime({
    period,
    provider,
    customRange,
    projectScopeId: metroraProjectId,
    scopedClaudeConfigSource,
    detectedProviders,
    setDetectedProviders,
  })
  const [onboardingVisible, setOnboardingVisible] = useState(shouldShowOnboarding)
  // Onboarding inventory is intentionally a separate lifetime read. It keeps
  // the user's Home period/provider/project scope untouched while reusing the
  // same canonical menubar-json authority as the rest of the desktop.
  const onboardingInventory = usePolled(
    () => metrora.getOverview('lifetime', 'all'),
    [],
    { intervalMs: 60_000, enabled: onboardingVisible },
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const saved = readStorage('theme')
    const root = document.documentElement
    const bridge = (window as unknown as { metrora?: { platform?: string; setWindowChromeTheme?: (theme: 'dark' | 'light') => Promise<boolean> } }).metrora
    root.dataset.platform = bridge?.platform ?? root.dataset.platform ?? ''
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    const apply = () => {
      const resolved = saved === 'light' || saved === 'dark' ? saved : media?.matches ? 'dark' : 'light'
      if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved)
      else root.removeAttribute('data-theme')
      if (bridge?.setWindowChromeTheme) void bridge.setWindowChromeTheme(resolved).catch(() => {})
    }
    apply()
    if (saved !== 'light' && saved !== 'dark' && media) {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const navigate = useCallback((next: Section, pane: SettingsPane = 'general') => {
    setSettingsPane(pane)
    setSection(next)
  }, [])

  const openCode = useCallback(() => {
    setSettingsPane('general')
    setSection('code')
  }, [])

  const finishLocalOnboarding = useCallback(() => {
    completeOnboarding()
    setOnboardingVisible(false)
  }, [])

  const openSettingsFromOnboarding = useCallback(() => {
    finishLocalOnboarding()
    navigate('settings')
  }, [finishLocalOnboarding, navigate])

  useDesktopShortcuts({ navigate, refresh: refreshVisible })

  const claudeConfigs = overview.data?.claudeConfigs
  const activeConfigLabel = scopedClaudeConfigSource
    ? claudeConfigs?.options.find(option => option.id === scopedClaudeConfigSource)?.label ?? null
    : null
  const scope = `${customRange ? rangeLabel(customRange) : PERIOD_LABELS[period]} · ${providerLabel}${activeConfigLabel ? ` · ${activeConfigLabel}` : ''}`
  const projectScope = overview.data?.projectScope
  useEffect(() => {
    if (!projectScope || projectScope.options.some(option => option.id === metroraProjectId)) return
    onProjectScopeSelect('all')
  }, [metroraProjectId, onProjectScopeSelect, projectScope])

  if (onboardingVisible) {
    return (
      <MetroraShell sidebar={null} className="metrora-onboarding-shell">
        <ToastHost />
        <Splash hasData={overview.data != null} hasError={overview.error != null} />
        <Onboarding
          overview={overview}
          inventory={onboardingInventory}
          ready={ready}
          onDone={finishLocalOnboarding}
          onOpenSettings={openSettingsFromOnboarding}
        />
      </MetroraShell>
    )
  }

  return (
    <MetroraShell
      sidebar={<MetroraSidebar active={section} onNavigate={navigate} />}
    >
      <ToastHost />
      <Splash hasData={overview.data != null} hasError={overview.error != null} />
      <div className={`ct ct-${section}`} data-metrora-section={section}>
        <div className={overview.switching ? 'switch-line on' : 'switch-line'} aria-hidden="true" />
        <UpdateBanner />
        {section !== 'code' && section !== 'bench' && section !== 'companion' && <DailyBudgetBanner payload={overview.data ?? null} provider={provider} />}
        <ErrorBoundary key={section}>
        {section === 'companion' ? (
          <Companion refreshToken={refreshToken} onRefresh={refreshVisible} refreshing={overview.loading} />
        ) : section === 'code' ? (
          <Code />
        ) : section === 'bench' ? (
          <Bench />
        ) : section === 'plans' ? (
          <Plans period={period} refreshToken={refreshToken} onNavigate={navigate} onOpenCode={openCode} onRefresh={refreshVisible} refreshing={overview.loading} ready={ready} />
        ) : section === 'settings' ? (
          <Settings period={period} refreshToken={refreshToken} onNavigate={navigate} initialPane={settingsPane} claudeConfigs={claudeConfigs} claudeConfigSource={claudeConfigSource} onConfigMutated={onConfigMutated} onRefresh={refreshVisible} refreshing={overview.loading} />
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
              projectOptions={projectScope?.options.map(option => ({ id: option.id, name: option.name }))}
              projectScopeId={metroraProjectId}
              onProjectScopeSelect={onProjectScopeSelect}
              capabilities={sectionCapabilities}
              onOpenCode={openCode}
              onRefresh={refreshVisible}
              refreshing={overview.loading}
              compactHome={section === 'overview'}
            />
            <div className={motionClass('body', 'section-fade')}>
              {section === 'overview' ? (
                <OverviewContent period={period} provider={provider} range={customRange} overview={overview} refreshToken={refreshToken} onNavigate={navigate} controlCenter ready={ready} />
              ) : section === 'activity' ? (
                <Activity overview={overview} onNavigate={navigate} />
              ) : section === 'sessions' ? (
                <Sessions
                  period={period}
                  provider={provider}
                  projectScopeId={metroraProjectId}
                  range={customRange}
                  refreshToken={refreshToken}
                  detectedProviders={detectedProviders}
                  onProviderChange={onProviderSelect}
                  historicalSessionCount={overview.data?.current.sessions ?? null}
                  ready={ready}
                />
              ) : section === 'pullRequests' ? (
                <PullRequestsContent overview={overview} />
              ) : section === 'spend' ? (
                <SpendContent period={period} provider={provider} projectScopeId={metroraProjectId} range={customRange} overview={overview} refreshToken={refreshToken} ready={ready} />
              ) : section === 'optimize' ? (
                <OptimizeContent period={period} provider={provider} range={customRange} overview={overview} refreshToken={refreshToken} ready={ready} />
              ) : section === 'models' ? (
                <Models period={period} provider={provider} projectScopeId={metroraProjectId} range={customRange} refreshToken={refreshToken} onNavigate={navigate} overview={overview} ready={ready} />
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
        {section !== 'settings' && section !== 'code' && section !== 'bench' && section !== 'companion' && (
          <Hint
            items={[
              { k: shortcutRangeLabel('1', '7'), label: 'Navigate' },
              { k: shortcutLabel(','), label: 'Settings' },
              { k: shortcutLabel('R'), label: 'Refresh' },
            ]}
            right={refreshedLabel(overview.lastSuccessAt, overview.loading, now)}
          />
        )}
      </div>
    </MetroraShell>
  )
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <EmptyNote>{title} lands in a later task. The shell, data bridge, and design system are in place.</EmptyNote>
    </Panel>
  )
}
