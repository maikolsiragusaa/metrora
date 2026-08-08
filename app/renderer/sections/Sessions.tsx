import { Fragment, useEffect, useMemo, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { ProviderLogo } from '../components/ProviderLogo'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import { Stat } from '../components/Stat'
import { usePolled } from '../hooks/usePolled'
import { formatCompact, formatDayLong, formatDuration, formatUsd, shortenProjectPath } from '../lib/format'
import { metrora } from '../lib/ipc'
import { cacheReuseMultiple, cacheShare, costPerMillionObserved, formatReuseMultiple, observedTokenTotal } from '../lib/usageMetrics'
import type { DateRange, Period, ReasoningMix, ReasoningLevelOrUnknown, SessionRow } from '../lib/types'

export const INITIAL_VISIBLE = 120
const STEP = 120

type SessionSort = 'recent' | 'cost' | 'tokens' | 'cache' | 'unitCost'
type SequenceEntry =
  | { type: 'header'; provider: string; count: number; cost: number }
  | { type: 'row'; row: SessionRow }

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Total tokens' },
  { value: 'cache', label: 'Cache reuse' },
  { value: 'unitCost', label: 'Cost / 1M' },
]

const SORT_ANNOUNCEMENTS: Record<SessionSort, string> = {
  recent: 'most recent',
  cost: 'highest cost',
  tokens: 'total observed tokens',
  cache: 'cache reuse',
  unitCost: 'effective cost per one million observed tokens',
}

function providerName(provider: string): string {
  return provider
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const REASONING_LABELS: Record<ReasoningLevelOrUnknown, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  adaptive: 'Adaptive',
  unknown: 'Not identified',
}

export function reasoningMixLabel(mix?: ReasoningMix): string {
  if (!mix) return 'Not available'
  if (mix.totalCalls === 0 || mix.rows.length === 0) return 'No attributed calls'
  const rows = mix.rows.filter(row => row.calls > 0)
  if (rows.length === 0) return 'No attributed calls'
  if (rows.length === 1 && rows[0]!.callShare === 1) return REASONING_LABELS[rows[0]!.level]
  const visible = rows.slice(0, 2).map(row =>
    `${REASONING_LABELS[row.level]} ${Math.round(row.callShare * 100)}%`
  )
  if (rows.length > 2) visible.push(`+${rows.length - 2}`)
  return visible.join(' · ')
}

function reasoningCoverageLabel(mix?: ReasoningMix): string {
  if (!mix) return 'Reasoning attribution unavailable'
  if (mix.totalCalls === 0) return 'No calls to attribute'
  return `${mix.knownCalls.toLocaleString('en-US')} of ${mix.totalCalls.toLocaleString('en-US')} calls known · ${Math.round(mix.coverage * 100)}% coverage`
}

function endedAtTime(row: SessionRow): number {
  const time = new Date(row.endedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sessionTotalTokens(row: SessionRow): number {
  return observedTokenTotal(row)
}

function sessionCacheReuse(row: SessionRow): number | null {
  return cacheReuseMultiple(row.inputTokens, row.cacheReadTokens)
}

function sessionUnitCost(row: SessionRow): number | null {
  return costPerMillionObserved(row.cost, sessionTotalTokens(row))
}

function compareNullableDescending(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return b - a
}

function compareRows(sort: SessionSort, a: SessionRow, b: SessionRow): number {
  if (sort === 'cost') return b.cost - a.cost
  if (sort === 'tokens') return sessionTotalTokens(b) - sessionTotalTokens(a)
  if (sort === 'cache') return compareNullableDescending(sessionCacheReuse(a), sessionCacheReuse(b))
  if (sort === 'unitCost') return compareNullableDescending(sessionUnitCost(a), sessionUnitCost(b))
  return endedAtTime(b) - endedAtTime(a)
}

function groupSortValue(sort: SessionSort, rows: SessionRow[]): number {
  if (sort === 'cost') return rows.reduce((sum, row) => sum + row.cost, 0)
  if (sort === 'tokens') return rows.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
  if (sort === 'cache') {
    const values = rows.map(sessionCacheReuse).filter((value): value is number => value != null)
    return values.length > 0 ? Math.max(...values) : 0
  }
  if (sort === 'unitCost') {
    const cost = rows.reduce((sum, row) => sum + row.cost, 0)
    const tokens = rows.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
    return costPerMillionObserved(cost, tokens) ?? 0
  }
  return rows.reduce((latest, row) => Math.max(latest, endedAtTime(row)), 0)
}

function sessionHeadline(row: SessionRow): string {
  return row.title || shortenProjectPath(row.project)
}

function sessionDetailId(sessionId: string): string {
  return `session-details-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function sessionRowLabel(row: SessionRow, expanded: boolean): string {
  const headline = sessionHeadline(row)
  const project = shortenProjectPath(row.project)
  const parts = [`${expanded ? 'Collapse' : 'Open'} session: ${headline}.`]
  if (row.title && project !== headline) parts.push(`Project ${project}.`)
  parts.push(
    `Session ID ${row.sessionId}.`,
    `Ended ${formatDayLong(row.endedAt)}.`,
    `Models ${row.models.length > 0 ? row.models.join(', ') : 'not identified'}.`,
    `Reasoning ${reasoningMixLabel(row.reasoningMix)}.`,
    `${row.turns.toLocaleString('en-US')} turns.`,
    `Cost ${formatUsd(row.cost)}.`,
    `${formatCompact(sessionTotalTokens(row))} observed tokens.`,
  )
  return parts.join(' ')
}

function formatStartedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUnitCost(value: number | null): string {
  return value == null ? '—' : formatUsd(value)
}

function ProviderFilterRow({
  provider,
  detectedProviders,
  onProviderChange,
}: {
  provider: string
  detectedProviders: Array<{ id: string; label: string }>
  onProviderChange: (value: string) => void
}) {
  if (detectedProviders.length === 0) return null
  return (
    <div className="seg session-provider-filter" role="group" aria-label="Filter sessions by provider">
      <button
        type="button"
        className={provider === 'all' ? 'on' : undefined}
        aria-pressed={provider === 'all'}
        onClick={() => onProviderChange('all')}
      >
        All providers
      </button>
      {detectedProviders.map(entry => (
        <button
          key={entry.id}
          type="button"
          className={provider === entry.id ? 'on' : undefined}
          aria-pressed={provider === entry.id}
          onClick={() => onProviderChange(entry.id)}
        >
          <ProviderLogo provider={entry.id} size={14} />
          {entry.label}
        </button>
      ))}
    </div>
  )
}

export function Sessions({
  period,
  provider,
  range = null,
  refreshToken = 0,
  detectedProviders = [],
  onProviderChange = () => {},
  historicalSessionCount,
  ready = true,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  detectedProviders?: Array<{ id: string; label: string }>
  onProviderChange?: (value: string) => void
  historicalSessionCount?: number | null
  ready?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SessionSort>('recent')
  const [grouped, setGrouped] = useState(false)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const report = usePolled<SessionRow[]>(
    () => range ? metrora.getSessions(period, provider, range) : metrora.getSessions(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `sessions|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )
  const rows = report.data ?? []
  const q = query.trim().toLowerCase()
  const filtered = rows.filter(row => q === '' || [
    row.title ?? '',
    row.project,
    row.sessionId,
    row.models.join(' '),
    row.provider,
    row.reasoningMix?.rows.map(item => item.level).join(' ') ?? '',
  ].some(value => value.toLowerCase().includes(q)))

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE)
  }, [query, sort, grouped, report.data])

  const sequence = useMemo<SequenceEntry[]>(() => {
    if (!grouped) {
      return [...filtered]
        .sort((a, b) => compareRows(sort, a, b))
        .map(row => ({ type: 'row' as const, row }))
    }

    const byProvider = filtered.reduce((map, row) => {
      const providerRows = map.get(row.provider) ?? []
      providerRows.push(row)
      map.set(row.provider, providerRows)
      return map
    }, new Map<string, SessionRow[]>())

    return [...byProvider.entries()]
      .map(([providerName, providerRows]) => ({
        provider: providerName,
        rows: [...providerRows].sort((a, b) => compareRows(sort, a, b)),
        cost: providerRows.reduce((sum, row) => sum + row.cost, 0),
        sortValue: groupSortValue(sort, providerRows),
      }))
      .sort((a, b) => b.sortValue - a.sortValue || a.provider.localeCompare(b.provider))
      .flatMap(group => [
        { type: 'header' as const, provider: group.provider, count: group.rows.length, cost: group.cost },
        ...group.rows.map(row => ({ type: 'row' as const, row })),
      ])
  }, [filtered, grouped, sort])

  const renderedSequence: SequenceEntry[] = []
  let renderedRows = 0
  let pendingHeader: SequenceEntry | null = null
  for (const entry of sequence) {
    if (entry.type === 'header') {
      pendingHeader = entry
      continue
    }
    if (renderedRows >= visibleCount) break
    if (pendingHeader) {
      renderedSequence.push(pendingHeader)
      pendingHeader = null
    }
    renderedSequence.push(entry)
    renderedRows++
  }

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="sessions" />
    return <SectionSkeleton label="Loading available session detail…" rows={5} />
  }

  if (!report.data.length) {
    return (
      <Panel title="Sessions">
        <ProviderFilterRow provider={provider} detectedProviders={detectedProviders} onProviderChange={onProviderChange} />
        <EmptyNote>No detailed sessions are available in this range.</EmptyNote>
      </Panel>
    )
  }

  const totalCost = filtered.reduce((sum, row) => sum + row.cost, 0)
  const totalTokens = filtered.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
  const remaining = filtered.length - renderedRows
  const historicalCount = Math.max(report.data.length, historicalSessionCount ?? report.data.length)
  const unavailableDetail = Math.max(0, historicalCount - report.data.length)
  const sessionCountLabel = `${filtered.length} ${filtered.length === 1 ? 'session' : 'sessions'}`

  const onSortChange = (value: string) => {
    const next = value as SessionSort
    setSort(next)
    // "Recent" means a genuine global newest-first chronology. A provider group
    // is a different lens, so selecting Recent explicitly exits grouping.
    if (next === 'recent') setGrouped(false)
  }

  return (
    <div className="sessions-list-view">
      {report.error && <StaleBanner error={report.error} />}
      <ProviderFilterRow provider={provider} detectedProviders={detectedProviders} onProviderChange={onProviderChange} />
      <div className="sessions-toolbar">
        <input
          className="sessions-search"
          aria-label="Search sessions"
          placeholder="Search title, project, model, provider, or session ID…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <SegTabs options={SORT_OPTIONS} value={sort} onChange={onSortChange} />
        <button
          className="sessions-toggle"
          type="button"
          aria-pressed={grouped}
          onClick={() => setGrouped(value => !value)}
        >
          Group by provider
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {`Sessions sorted by ${SORT_ANNOUNCEMENTS[sort]}, ${grouped ? 'grouped by provider' : 'not grouped by provider'}. ${sessionCountLabel} after filters.`}
      </div>
      <div className="sessions-summary">
        {filtered.length.toLocaleString('en-US')} detailed sessions · {formatUsd(totalCost)} · {formatCompact(totalTokens)} observed tokens
        {unavailableDetail > 0 ? ` · ${historicalCount.toLocaleString('en-US')} sessions in historical totals` : ''}
      </div>
      {unavailableDetail > 0 && query === '' ? (
        <div className="stale-banner">
          {unavailableDetail.toLocaleString('en-US')} older session{unavailableDetail === 1 ? '' : 's'} remain in durable historical totals but no longer have source detail on this device.
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <div className="sessions-empty">
          <EmptyNote>No sessions match &quot;{query}&quot;.</EmptyNote>
          <button className="sessions-clear" type="button" onClick={() => setQuery('')}>Clear search</button>
        </div>
      ) : (
        <>
          <Panel className="scroll-x">
            <table aria-label="Detailed sessions">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Client</th>
                  <th>Started</th>
                  <th>Model</th>
                  <th>Calls</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache R</th>
                  <th>Cache W</th>
                  <th title="Cached input read per uncached input token">Cache ×</th>
                  <th>Total</th>
                  <th>Cost</th>
                  <th title="Effective API-equivalent value per 1M observed tokens">Cost / 1M</th>
                </tr>
              </thead>
              <tbody>
                {renderedSequence.map(entry => entry.type === 'header' ? (
                  <tr key={`provider-${entry.provider}`}>
                    <td colSpan={13}>
                      <strong>{providerName(entry.provider)}</strong>
                      <span style={{ color: 'var(--mut)', marginLeft: 8 }}>{entry.count.toLocaleString('en-US')} sessions · {formatUsd(entry.cost)}</span>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={entry.row.sessionId}>
                    <tr>
                      <td>
                        <button
                          className="alias"
                          type="button"
                          aria-label={sessionRowLabel(entry.row, selectedId === entry.row.sessionId)}
                          aria-expanded={selectedId === entry.row.sessionId}
                          aria-controls={sessionDetailId(entry.row.sessionId)}
                          title={entry.row.title || entry.row.sessionId}
                          onClick={() => setSelectedId(current => current === entry.row.sessionId ? null : entry.row.sessionId)}
                        >
                          {sessionHeadline(entry.row)}
                        </button>
                        <div style={{ color: 'var(--mut2)', fontSize: 'var(--fs-micro)', marginTop: 2 }}>{entry.row.sessionId.slice(0, 18)}</div>
                      </td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ProviderLogo provider={entry.row.provider} size={14} />{providerName(entry.row.provider)}</span></td>
                      <td>{formatStartedAt(entry.row.startedAt)}</td>
                      <td title={entry.row.models.join(', ')}>{entry.row.models.join(', ') || '—'}</td>
                      <td>{entry.row.calls.toLocaleString('en-US')}</td>
                      <td>{formatCompact(entry.row.inputTokens)}</td>
                      <td>{formatCompact(entry.row.outputTokens)}</td>
                      <td>{formatCompact(entry.row.cacheReadTokens)}</td>
                      <td>{formatCompact(entry.row.cacheWriteTokens)}</td>
                      <td title={cacheShare(entry.row.inputTokens, entry.row.cacheReadTokens) == null ? undefined : `${Math.round((cacheShare(entry.row.inputTokens, entry.row.cacheReadTokens) ?? 0) * 1000) / 10}% of input served from cache`}>{formatReuseMultiple(sessionCacheReuse(entry.row))}</td>
                      <td>{formatCompact(sessionTotalTokens(entry.row))}</td>
                      <td>{formatUsd(entry.row.cost)}</td>
                      <td>{formatUnitCost(sessionUnitCost(entry.row))}</td>
                    </tr>
                    {selectedId === entry.row.sessionId && (
                      <tr>
                        <td colSpan={13} id={sessionDetailId(entry.row.sessionId)}>
                          <SessionDetail session={entry.row} onCollapse={() => setSelectedId(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Panel>
          <div className="sessions-more-caption">Showing {renderedRows} of {filtered.length}</div>
          {remaining > 0 && (
            <button className="sessions-more" type="button" onClick={() => setVisibleCount(value => value + STEP)}>
              Show {Math.min(STEP, remaining)} more · {remaining} remaining
            </button>
          )}
        </>
      )}
    </div>
  )
}

function SessionDetail({ session, onCollapse }: { session: SessionRow; onCollapse: () => void }) {
  const totalTokens = sessionTotalTokens(session)
  const reuse = sessionCacheReuse(session)
  const share = cacheShare(session.inputTokens, session.cacheReadTokens)
  const unitCost = sessionUnitCost(session)
  const reasoningTokenSummary = session.reasoningTokens === undefined
    ? 'Reasoning-token count unavailable'
    : `${formatCompact(session.reasoningTokens)} dedicated reasoning tokens`

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCollapse()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCollapse])

  return (
    <div className="session-inline-detail" role="region" aria-label={`${shortenProjectPath(session.project)} session details`}>
      <div className="detail-head">
        <h3 className="detail-title">{shortenProjectPath(session.project)}</h3>
        <div className="detail-line">{providerName(session.provider)} · {session.models.join(', ')}</div>
        <div className="detail-line">Reasoning · {reasoningMixLabel(session.reasoningMix)} · {reasoningCoverageLabel(session.reasoningMix)}</div>
        <div className="detail-line">
          {formatStartedAt(session.startedAt)} → {formatStartedAt(session.endedAt)} · {formatDuration(session.durationMs)}
        </div>
      </div>
      <div className="stats">
        <Stat label="Cost" value={formatUsd(session.cost)} delta="API-equivalent value" />
        <Stat label="Cost / 1M" value={formatUnitCost(unitCost)} delta="observed tokens" />
        <Stat label="Calls" value={session.calls.toLocaleString()} delta="API calls" />
        <Stat label="Turns" value={session.turns.toLocaleString()} delta="assistant turns" />
        <Stat label="Input" value={formatCompact(session.inputTokens)} delta="uncached input" />
        <Stat label="Output" value={formatCompact(session.outputTokens)} delta="generated" />
        <Stat label="Cache read" value={formatCompact(session.cacheReadTokens)} delta="reused input" />
        <Stat label="Cache write" value={formatCompact(session.cacheWriteTokens)} delta="written to cache" />
        <Stat label="Cache reuse" value={formatReuseMultiple(reuse)} delta={share == null ? 'No comparable input' : `${Math.round(share * 1000) / 10}% cache share`} />
        <Stat label="Total" value={formatCompact(totalTokens)} delta="observed tokens" />
        {session.savingsUSD > 0 ? <Stat label="Saved" value={formatUsd(session.savingsUSD)} delta="configured baseline" /> : null}
      </div>
      {session.reasoningMix && session.reasoningMix.rows.length > 0 && (
        <div className="reasoning-detail">
          <div className="reasoning-detail-head">
            <span>Reasoning mix by API call</span>
            <span>{reasoningTokenSummary}</span>
          </div>
          <div className="reasoning-detail-rows">
            {session.reasoningMix.rows.map(row => (
              <div className="reasoning-detail-row" key={row.level}>
                <span className="reasoning-detail-label">{REASONING_LABELS[row.level]}</span>
                <span className="reasoning-detail-track"><span style={{ width: `${Math.max(2, row.callShare * 100)}%` }} /></span>
                <span className="reasoning-detail-value">
                  {Math.round(row.callShare * 100)}% · {row.calls.toLocaleString('en-US')} calls · {formatCompact(row.reasoningTokens)} reasoning tokens
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
