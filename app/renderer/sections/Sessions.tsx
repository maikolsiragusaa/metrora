import { useEffect, useMemo, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import { usePolled } from '../hooks/usePolled'
import { formatCompact, formatDuration, formatUsd, shortenProjectPath } from '../lib/format'
import { metrora } from '../lib/ipc'
import type { DateRange, Period, SessionRow } from '../lib/types'
import { SessionsInspector } from './SessionsInspector'
import {
  compareRows,
  formatSessionTime,
  formatReuseMultiple,
  formatUnitCost,
  groupSortValue,
  reasoningMixLabel,
  SESSION_PAGE_SIZE,
  sessionCacheReuse,
  sessionCacheShare,
  sessionDetailId,
  sessionHeadline,
  sessionIdentity,
  sessionRowLabel,
  sessionTotalTokens,
  sessionUnitCost,
  SORT_ANNOUNCEMENTS,
  SORT_OPTIONS,
  type SessionSort,
} from './sessions-presentation'

export const INITIAL_VISIBLE = SESSION_PAGE_SIZE

export { reasoningMixLabel }

type SequenceEntry =
  | { type: 'header'; provider: string; count: number; cost: number }
  | { type: 'row'; row: SessionRow }

type ProviderFilter = { id: string; label: string }
type SessionDateFilter = 'all' | 'today' | '7days' | '30days' | 'month' | '6months'

const SESSION_DATE_FILTERS: Array<{ value: SessionDateFilter; label: string }> = [
  { value: 'all', label: 'Date' },
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7D' },
  { value: '30days', label: '30D' },
  { value: 'month', label: 'Month' },
  { value: '6months', label: '6M' },
]

function providerFilters(rows: SessionRow[], detectedProviders: ProviderFilter[]): ProviderFilter[] {
  const entries = new Map<string, ProviderFilter>()
  for (const entry of detectedProviders) {
    if (entry.id && !entries.has(entry.id)) entries.set(entry.id, entry)
  }
  for (const row of rows) {
    if (row.provider && !entries.has(row.provider)) entries.set(row.provider, { id: row.provider, label: providerLabel(row.provider) })
  }
  return [...entries.values()]
}

function providerLabel(provider: string): string {
  return provider.replace(/[-\s]+/g, ' ').replace(/\b\w/g, value => value.toUpperCase())
}

function filterOptions(rows: SessionRow[], getValue: (row: SessionRow) => string): string[] {
  return [...new Set(rows.map(getValue).map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function sessionDateStart(filter: SessionDateFilter): number | null {
  if (filter === 'all') return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  if (filter === 'today') return now.getTime()
  if (filter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const days = filter === '7days' ? 7 : filter === '30days' ? 30 : 183
  now.setDate(now.getDate() - days + 1)
  return now.getTime()
}

function matchesSessionDate(iso: string, filter: SessionDateFilter): boolean {
  const timestamp = new Date(iso).getTime()
  const start = sessionDateStart(filter)
  return start === null || (Number.isFinite(timestamp) && timestamp >= start)
}

function SessionFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="sessions-filter-select">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        <option value="all">{label}</option>
        {options.filter(option => option.value !== 'all').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </label>
  )
}

function ProviderFilterRow({ provider, detectedProviders, onProviderChange }: { provider: string; detectedProviders: ProviderFilter[]; onProviderChange: (value: string) => void }) {
  if (detectedProviders.length === 0) return null
  return (
    <div
      className="session-provider-filter"
      role="group"
      aria-label="Filter sessions by provider"
      data-provider-strip="true"
      onWheel={event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.currentTarget.scrollLeft += event.deltaY
          event.preventDefault()
        }
      }}
    >
      <button type="button" className={provider === 'all' ? 'on' : undefined} aria-pressed={provider === 'all'} onClick={() => onProviderChange('all')}>
        <span className="session-provider-all-icon" aria-hidden="true">✦</span>
        All providers
      </button>
      {detectedProviders.map(entry => (
        <button key={entry.id} type="button" className={provider === entry.id ? 'on' : undefined} aria-pressed={provider === entry.id} onClick={() => onProviderChange(entry.id)}>
          <ProviderLogo provider={entry.id} size={15} />
          {entry.label}
        </button>
      ))}
    </div>
  )
}

function sequenceForRows(rows: SessionRow[], grouped: boolean, sort: SessionSort): SequenceEntry[] {
  if (!grouped) return [...rows].sort((a, b) => compareRows(sort, a, b)).map(row => ({ type: 'row' as const, row }))

  const byProvider = rows.reduce((map, row) => {
    const providerRows = map.get(row.provider) ?? []
    providerRows.push(row)
    map.set(row.provider, providerRows)
    return map
  }, new Map<string, SessionRow[]>())

  return [...byProvider.entries()]
    .map(([provider, providerRows]) => ({
      provider,
      rows: [...providerRows].sort((a, b) => compareRows(sort, a, b)),
      cost: providerRows.reduce((sum, row) => sum + row.cost, 0),
      sortValue: groupSortValue(sort, providerRows),
    }))
    .sort((a, b) => b.sortValue - a.sortValue || a.provider.localeCompare(b.provider))
    .flatMap(group => [
      { type: 'header' as const, provider: group.provider, count: group.rows.length, cost: group.cost },
      ...group.rows.map(row => ({ type: 'row' as const, row })),
    ])
}

function pageSequence(sequence: SequenceEntry[], page: number): SequenceEntry[] {
  const start = page * SESSION_PAGE_SIZE
  const end = start + SESSION_PAGE_SIZE
  const result: SequenceEntry[] = []
  let rowIndex = 0
  let pendingHeader: SequenceEntry | null = null

  for (const entry of sequence) {
    if (entry.type === 'header') {
      pendingHeader = entry
      continue
    }
    if (rowIndex >= start && rowIndex < end) {
      if (pendingHeader) {
        result.push(pendingHeader)
        pendingHeader = null
      }
      result.push(entry)
    }
    rowIndex++
    if (rowIndex >= end) break
  }
  return result
}

function pageItems(totalPages: number, page: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index)
  const last = totalPages - 1
  if (page <= 2) return [0, 1, 2, 3, 4, 'ellipsis', last]
  if (page >= last - 2) return [0, 'ellipsis', last - 4, last - 3, last - 2, last - 1, last]
  return [0, 'ellipsis', page - 1, page, page + 1, 'ellipsis', last]
}

function SessionTableRow({ row, selected, onSelect }: { row: SessionRow; selected: boolean; onSelect: () => void }) {
  const reuse = sessionCacheReuse(row)
  const share = sessionCacheShare(row)
  const modelLabel = row.models.join(', ') || 'Model not identified'
  const headline = sessionHeadline(row)
  const projectLabel = shortenProjectPath(row.project)
  const detailId = sessionDetailId(row)
  return (
    <tr
      className={selected ? 'session-data-row is-selected' : 'session-data-row'}
      aria-selected={selected}
      onClick={event => {
        if ((event.target as HTMLElement).closest('button,a')) return
        onSelect()
      }}
    >
      <td className="session-cell">
        <button
          type="button"
          className="session-row-trigger"
          aria-label={sessionRowLabel(row, selected)}
          aria-expanded={selected}
          aria-controls={detailId}
          aria-pressed={selected}
          title={row.title || row.sessionId}
          onClick={onSelect}
        >
          <span className="session-row-marker" aria-hidden="true" />
          <span className="session-row-copy">
            <strong className="session-row-title">{headline}</strong>
            {projectLabel && projectLabel !== headline ? <span className="session-row-project" title={row.project}>{projectLabel}</span> : null}
            <span className="session-row-id" title={row.sessionId}>{row.sessionId}</span>
          </span>
        </button>
      </td>
      <td className="session-client-cell">
        <span className="session-client"><ProviderLogo provider={row.provider} size={15} /><span>{providerLabel(row.provider)}</span></span>
      </td>
      <td className="session-model-cell" title={modelLabel}>{modelLabel}</td>
      <td className="session-number">{row.turns.toLocaleString('en-US')}</td>
      <td className="session-number">{row.calls.toLocaleString('en-US')}</td>
      <td className="session-number token-input">{formatCompact(row.inputTokens)}</td>
      <td className="session-number token-output">{formatCompact(row.outputTokens)}</td>
      <td className="session-number token-cache">{formatCompact(row.cacheReadTokens)}</td>
      <td className="session-number token-cache">{formatCompact(row.cacheWriteTokens)}</td>
      <td className="session-number token-multiple" title={share == null ? undefined : `${Math.round(share * 1000) / 10}% of input served from cache`}>{formatReuseMultiple(reuse)}</td>
      <td className="session-number session-total">{formatCompact(sessionTotalTokens(row))}</td>
      <td className="session-number session-cost">{formatUsd(row.cost)}</td>
      <td className="session-number session-unit-cost">{formatUnitCost(sessionUnitCost(row))}</td>
      <td className="session-number session-duration">{formatDuration(row.durationMs)}</td>
      <td className="session-last-active"><time dateTime={row.endedAt}>{formatSessionTime(row.endedAt)}</time></td>
    </tr>
  )
}

function SessionsPagination({ page, totalPages, totalRows, onPageChange }: { page: number; totalPages: number; totalRows: number; onPageChange: (page: number) => void }) {
  if (totalRows === 0) return null
  const start = page * SESSION_PAGE_SIZE + 1
  const end = Math.min(totalRows, (page + 1) * SESSION_PAGE_SIZE)
  return (
    <footer className="sessions-pagination">
      <span className="sessions-pagination-summary">Showing {start.toLocaleString('en-US')}–{end.toLocaleString('en-US')} of {totalRows.toLocaleString('en-US')}</span>
      <div className="sessions-page-buttons" role="group" aria-label="Sessions pagination">
        <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPageChange(page - 1)}>‹</button>
        {pageItems(totalPages, page).map((item, index) => item === 'ellipsis'
          ? <span className="sessions-page-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
          : <button key={item} type="button" className={item === page ? 'on' : undefined} aria-current={item === page ? 'page' : undefined} aria-label={`Go to page ${item + 1}`} onClick={() => onPageChange(item)}>{item + 1}</button>)}
        <button type="button" aria-label="Next page" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>›</button>
      </div>
    </footer>
  )
}

export function Sessions({
  period,
  provider,
  projectScopeId,
  range = null,
  refreshToken = 0,
  detectedProviders = [],
  onProviderChange = () => {},
  historicalSessionCount,
  ready = true,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  refreshToken?: number
  detectedProviders?: Array<{ id: string; label: string }>
  onProviderChange?: (value: string) => void
  historicalSessionCount?: number | null
  ready?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [modelFilter, setModelFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<SessionDateFilter>('all')
  const [sort, setSort] = useState<SessionSort>('recent')
  const [grouped, setGrouped] = useState(false)
  const [page, setPage] = useState(0)
  const scopedProject = projectScopeId && projectScopeId !== 'all' ? projectScopeId : undefined
  const report = usePolled<SessionRow[]>(
    () => range
      ? scopedProject ? metrora.getSessions(period, provider, range, scopedProject) : metrora.getSessions(period, provider, range)
      : scopedProject ? metrora.getSessions(period, provider, undefined, scopedProject) : metrora.getSessions(period, provider),
    [period, provider, projectScopeId, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `sessions|${period}|${provider}|${projectScopeId ?? 'all'}|${range?.from ?? ''}-${range?.to ?? ''}` },
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
    row.prLinks?.join(' ') ?? '',
  ].some(value => value.toLowerCase().includes(q)))
    .filter(row => projectFilter === 'all' || row.project === projectFilter)
    .filter(row => modelFilter === 'all' || row.models.includes(modelFilter))
    .filter(row => clientFilter === 'all' || row.provider === clientFilter)
    .filter(row => matchesSessionDate(row.endedAt, dateFilter))
  const availableProviders = useMemo(() => providerFilters(rows, detectedProviders), [rows, detectedProviders])
  const projectOptions = useMemo(() => filterOptions(rows, row => row.project).map(value => ({ value, label: shortenProjectPath(value) })), [rows])
  const modelOptions = useMemo(() => [...new Set(rows.flatMap(row => row.models.map(model => model.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b)).map(value => ({ value, label: value })), [rows])
  const clientOptions = useMemo(() => filterOptions(rows, row => row.provider).map(value => ({ value, label: providerLabel(value) })), [rows])
  const sequence = useMemo(() => sequenceForRows(filtered, grouped, sort), [filtered, grouped, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / SESSION_PAGE_SIZE))
  const selectedSession = selectedId ? rows.find(row => sessionIdentity(row) === selectedId) ?? null : null
  const selectedStillVisible = selectedId === null || filtered.some(row => sessionIdentity(row) === selectedId)

  useEffect(() => {
    setPage(0)
  }, [query, sort, grouped, period, provider, projectScopeId, range?.from, range?.to, projectFilter, modelFilter, clientFilter, dateFilter])

  useEffect(() => {
    setPage(current => Math.min(current, totalPages - 1))
  }, [totalPages])

  useEffect(() => {
    if (!selectedStillVisible) setSelectedId(null)
  }, [selectedStillVisible])

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="sessions" />
    return <SectionSkeleton label="Loading available session detail…" rows={5} />
  }

  const totalCost = filtered.reduce((sum, row) => sum + row.cost, 0)
  const totalTokens = filtered.reduce((sum, row) => sum + sessionTotalTokens(row), 0)
  const historicalCount = Math.max(report.data.length, historicalSessionCount ?? report.data.length)
  const unavailableDetail = Math.max(0, historicalCount - report.data.length)
  const sessionCountLabel = `${filtered.length.toLocaleString('en-US')} ${filtered.length === 1 ? 'session' : 'sessions'}`
  const renderedSequence = pageSequence(sequence, page)
  const renderedRows = Math.min(SESSION_PAGE_SIZE, Math.max(0, filtered.length - page * SESSION_PAGE_SIZE))

  const onSortChange = (value: string) => {
    const next = value as SessionSort
    setSort(next)
    if (next === 'recent') setGrouped(false)
  }

  const clearFilters = () => {
    setQuery('')
    setProjectFilter('all')
    setModelFilter('all')
    setClientFilter('all')
    setDateFilter('all')
  }

  return (
    <div className={selectedSession ? 'sessions-page has-inspector' : 'sessions-page'}>
      <div className="sessions-workspace">
        <section className="sessions-list-pane" aria-label="Sessions list">
          {report.error && <StaleBanner error={report.error} />}
          <div className="sessions-heading">
            <div className="sessions-title-line">
              <h1>Sessions</h1>
              <span>{sessionCountLabel} <i>·</i> {formatUsd(totalCost)} total spend <i>·</i> {formatCompact(totalTokens)} tokens</span>
            </div>
            {unavailableDetail > 0 && query === '' ? <p>{unavailableDetail.toLocaleString('en-US')} older session{unavailableDetail === 1 ? '' : 's'} remain in durable historical totals without source detail on this device.</p> : null}
          </div>

          <ProviderFilterRow provider={provider} detectedProviders={availableProviders} onProviderChange={onProviderChange} />

          <div className="sessions-toolbar" role="group" aria-label="Session filters" data-filter-layout="single-row-when-closed">
            <label className="session-search-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
              <span className="sr-only">Search sessions</span>
              <input aria-label="Search sessions" placeholder="Filter sessions…" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <SessionFilterSelect label="Project" value={projectFilter} options={projectOptions} onChange={setProjectFilter} />
            <SessionFilterSelect label="Model" value={modelFilter} options={modelOptions} onChange={setModelFilter} />
            <SessionFilterSelect label="Client" value={clientFilter} options={clientOptions} onChange={setClientFilter} />
            <SessionFilterSelect label="Date" value={dateFilter} options={SESSION_DATE_FILTERS} onChange={value => setDateFilter(value as SessionDateFilter)} />
          </div>

          <div className="sessions-sort-toolbar">
            <div className="sessions-sort" aria-label="Sort sessions">
              <SegTabs options={SORT_OPTIONS} value={sort} onChange={onSortChange} />
            </div>
            <button className={grouped ? 'sessions-group-toggle on' : 'sessions-group-toggle'} type="button" aria-pressed={grouped} onClick={() => setGrouped(value => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6" /><circle cx="18" cy="12" r="2.5" /></svg>
              Group by provider
            </button>
          </div>

          <div className="sr-only" role="status" aria-live="polite">
            {`Sessions sorted by ${SORT_ANNOUNCEMENTS[sort]}, ${grouped ? 'grouped by provider' : 'not grouped by provider'}. ${sessionCountLabel} after filters.`}
          </div>

          {report.data.length === 0 ? (
            <div className="sessions-empty-state">
              <strong>No detailed sessions are available in this range.</strong>
              <EmptyNote>Historical totals can remain available even when the source transcript is no longer on this device.</EmptyNote>
            </div>
          ) : filtered.length === 0 ? (
            <div className="sessions-empty-state">
              <strong>{q ? `No sessions match "${query}".` : 'No sessions match the current filters.'}</strong>
              <button type="button" onClick={clearFilters}>{q ? 'Clear search' : 'Clear filters'}</button>
            </div>
          ) : (
            <>
              <div className="sessions-table-panel">
                <div className="sessions-table-scroll" role="region" aria-label="Detailed sessions table" data-scroll-mode="page">
                  <table className="sessions-table" aria-label="Detailed sessions">
                    <colgroup>
                      <col className="session-col-session" /><col className="session-col-client" /><col className="session-col-model" />
                      <col className="session-col-turns" /><col className="session-col-calls" /><col className="session-col-token" /><col className="session-col-token" />
                      <col className="session-col-token" /><col className="session-col-token" /><col className="session-col-cache" /><col className="session-col-total" />
                      <col className="session-col-cost" /><col className="session-col-unit" /><col className="session-col-duration" /><col className="session-col-last" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Client</th>
                        <th>Model</th>
                        <th className="session-number">Turn</th>
                        <th className="session-number" title="Canonical API call count; an exact message count is not part of the session projection">Calls</th>
                        <th className="session-number">Input</th>
                        <th className="session-number">Output</th>
                        <th className="session-number">Cache R</th>
                        <th className="session-number">Cache W</th>
                        <th className="session-number" title="Cached input read per uncached input token">Cache×</th>
                        <th className="session-number">Total</th>
                        <th className="session-number">Cost</th>
                        <th className="session-number" title="Effective cost per one million total tokens">Cost/1M</th>
                        <th className="session-number">Duration</th>
                        <th>Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderedSequence.map(entry => entry.type === 'header' ? (
                        <tr className="session-provider-group" key={`provider-${entry.provider}`}>
                          <td colSpan={15}><ProviderLogo provider={entry.provider} size={14} /><strong>{providerLabel(entry.provider)}</strong><span>{entry.count.toLocaleString('en-US')} sessions · {formatUsd(entry.cost)}</span></td>
                        </tr>
                      ) : (
                        <SessionTableRow
                          key={sessionIdentity(entry.row)}
                          row={entry.row}
                          selected={selectedId === sessionIdentity(entry.row)}
                          onSelect={() => setSelectedId(sessionIdentity(entry.row))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <SessionsPagination page={page} totalPages={totalPages} totalRows={filtered.length} onPageChange={setPage} />
              <div className="sessions-bounded-note">{renderedRows.toLocaleString('en-US')} rows rendered from {filtered.length.toLocaleString('en-US')} matching sessions · one shared session result</div>
            </>
          )}
        </section>

        {selectedSession ? <SessionsInspector session={selectedSession} inspectorId={sessionDetailId(selectedSession)} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  )
}
