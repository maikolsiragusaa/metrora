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
import { formatCompact, formatDayLong, formatDayShort, formatDuration, formatUsd, shortenProjectPath } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { DateRange, Period, ReasoningMix, ReasoningLevelOrUnknown, SessionRow } from '../lib/types'

export const INITIAL_VISIBLE = 120
const STEP = 120

type SessionSort = 'cost' | 'recent' | 'turns' | 'tokens'
type SequenceEntry =
  | { type: 'header'; provider: string; count: number; cost: number }
  | { type: 'row'; row: SessionRow }

const SORT_OPTIONS = [
  { value: 'cost', label: 'Cost' },
  { value: 'recent', label: 'Recent' },
  { value: 'turns', label: 'Turns' },
  { value: 'tokens', label: 'Tokens' },
]

const SORT_ANNOUNCEMENTS: Record<SessionSort, string> = {
  cost: 'highest cost',
  recent: 'most recent',
  turns: 'turn count',
  tokens: 'token count',
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

function compareRows(sort: SessionSort, a: SessionRow, b: SessionRow): number {
  if (sort === 'cost') return b.cost - a.cost
  if (sort === 'turns') return b.turns - a.turns
  if (sort === 'tokens') {
    return (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
  }
  return endedAtTime(b) - endedAtTime(a)
}

function groupSortValue(sort: SessionSort, rows: SessionRow[]): number {
  if (sort === 'cost') return rows.reduce((sum, row) => sum + row.cost, 0)
  if (sort === 'turns') return rows.reduce((sum, row) => sum + row.turns, 0)
  if (sort === 'tokens') {
    return rows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
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
    `${formatCompact(row.inputTokens + row.outputTokens)} tokens.`,
  )
  return parts.join(' ')
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
        All
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
  ready = true,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  detectedProviders?: Array<{ id: string; label: string }>
  onProviderChange?: (value: string) => void
  ready?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SessionSort>('cost')
  const [grouped, setGrouped] = useState(true)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const report = usePolled<SessionRow[]>(
    () => range ? codeburn.getSessions(period, provider, range) : codeburn.getSessions(period, provider),
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
    return <SectionSkeleton label="Scanning sessions…" rows={5} />
  }

  if (!report.data.length) {
    return (
      <Panel title="Sessions">
        <ProviderFilterRow provider={provider} detectedProviders={detectedProviders} onProviderChange={onProviderChange} />
        <EmptyNote>No sessions in this range yet.</EmptyNote>
      </Panel>
    )
  }

  const totalCost = filtered.reduce((sum, row) => sum + row.cost, 0)
  const totalTokens = filtered.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
  const remaining = filtered.length - renderedRows
  const sessionCountLabel = `${filtered.length} ${filtered.length === 1 ? 'session' : 'sessions'}`

  return (
    <div className="sessions-list-view">
      {report.error && <StaleBanner error={report.error} />}
      <ProviderFilterRow provider={provider} detectedProviders={detectedProviders} onProviderChange={onProviderChange} />
      <div className="sessions-toolbar">
        <input
          className="sessions-search"
          aria-label="Search sessions"
          placeholder="Search title, project, model, or session ID…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <SegTabs
          options={SORT_OPTIONS}
          value={sort}
          onChange={value => setSort(value as SessionSort)}
        />
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
        {filtered.length} sessions · {formatUsd(totalCost)} · {formatCompact(totalTokens)} tokens
      </div>
      {filtered.length === 0 ? (
        <div className="sessions-empty">
          <EmptyNote>No sessions match &quot;{query}&quot;.</EmptyNote>
          <button className="sessions-clear" type="button" onClick={() => setQuery('')}>Clear search</button>
        </div>
      ) : (
        <>
          <div className="session-list">
            {renderedSequence.map(entry => entry.type === 'header' ? (
              <div
                className="provider-h"
                key={`provider-${entry.provider}`}
                role="heading"
                aria-level={3}
                aria-label={`${providerName(entry.provider)}: ${entry.count.toLocaleString('en-US')} sessions, ${formatUsd(entry.cost)}`}
              >
                <span>{providerName(entry.provider)}</span>
                <span className="provider-count">{entry.count.toLocaleString('en-US')} sessions</span>
                <span className="provider-cost">{formatUsd(entry.cost)}</span>
              </div>
            ) : (
              <Fragment key={entry.row.sessionId}>
                <button
                  className="session-row"
                  type="button"
                  aria-label={sessionRowLabel(entry.row, selectedId === entry.row.sessionId)}
                  aria-expanded={selectedId === entry.row.sessionId}
                  aria-controls={sessionDetailId(entry.row.sessionId)}
                  onClick={() => setSelectedId(current => current === entry.row.sessionId ? null : entry.row.sessionId)}
                >
                  <span className="session-primary">
                    <span className="session-chevron" aria-hidden="true">›</span>
                    <span className="session-project-copy">
                      <span className="session-title" title={entry.row.title || undefined}>{sessionHeadline(entry.row)}</span>
                      <span className="session-project">Session ID · {entry.row.sessionId.slice(0, 18)}</span>
                    </span>
                  </span>
                  <span className="session-when">{formatDayShort(entry.row.endedAt)}</span>
                  <span className="session-models">
                    <span className="session-model-list">{entry.row.models.join(', ')}</span>
                    <span className="session-reasoning-mix">{reasoningMixLabel(entry.row.reasoningMix)}</span>
                  </span>
                  <span>{entry.row.turns}</span>
                  <span>{formatUsd(entry.row.cost)}</span>
                  <span>{formatCompact(entry.row.inputTokens + entry.row.outputTokens)}</span>
                </button>
                {selectedId === entry.row.sessionId && (
                  <SessionDetail session={entry.row} onCollapse={() => setSelectedId(null)} />
                )}
              </Fragment>
            ))}
          </div>
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
  const cacheTotal = session.inputTokens + session.cacheReadTokens
  const cacheHit = cacheTotal > 0 ? Math.round(session.cacheReadTokens / cacheTotal * 100) : null
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
    <div
      id={sessionDetailId(session.sessionId)}
      className="session-inline-detail"
      role="region"
      aria-label={`${shortenProjectPath(session.project)} session details`}
    >
      <div className="detail-head">
        <h3 className="detail-title">{shortenProjectPath(session.project)}</h3>
        <div className="detail-line">{session.provider} · {session.models.join(', ')}</div>
        <div className="detail-line">Reasoning · {reasoningMixLabel(session.reasoningMix)} · {reasoningCoverageLabel(session.reasoningMix)}</div>
        <div className="detail-line">
          {formatDayLong(session.startedAt)} → {formatDayLong(session.endedAt)} · {formatDuration(session.durationMs)}
        </div>
      </div>
      <div className="stats">
        <Stat label="Cost" value={formatUsd(session.cost)} delta="this session" />
        <Stat label="Calls" value={session.calls.toLocaleString()} delta="API calls" />
        <Stat label="Turns" value={session.turns.toLocaleString()} delta="assistant turns" />
        <Stat label="Saved" value={formatUsd(session.savingsUSD)} delta="vs baseline" />
        <Stat label="Input" value={formatCompact(session.inputTokens)} delta="tokens sent" />
        <Stat label="Output" value={formatCompact(session.outputTokens)} delta="tokens generated" />
        <Stat label="Cache read" value={formatCompact(session.cacheReadTokens)} delta={cacheHit === null ? 'No cacheable input' : `${cacheHit}% hit`} />
        <Stat label="Cache write" value={formatCompact(session.cacheWriteTokens)} delta="tokens cached" />
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
