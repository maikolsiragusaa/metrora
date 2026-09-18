import { useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { Panel } from '../components/Panel'
import { formatCompact, formatUsd } from '../lib/format'
import type { MenubarPayload, ProjectSpendProjection } from '../lib/types'
import { SpendKpiRow, SpendUnavailable } from './SpendPrimitives'

type SpendProject = ProjectSpendProjection & { rowKey: string }
type ProjectSort = 'cost' | 'sessions' | 'calls' | 'name'

function projectDate(date: string): string | null {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function projectRows(data: MenubarPayload): SpendProject[] {
  const source = data.current.projectSpend ?? data.current.topProjects
  return source.map((project, index) => ({ ...project, rowKey: `${project.name}|${index}` }))
}

function sortProjects(rows: SpendProject[], sort: ProjectSort): SpendProject[] {
  return [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'sessions') return b.sessions - a.sessions || b.cost - a.cost
    if (sort === 'calls') return (b.calls ?? 0) - (a.calls ?? 0) || b.cost - a.cost
    return b.cost - a.cost || b.sessions - a.sessions
  })
}

export function SpendProjects({ data }: { data: MenubarPayload }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSort>('cost')
  const [page, setPage] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const allRows = useMemo(() => projectRows(data), [data])
  const hasCalls = allRows.some(project => typeof project.calls === 'number')
  const pageSize = 25

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sortProjects(
      normalized ? allRows.filter(project => project.name.toLocaleLowerCase().includes(normalized)) : allRows,
      sort,
    )
  }, [allRows, query, sort])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const pageRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize)
  const selected = allRows.find(project => project.rowKey === selectedKey) ?? null

  useEffect(() => setPage(0), [query, sort])
  useEffect(() => {
    if (selectedKey && !allRows.some(project => project.rowKey === selectedKey)) setSelectedKey(null)
  }, [allRows, selectedKey])

  return (
    <div className="spend-view spend-projects-view" data-testid="spend-projects-view">
      <SpendKpiRow items={[
        { label: 'Projects', value: allRows.length.toLocaleString('en-US'), detail: 'With observed activity', tone: 'accent' },
        { label: 'Total spend', value: formatUsd(data.current.cost), detail: 'Observed cost' },
        { label: 'Sessions', value: data.current.sessions.toLocaleString('en-US'), detail: 'Across the scope' },
        { label: 'Calls', value: data.current.calls.toLocaleString('en-US'), detail: 'Metered API calls' },
      ]} />

      <div className={`spend-projects-workspace${selected ? ' has-inspector' : ''}`}>
        <div className="spend-project-list">
          <Panel title="Projects" right={`${filteredRows.length.toLocaleString('en-US')} shown`} className="spend-table-panel">
            <div className="spend-table-toolbar">
              <label className="spend-search">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" />
              </label>
              <label className="spend-sort">
                <span>Sort</span>
                <select value={sort} onChange={event => setSort(event.target.value as ProjectSort)} aria-label="Sort projects">
                  <option value="cost">Spend</option>
                  <option value="sessions">Sessions</option>
                  {hasCalls ? <option value="calls">Calls</option> : null}
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {pageRows.length ? (
              <div className="spend-table-wrap">
                <table className="spend-table">
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col" className="numeric">Spend</th>
                      <th scope="col" className="numeric">Sessions</th>
                      {hasCalls ? <th scope="col" className="numeric">Calls</th> : null}
                      <th scope="col" className="numeric">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(project => {
                      const selectedRow = selectedKey === project.rowKey
                      const share = data.current.cost > 0 ? project.cost / data.current.cost : 0
                      return (
                        <tr
                          className={selectedRow ? 'is-selected' : undefined}
                          data-testid="spend-project-row"
                          key={project.rowKey}
                          tabIndex={0}
                          aria-selected={selectedRow}
                          onClick={() => setSelectedKey(current => current === project.rowKey ? null : project.rowKey)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedKey(current => current === project.rowKey ? null : project.rowKey)
                            }
                          }}
                        >
                          <td><span className="spend-project-name"><span className="spend-project-glyph" aria-hidden="true">⌂</span>{project.name}</span></td>
                          <td className="numeric strong-cell">{formatUsd(project.cost)}</td>
                          <td className="numeric">{project.sessions.toLocaleString('en-US')}</td>
                          {hasCalls ? <td className="numeric">{typeof project.calls === 'number' ? project.calls.toLocaleString('en-US') : <SpendUnavailable>—</SpendUnavailable>}</td> : null}
                          <td className="numeric"><span className="spend-share-cell"><i style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />{share > 0 ? `${Math.round(share * 100)}%` : '—'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyNote>No projects match this search.</EmptyNote>}
            <div className="spend-table-footer">
              <span>{filteredRows.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filteredRows.length)} of ${filteredRows.length}` : '0 projects'}</span>
              {pageCount > 1 ? (
                <span className="spend-pagination">
                  <button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={page === 0} aria-label="Previous projects">‹</button>
                  <span>Page {page + 1} of {pageCount}</span>
                  <button type="button" onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1} aria-label="Next projects">›</button>
                </span>
              ) : null}
            </div>
          </Panel>
        </div>
        {selected ? <SpendProjectInspector project={selected} totalCost={data.current.cost} onClose={() => setSelectedKey(null)} /> : null}
      </div>
    </div>
  )
}

function SpendProjectInspector({
  project,
  totalCost,
  onClose,
}: {
  project: SpendProject
  totalCost: number
  onClose: () => void
}) {
  const dailySpend = project.dailySpend ?? []
  const maxDay = Math.max(...dailySpend.map(day => day.cost), 0)
  const sessions = project.sessionDetails ?? []
  const share = totalCost > 0 ? project.cost / totalCost : 0

  return (
    <aside className="spend-project-inspector" data-testid="spend-project-inspector" aria-label={`${project.name} project details`}>
      <div className="spend-inspector-header">
        <div className="spend-inspector-title"><span className="spend-project-glyph" aria-hidden="true">⌂</span><div><h2>{project.name}</h2><span>Selected project</span></div></div>
        <button type="button" className="spend-close" onClick={onClose} aria-label="Close project details">×</button>
      </div>
      <div className="spend-inspector-metrics">
        <div><span>Spend</span><b>{formatUsd(project.cost)}</b></div>
        <div><span>Sessions</span><b>{project.sessions.toLocaleString('en-US')}</b></div>
        <div><span>Calls</span><b>{typeof project.calls === 'number' ? project.calls.toLocaleString('en-US') : <SpendUnavailable>—</SpendUnavailable>}</b></div>
        <div><span>Scope share</span><b>{share > 0 ? `${(share * 100).toFixed(1)}%` : '—'}</b></div>
      </div>

      <Panel title="Spend history" right={dailySpend.length ? `${dailySpend.length} days` : undefined} className="spend-inspector-panel">
        {dailySpend.length && maxDay > 0 ? (
          <div className="spend-mini-chart" aria-label={`Daily spend history for ${project.name}`}>
            {dailySpend.map(day => (
              <div className="spend-mini-column" key={day.date} title={`${projectDate(day.date) ?? day.date} · ${formatUsd(day.cost)}`}>
                <i style={{ height: `${(day.cost / maxDay) * 100}%` }} />
                <span>{projectDate(day.date) ?? '—'}</span>
              </div>
            ))}
          </div>
        ) : <EmptyNote>No project-level daily history is available for this scope.</EmptyNote>}
      </Panel>

      <Panel title="Recent sessions" right={sessions.length ? `${sessions.length} available` : undefined} className="spend-inspector-panel">
        {sessions.length ? (
          <div className="spend-session-list">
            {sessions.map((session, index) => (
              <div className="spend-session-row" key={`${session.date}-${index}`}>
                <div><b>{projectDate(session.date) ?? 'Date unavailable'}</b><span>{session.models.length ? session.models.map(model => model.name).join(', ') : 'Models unavailable'}</span></div>
                <div><b>{formatUsd(session.cost)}</b><span>{formatCompact(session.calls)} calls</span></div>
              </div>
            ))}
          </div>
        ) : <EmptyNote>No surviving session detail is available for this project.</EmptyNote>}
      </Panel>
    </aside>
  )
}
