import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import type { Section } from '../components/Sidebar'
import { usePolled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { AuditRow, DateRange, ModelReportRow, Period } from '../lib/types'
import type { SettingsPane } from './Settings'
import { combineModelPricing, modelPricingPresentation } from './modelPricingPresentation'

type ModelsLens = 'model' | 'task' | 'audit'

const LENSES = [
  { value: 'model', label: 'By model' },
  { value: 'task', label: 'By task' },
  { value: 'audit', label: 'Audit' },
]

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

// Muted secondary tag naming a row's provider, so the same model name coming
// from different providers reads as distinct rows.
const providerTagStyle = { color: 'var(--mut)', fontSize: 'var(--fs-label)', fontWeight: 450 } as const

export function Models({
  period,
  provider,
  range = null,
  refreshToken = 0,
  onNavigate,
  ready = true,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  onNavigate?: (section: Section, pane?: SettingsPane) => void
  ready?: boolean
}) {
  const [lens, setLens] = useState<ModelsLens>('model')
  const onAddAlias = () => onNavigate?.('settings', 'aliases')

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }}>
        <SegTabs options={LENSES} value={lens} onChange={value => setLens(value as ModelsLens)} />
        {lens !== 'audit' && (
          <button type="button" className="btn btn-s" onClick={() => onNavigate?.('compare')}>
            Compare…
          </button>
        )}
      </div>
      {lens === 'audit' ? (
        <AuditLens period={period} provider={provider} range={range} refreshToken={refreshToken} ready={ready} />
      ) : (
        <ModelsUsage
          period={period}
          provider={provider}
          range={range}
          byTask={lens === 'task'}
          refreshToken={refreshToken}
          onAddAlias={onAddAlias}
          ready={ready}
        />
      )}
    </>
  )
}

function ModelsUsage({
  period,
  provider,
  range,
  byTask,
  refreshToken,
  onAddAlias,
  ready,
}: {
  period: Period
  provider: string
  range: DateRange | null
  byTask: boolean
  refreshToken: number
  onAddAlias: () => void
  ready: boolean
}) {
  const report = usePolled<ModelReportRow[]>(
    () => range ? codeburn.getModels(period, provider, byTask, range) : codeburn.getModels(period, provider, byTask),
    [period, provider, byTask, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `models|${period}|${provider}|${byTask}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="model usage" />
    return <SectionSkeleton label="Scanning model usage…" rows={5} />
  }

  return (
    <>
      {report.error && <StaleBanner error={report.error} />}
      <Panel className="scroll-x">
        {report.data.length ? (
          <ModelsTable rows={report.data} byTask={byTask} onAddAlias={onAddAlias} />
        ) : (
          <EmptyNote>No model usage in this range yet.</EmptyNote>
        )}
      </Panel>
    </>
  )
}

// A row's cost is "estimated" when it has no live pricing entry, or when the
// attributed cost diverges from a straight rate x displayed-token recompute
// (fast-mode multipliers or the 1-hour cache rate that calculateCost applies).
function auditEstimated(row: AuditRow): boolean {
  if (!row.rates) return true
  return Math.abs(row.cost.recomputedTotalUSD - row.attributedCostUSD) > 0.005
}

function AuditLens({
  period,
  provider,
  range,
  refreshToken,
  ready,
}: {
  period: Period
  provider: string
  range: DateRange | null
  refreshToken: number
  ready: boolean
}) {
  const report = usePolled<AuditRow[]>(
    () => range ? codeburn.getAudit(period, provider, range) : codeburn.getAudit(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `audit|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="the token audit" />
    return <SectionSkeleton label="Auditing token usage…" rows={5} />
  }

  return (
    <>
      {report.error && <StaleBanner error={report.error} />}
      <Panel className="scroll-x">
        {report.data.length ? (
          <AuditTable rows={report.data} />
        ) : (
          <EmptyNote>No model usage to audit in this range yet.</EmptyNote>
        )}
      </Panel>
    </>
  )
}

function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <table className="audit-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Calls</th>
          <th>Input</th>
          <th>Output</th>
          <th>Reasoning</th>
          <th>Norm out</th>
          <th>Cache wr</th>
          <th>Cache rd</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <AuditTableRow key={`${row.provider}-${row.model}-${i}`} row={row} />
        ))}
      </tbody>
    </table>
  )
}

function AuditTableRow({ row }: { row: AuditRow }) {
  const estimated = auditEstimated(row)
  return (
    <tr>
      <td title={row.model}>
        <span className="mdot" style={{ display: 'inline-block', background: seriesColorForModel(row.modelDisplayName || row.model), marginRight: 8 }} />
        {row.modelDisplayName}
      </td>
      <td>{fmtInt(row.calls)}</td>
      <td>{formatCompact(row.raw.inputTokens)}</td>
      <td>{formatCompact(row.raw.outputTokens)}</td>
      <td>{formatCompact(row.raw.reasoningTokens)}</td>
      <td>{formatCompact(row.displayed.outputTokens)}</td>
      <td>{formatCompact(row.displayed.cacheWriteTokens)}</td>
      <td>{formatCompact(row.displayed.cacheReadTokens)}</td>
      <td>
        {formatUsd(row.attributedCostUSD)}
        {estimated ? <span className="est" title="Cost is estimated (no live pricing or derived rate)"> est</span> : null}
      </td>
    </tr>
  )
}

function ModelsTable({ rows, byTask, onAddAlias }: { rows: ModelReportRow[]; byTask: boolean; onAddAlias: () => void }) {
  if (byTask) return <ModelsByTaskTable rows={rows} onAddAlias={onAddAlias} />

  return (
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Calls</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache read</th>
          <th>Cost</th>
          <th>Saved</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <ModelTableRow key={`${row.provider}-${row.model}-${i}`} row={row} onAddAlias={onAddAlias} />
        ))}
      </tbody>
    </table>
  )
}

function ModelsByTaskTable({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const groups = groupTaskRows(rows)

  return (
    <table className="models-by-task">
      <thead>
        <tr>
          <th>Task</th>
          <th>Calls</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache read</th>
          <th>Cost</th>
          <th>Saved</th>
        </tr>
      </thead>
      {groups.map(group => (
        <tbody className="model-task-group" key={`${group.provider}-${group.model}`}>
          <ModelGroupRow rows={group.rows} onAddAlias={onAddAlias} />
          {group.rows.map((row, i) => (
            <ModelTaskRow key={`${row.category ?? 'all'}-${i}`} row={row} />
          ))}
        </tbody>
      ))}
    </table>
  )
}

function ModelTableRow({ row, onAddAlias }: { row: ModelReportRow; onAddAlias: () => void }) {
  const pricing = modelPricingPresentation(row.pricing, row.calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(row.costUSD)
  const dotStyle = {
    display: 'inline-block',
    background: seriesColorForModel(row.modelDisplayName || row.model),
    marginRight: 8,
  }

  return (
    <tr>
      <td title={row.model}>
        <span className="mdot" style={dotStyle} />
        {row.modelDisplayName}
        <span style={{ ...providerTagStyle, display: 'block', marginTop: 2, paddingLeft: 16 }}>{row.providerDisplayName}</span>
        <span
          style={{ ...providerTagStyle, display: 'block', marginTop: 2, paddingLeft: 16 }}
          title={pricing.title}
        >
          {pricing.label}
        </span>
        {pricing.showAlias ? <button type="button" className="alias" onClick={onAddAlias}>add alias ›</button> : null}
      </td>
      <td>{fmtInt(row.calls)}</td>
      <td>{formatCompact(row.inputTokens)}</td>
      <td>{formatCompact(row.outputTokens)}</td>
      <td>{formatCompact(row.cacheReadTokens)}</td>
      <td
        className={pricing.muteCost ? 'dim' : undefined}
        title={pricing.title}
        aria-label={pricing.costMode === 'partial' ? `Priced portion ${costValue}` : pricing.costMode === 'unavailable' ? 'Cost unavailable' : `Cost ${costValue}`}
      >
        {costValue}
      </td>
      <td className={row.savingsUSD > 0 ? 'pos' : undefined}>{formatUsd(row.savingsUSD)}</td>
    </tr>
  )
}

function ModelGroupRow({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const model = rows[0]
  const calls = rows.reduce((sum, row) => sum + row.calls, 0)
  const costUSD = rows.reduce((sum, row) => sum + row.costUSD, 0)
  const savingsUSD = rows.reduce((sum, row) => sum + row.savingsUSD, 0)
  const pricing = modelPricingPresentation(combineModelPricing(rows), calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(costUSD)

  return (
    <tr className="model-group-row">
      <td title={model.model}>
        <span className="model-group-lead">
          <span
            className="mdot"
            style={{ background: seriesColorForModel(model.modelDisplayName || model.model) }}
          />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="model-group-name">{model.modelDisplayName}</span>
            <span style={providerTagStyle}>{model.providerDisplayName}</span>
            <span style={providerTagStyle} title={pricing.title}>{pricing.label}</span>
          </span>
          {pricing.showAlias ? <button type="button" className="alias" onClick={onAddAlias}>add alias ›</button> : null}
        </span>
      </td>
      <td>{fmtInt(calls)}</td>
      <td aria-label="No aggregate input" />
      <td aria-label="No aggregate output" />
      <td aria-label="No aggregate cache read" />
      <td
        className={pricing.muteCost ? 'dim' : undefined}
        title={pricing.title}
        aria-label={pricing.costMode === 'partial' ? `Priced portion ${costValue}` : pricing.costMode === 'unavailable' ? 'Cost unavailable' : `Cost ${costValue}`}
      >
        {costValue}
      </td>
      <td className={savingsUSD > 0 ? 'pos' : undefined}>{formatUsd(savingsUSD)}</td>
    </tr>
  )
}

function ModelTaskRow({ row }: { row: ModelReportRow }) {
  const pricing = modelPricingPresentation(row.pricing, row.calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(row.costUSD)

  return (
    <tr className="model-task-row">
      <td>{row.category ?? 'general'}</td>
      <td>{fmtInt(row.calls)}</td>
      <td>{formatCompact(row.inputTokens)}</td>
      <td>{formatCompact(row.outputTokens)}</td>
      <td>{formatCompact(row.cacheReadTokens)}</td>
      <td
        className={pricing.muteCost ? 'dim' : undefined}
        title={pricing.title}
        aria-label={pricing.costMode === 'partial' ? `Priced portion ${costValue}` : pricing.costMode === 'unavailable' ? 'Cost unavailable' : `Cost ${costValue}`}
      >
        {costValue}
      </td>
      <td className={row.savingsUSD > 0 ? 'pos' : undefined}>{formatUsd(row.savingsUSD)}</td>
    </tr>
  )
}

function groupTaskRows(rows: ModelReportRow[]) {
  const groups = new Map<string, { provider: string; model: string; rows: ModelReportRow[] }>()
  for (const row of rows) {
    const key = `${row.provider}\u0000${row.model}`
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { provider: row.provider, model: row.model, rows: [row] })
  }
  return [...groups.values()]
}
