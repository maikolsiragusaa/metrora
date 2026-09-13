import { useEffect, useMemo, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { Dropdown } from '../components/Dropdown'
import { EmptyNote } from '../components/EmptyState'
import { ProviderFilterStrip } from '../components/ProviderFilterStrip'
import { ProviderLogo } from '../components/ProviderLogo'
import { SectionSkeleton } from '../components/Skeleton'
import { StaleBanner } from '../components/StaleBanner'
import { usePolled } from '../hooks/usePolled'
import { formatCompact, formatDuration, formatUsd, shortenProjectPath } from '../lib/format'
import { metrora } from '../lib/ipc'
import { modelHouseIdFromName, modelHouseLabel, modelHouseLogoKey, type ModelHouseId } from '../lib/modelPresentation'
import type { DateRange, Period, SessionRow } from '../lib/types'
import { SessionsInspector } from './SessionsInspector'
import {
  compareRowsBy,
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
  sessionSortAnnouncement,
  sessionTotalTokens,
  sessionUnitCost,
  type SessionColumnSort,
  type SessionSortKey,
} from './sessions-presentation'

export const INITIAL_VISIBLE = SESSION_PAGE_SIZE

export { reasoningMixLabel }

type SequenceEntry =
  | { type: 'header'; client: string; count: number; cost: number }
  | { type: 'row'; row: SessionRow }

type SessionDateFilter = 'all' | 'today' | '7days' | '30days' | 'month' | '6months'

const SESSION_DATE_FILTERS: Array<{ value: SessionDateFilter; label: string }> = [
  { value: 'all', label: 'Date' },
  { value: 'today', label: 'Today' },
  { value: '7days', label: '7D' },
  { value: '30days', label: '30D' },
  { value: 'month', label: 'Month' },
  { value: '6months', label: '6M' },
]

/** Model brand (OpenAI, Anthropic, …) strip options observed in the session rows.
 * Rows with no brand-resolvable model count as 'unresolved' so the strip stays
 * visible and those sessions remain reachable. */
function sessionBrandOptions(rows: SessionRow[]): ModelHouseId[] {
  const brands = new Set<ModelHouseId>()
  for (const row of rows) {
    if (sessionBrandUnresolved(row)) brands.add('unresolved')
    for (const model of row.models) {
      const brand = modelHouseIdFromName(model)
      if (brand) brands.add(brand)
    }
  }
  return [...brands].sort((a, b) => {
    if (a === 'unresolved') return 1
    if (b === 'unresolved') return -1
    return modelHouseLabel(a).localeCompare(modelHouseLabel(b))
  })
}

function sessionBrandUnresolved(row: SessionRow): boolean {
  return row.models.length === 0 || row.models.some(model => modelHouseIdFromName(model) === undefined)
}

function sessionMatchesBrand(row: SessionRow, brand: ModelHouseId): boolean {
  if (brand === 'unresolved') return sessionBrandUnresolved(row)
  return row.models.some(model => modelHouseIdFromName(model) === brand)
}

function clientLabel(client: string): string {
  return client.replace(/[-\s]+/g, ' ').replace(/\b\w/g, value => value.toUpperCase())
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

/** Shared-theme filter dropdown; the custom listbox keeps option text legible
 * in both themes (native selects inherit unreadable OS colors). */
function SessionFilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Dropdown
      id={id}
      ariaLabel={label}
      value={value}
      options={[{ value: 'all', label }, ...options.filter(option => option.value !== 'all')]}
      onChange={onChange}
    />
  )
}

function sequenceForRows(rows: SessionRow[], grouped: boolean, sort: SessionColumnSort): SequenceEntry[] {
  if (!grouped) return [...rows].sort((a, b) => compareRowsBy(sort.key, sort.direction, a, b)).map(row => ({ type: 'row' as const, row }))

  const groupSign = sort.direction === 'asc' ? -1 : 1
  const byClient = rows.reduce((map, row) => {
    const clientRows = map.get(row.provider) ?? []
    clientRows.push(row)
    map.set(row.provider, clientRows)
    return map
  }, new Map<string, SessionRow[]>())

  return [...byClient.entries()]
    .map(([client, clientRows]) => ({
      client,
      rows: [...clientRows].sort((a, b) => compareRowsBy(sort.key, sort.direction, a, b)),
      cost: clientRows.reduce((sum, row) => sum + row.cost, 0),
      sortValue: groupSortValue(sort.key, clientRows),
    }))
    .sort((a, b) => groupSign * (b.sortValue - a.sortValue) || a.client.localeCompare(b.client))
    .flatMap(group => [
      { type: 'header' as const, client: group.client, count: group.rows.length, cost: group.cost },
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
        <span className="session-client"><ProviderLogo provider={row.provider} size={15} /><span>{clientLabel(row.provider)}</span></span>
      </td>
      <td className="session-model-cell" title={modelLabel}>
        {row.models.length > 0 ? row.models.map(model => {
          const house = modelHouseIdFromName(model)
          return (
            <span className="session-model-entry" key={model}>
              {house ? <ProviderLogo provider={modelHouseLogoKey(house)} size={13} /> : null}
              <span className="session-model-name">{model}</span>
            </span>
          )
        }) : <span>Model not identified</span>}
      </td>
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

/** Sortable table header: every sortable column carries a faint arrow so the
 * affordance is visible; the active column's arrow is colored and points in
 * the current direction. One click on the active column reverses it. */
function SessionSortHeader({
  label,
  sortKey,
  sort,
  numeric = false,
  title,
  onSort,
}: {
  label: string
  sortKey: SessionSortKey
  sort: SessionColumnSort
  numeric?: boolean
  title?: string
  onSort: (key: SessionSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th
      className={numeric ? 'session-number' : undefined}
      aria-sort={active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : undefined}
      title={title ?? 'Click to sort by this column · click again to reverse the direction'}
    >
      <button
        type="button"
        className={`session-sort-header${active ? ' on' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="session-sort-arrow" aria-hidden="true">
          {active ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </button>
    </th>
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
  onProviderChange = () => {},
  historicalSessionCount,
  ready = true,
}: {
  period: Period
  provider: string
  projectScopeId?: string
  range?: DateRange | null
  refreshToken?: number
  onProviderChange?: (value: string) => void
  historicalSessionCount?: number | null
  ready?: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [modelFilter, setModelFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState<'all' | ModelHouseId>('all')
  const [dateFilter, setDateFilter] = useState<SessionDateFilter>('all')
  const [sort, setSort] = useState<SessionColumnSort>({ key: 'recent', direction: 'desc' })
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
    .filter(row => brandFilter === 'all' || sessionMatchesBrand(row, brandFilter))
    .filter(row => matchesSessionDate(row.endedAt, dateFilter))
  const brandOptions = useMemo(() => sessionBrandOptions(rows), [rows])
  const brandStripOptions = useMemo(() => brandOptions.map(brand => ({ id: brand, label: modelHouseLabel(brand), logoProvider: modelHouseLogoKey(brand) })), [brandOptions])
  const projectOptions = useMemo(() => filterOptions(rows, row => row.project).map(value => ({ value, label: shortenProjectPath(value) })), [rows])
  const modelOptions = useMemo(() => [...new Set(rows.flatMap(row => row.models.map(model => model.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b)).map(value => ({ value, label: value })), [rows])
  const clientOptions = useMemo(() => filterOptions(rows, row => row.provider).map(value => ({ value, label: clientLabel(value) })), [rows])
  const sequence = useMemo(() => sequenceForRows(filtered, grouped, sort), [filtered, grouped, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / SESSION_PAGE_SIZE))
  const selectedSession = selectedId ? rows.find(row => sessionIdentity(row) === selectedId) ?? null : null
  const selectedStillVisible = selectedId === null || filtered.some(row => sessionIdentity(row) === selectedId)

  useEffect(() => {
    setPage(0)
  }, [query, sort, grouped, period, provider, projectScopeId, range?.from, range?.to, projectFilter, modelFilter, clientFilter, brandFilter, dateFilter])

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

  const onSortColumn = (key: SessionSortKey) => {
    setSort(current => current.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: 'desc' })
    if (key === 'recent') setGrouped(false)
  }

  const clearFilters = () => {
    setQuery('')
    setProjectFilter('all')
    setModelFilter('all')
    setClientFilter('all')
    setBrandFilter('all')
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

          <ProviderFilterStrip
            provider={brandFilter}
            providers={brandStripOptions}
            onProviderChange={value => setBrandFilter(value as 'all' | ModelHouseId)}
            ariaLabel="Filter sessions by brand"
            allLabel="All brands"
          />

          <div className="sessions-toolbar" role="group" aria-label="Session filters" data-filter-layout="single-row-when-closed">
            <label className="session-search-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
              <span className="sr-only">Search sessions</span>
              <input aria-label="Search sessions" placeholder="Filter sessions…" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <SessionFilterSelect id="sessions-project-filter" label="Project" value={projectFilter} options={projectOptions} onChange={setProjectFilter} />
            <SessionFilterSelect id="sessions-model-filter" label="Model" value={modelFilter} options={modelOptions} onChange={setModelFilter} />
            <SessionFilterSelect id="sessions-client-filter" label="Client" value={clientFilter} options={clientOptions} onChange={setClientFilter} />
            <SessionFilterSelect id="sessions-date-filter" label="Date" value={dateFilter} options={SESSION_DATE_FILTERS} onChange={value => setDateFilter(value as SessionDateFilter)} />
          </div>

          <div className="sessions-sort-toolbar">
            <span className="sessions-sort-hint" role="note">Click a column to sort · click again to reverse</span>
            <button className={grouped ? 'sessions-group-toggle on' : 'sessions-group-toggle'} type="button" aria-pressed={grouped} onClick={() => setGrouped(value => !value)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6" /><circle cx="18" cy="12" r="2.5" /></svg>
              Group by client
            </button>
          </div>

          <div className="sr-only" role="status" aria-live="polite">
            {`Sessions sorted by ${sessionSortAnnouncement(sort)}, ${grouped ? 'grouped by client' : 'not grouped by client'}. ${sessionCountLabel} after filters.`}
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
                        <SessionSortHeader label="Turn" sortKey="turns" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Calls" sortKey="calls" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Input" sortKey="input" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Output" sortKey="output" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Cache R" sortKey="cacheRead" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Cache W" sortKey="cacheWrite" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Cache×" sortKey="cache" sort={sort} numeric title="Cached input read per uncached input token · click to sort, double-click to reverse" onSort={onSortColumn}/>
                        <SessionSortHeader label="Total" sortKey="tokens" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Cost" sortKey="cost" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Cost/1M" sortKey="unitCost" sort={sort} numeric title="Effective cost per one million total tokens · click to sort, double-click to reverse" onSort={onSortColumn}/>
                        <SessionSortHeader label="Duration" sortKey="duration" sort={sort} numeric onSort={onSortColumn}/>
                        <SessionSortHeader label="Last Active" sortKey="recent" sort={sort} onSort={onSortColumn}/>
                      </tr>
                    </thead>
                    <tbody>
                      {renderedSequence.map(entry => entry.type === 'header' ? (
                        <tr className="session-provider-group" key={`client-${entry.client}`}>
                          <td colSpan={15}><ProviderLogo provider={entry.client} size={14} /><strong>{clientLabel(entry.client)}</strong><span>{entry.count.toLocaleString('en-US')} sessions · {formatUsd(entry.cost)}</span></td>
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
