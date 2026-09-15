import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { SectionFreshness } from '../components/SectionFreshness'
import { SectionSkeleton } from '../components/Skeleton'
import { StaleBanner } from '../components/StaleBanner'
import { type Polled, usePolled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { contiguousDailyWindow, localDateKey, periodWindowStart, sliceDailyToPeriod, sliceDailyToRange } from '../lib/period'
import type { CliError, DailyHistoryEntry, DateRange, MenubarPayload, Period, SpendFlow as SpendFlowData } from '../lib/types'
import { SpendDrivers } from './SpendDrivers'
import { SpendFlow } from './SpendFlow'
import { SpendOverview } from './SpendOverview'
import { SpendProjects } from './SpendProjects'

export type SpendView = 'overview' | 'projects' | 'drivers' | 'flow'

const MAX_CHART_DAYS = 365

export function Spend({ period, provider, projectScopeId, range = null }: { period: Period; provider: string; projectScopeId?: string; range?: DateRange | null }) {
  const scopedProject = projectScopeId && projectScopeId !== 'all' ? projectScopeId : undefined
  const overview = usePolled<MenubarPayload>(
    () => range
      ? scopedProject ? metrora.getOverview(period, provider, range, undefined, false, false, scopedProject) : metrora.getOverview(period, provider, range)
      : scopedProject ? metrora.getOverview(period, provider, undefined, undefined, false, false, scopedProject) : metrora.getOverview(period, provider),
    [period, provider, projectScopeId, range?.from, range?.to],
  )
  return <SpendContent period={period} provider={provider} projectScopeId={projectScopeId} range={range} overview={overview} />
}

export function SpendContent({
  period,
  provider,
  projectScopeId,
  range = null,
  overview,
  refreshToken = 0,
  ready = true,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  refreshToken?: number
  ready?: boolean
}) {
  const scopedProject = projectScopeId && projectScopeId !== 'all' ? projectScopeId : undefined
  const flow = usePolled<SpendFlowData>(
    () => range
      ? scopedProject ? metrora.getSpendFlow(period, provider, range, scopedProject) : metrora.getSpendFlow(period, provider, range)
      : scopedProject ? metrora.getSpendFlow(period, provider, undefined, scopedProject) : metrora.getSpendFlow(period, provider),
    [period, provider, projectScopeId, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `spendflow|${period}|${provider}|${projectScopeId ?? 'all'}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="spend" />
    return <SectionSkeleton label="Loading spend history…" rows={3} chart />
  }

  const animateKey = `${period}|${provider}|${range?.from ?? ''}|${range?.to ?? ''}`
  return <SpendPage data={overview.data} flow={flow} period={period} range={range} staleError={overview.error} animateKey={animateKey} />
}

function chartDaily(data: MenubarPayload, period: Period, range: DateRange | null): DailyHistoryEntry[] {
  const today = localDateKey(new Date())
  const to = range?.to ?? today
  const exact = data.history.periodDaily
  const selected = range
    ? exact ?? sliceDailyToRange(data.history.daily, range.from, range.to)
    : exact ?? sliceDailyToPeriod(data.history.daily, period)
  // Keep the lifetime view bounded to the payload's available history. The
  // source remains authoritative; this only prevents a 1970→today empty-fill
  // from turning the chart into tens of thousands of columns.
  const bounded = selected.length > MAX_CHART_DAYS ? selected.slice(-MAX_CHART_DAYS) : selected
  const from = range?.from ?? ((period === 'lifetime' || period === 'all')
    ? bounded[0]?.date ?? to
    : periodWindowStart(period))
  return contiguousDailyWindow(bounded, from, to)
}

function SpendPage({
  data,
  flow,
  period,
  range,
  staleError,
  animateKey,
}: {
  data: MenubarPayload
  flow: Polled<SpendFlowData>
  period: Period
  range: DateRange | null
  staleError: CliError | null
  animateKey: string
}) {
  const [view, setView] = useState<SpendView>('overview')
  const daily = chartDaily(data, period, range)

  return (
    <div className="spend-page" data-testid="spend-page" data-spend-view={view}>
      {staleError ? <StaleBanner error={staleError} /> : null}
      <div className="spend-heading">
        <div className="spend-title-line">
          <div><h1>Spend</h1><p>Understand where observed AI spend goes and what drives it.</p></div>
          <SectionFreshness report={flow} />
        </div>
        <div className="spend-view-tabs" role="tablist" aria-label="Spend views">
          {([
            ['overview', 'Overview'],
            ['projects', 'Projects'],
            ['drivers', 'Drivers'],
            ['flow', 'Flow'],
          ] as Array<[SpendView, string]>).map(([value, label]) => (
            <button
              type="button"
              key={value}
              role="tab"
              aria-selected={view === value}
              aria-controls={`spend-view-${value}`}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id={`spend-view-${view}`} role="tabpanel" aria-label={`${view} spend view`}>
        {view === 'overview' ? <SpendOverview data={data} daily={daily} animateKey={animateKey} /> : null}
        {view === 'projects' ? <SpendProjects data={data} /> : null}
        {view === 'drivers' ? <SpendDrivers data={data} /> : null}
        {view === 'flow' ? <SpendFlow flow={flow} /> : null}
      </div>
    </div>
  )
}
