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
import type { AuditRow, DateRange, MenubarPayload, ModelReportRow, Period } from '../lib/types'
import type { SettingsPane } from './Settings'
import { combineModelPricing, modelPricingPresentation } from './modelPricingPresentation'

type ModelsLens = 'model' | 'task' | 'audit'
type DurableModelAccounting = {
  rows: Array<{ name: string; cost: number; savingsUSD: number; calls: number }>
  gap: { cost: number; savingsUSD: number; calls: number }
  coverage: { cost: number; calls: number }
}

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
const authorityNoteStyle = { color: 'var(--mut)', fontSize: 'var(--fs-label)', lineHeight: 1.45 } as const

function durableAccounting(data: MenubarPayload): DurableModelAccounting {
  const emitted = (data.current as MenubarPayload['current'] & { modelAccounting?: DurableModelAccounting }).modelAccounting
  if (emitted) return emitted

  // Compatibility fallback for an older CLI payload: retain the durable headline
  // and make any top-N tail explicit rather than pretending topModels is complete.
  const rows = data.current.topModels.map(model => ({
    name: model.name,
    cost: model.cost,
    savingsUSD: model.savingsUSD,
    calls: model.calls,
  }))
  const representedCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const representedCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const gapCost = Math.max(0, data.current.cost - representedCost)
  const gapCalls = Math.max(0, data.current.calls - representedCalls)
  return {
    rows,
    gap: { cost: gapCost, savingsUSD: 0, calls: gapCalls },
    coverage: {
      cost: data.current.cost > 0 ? Math.max(0, Math.min(1, representedCost / data.current.cost)) : 1,
      calls: data.current.calls > 0 ? Math.max(0, Math.min(1, representedCalls / data.current.calls)) : 1,
    },
  }
}

function hasAccountingValue(accounting: DurableModelAccounting): boolean {
  return accounting.rows.length > 0 || accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001
}

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
  // The normal model lens is an accounting surface. Its primary values come
  // from the same durable Overview authority as Home, so expired source
  // transcripts cannot silently make lifetime model spend shrink. The detailed
  // report remains useful for token/task inspection, but it is explicitly
  // presented as surviving-session detail below.
  const durable = usePolled<MenubarPayload>(
    () => range ? codeburn.getOverview(period, provider, range) : codeburn.getOverview(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready && !byTask, memoKey: `models-durable|${period}|${provider}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )
  const report = usePolled<ModelReportRow[]>(
    () => range ? codeburn.getModels(period, provider, byTask, range) : codeburn.getModels(period, provider, byTask),
    [period, provider, byTask, range?.from, range?.to, refreshToken],
    { enabled: ready, memoKey: `models|${period}|${provider}|${byTask}|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (byTask) {
    if (!report.data) {
      if (report.error) return <CliErrorPanel error={report.error} subject="model task detail" />
      return <SectionSkeleton label="Scanning available task detail…" rows={5} />
    }
    return (
      <>
        {report.error && <StaleBanner error={report.error} />}
        <Panel className="scroll-x">
          <div style={{ padding: '12px 14px 4px' }}>
            <strong>Task breakdown · Partial history</strong>
            <div style={authorityNoteStyle}>Task breakdown needs the original session records. Older usage can remain in Model totals after detailed session data expires.</div>
          </div>
          {report.data.length ? (
            <ModelsTable rows={report.data} byTask onAddAlias={onAddAlias} />
          ) : (
            <EmptyNote>No detailed task data in this range yet.</EmptyNote>
          )}
        </Panel>
      </>
    )
  }

  if (!durable.data) {
    if (durable.error) return <CliErrorPanel error={durable.error} subject="durable model usage" />
    return <SectionSkeleton label="Loading model totals…" rows={5} />
  }

  const accounting = durableAccounting(durable.data)
  const incomplete = accounting.coverage.cost < 0.999999 || accounting.coverage.calls < 0.999999

  return (
    <>
      {durable.error && <StaleBanner error={durable.error} />}
      <Panel className="scroll-x">
        <div style={{ padding: '12px 14px 4px' }}>
          <strong>Model totals</strong>
          <div style={authorityNoteStyle}>Includes older usage even when detailed session data is no longer available.</div>
          {incomplete ? <div style={authorityNoteStyle}>Some older usage no longer has a reliable model split; that remainder is shown as Other models.</div> : null}
        </div>
        {hasAccountingValue(accounting) ? (
          <DurableModelsTable accounting={accounting} />
        ) : (
          <EmptyNote>No model usage in this range yet.</EmptyNote>
        )}
      </Panel>

      <Panel className="scroll-x">
        <div style={{ padding: '12px 14px 4px' }}>
          <strong>Detailed token breakdown · Partial</strong>
          <div style={authorityNoteStyle}>Based on sessions still available on this device. Totals may be lower than Model totals.</div>
        </div>
        {report.error && <StaleBanner error={report.error} />}
        {!report.data ? (
          <SectionSkeleton label="Scanning detailed session data…" rows={4} />
        ) : report.data.length ? (
          <ModelsTable rows={report.data} byTask={false} onAddAlias={onAddAlias} />
        ) : (
          <EmptyNote>No detailed session data in this range yet.</EmptyNote>
        )}
      </Panel>
    </>
  )
}

function DurableModelsTable({ accounting }: { accounting: DurableModelAccounting }) {
  const rows = [...accounting.rows]
  if (accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001) {
    rows.push({ name: 'Other models', ...accounting.gap })
  }
  rows.sort((left, right) => (right.cost - left.cost) || (right.calls - left.calls))

  return (
    <table aria-label="Model totals">
      <thead>
        <tr>
          <th>Model</th>
          <th>Calls</th>
          <th>Cost</th>
          <th>Saved</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((model, index) => (
          <tr key={`${model.name}-${index}`}>
            <td>
              <span className="mdot" style={{ display: 'inline-block', background: seriesColorForModel(model.name), marginRight: 8 }} />
              {model.name}
            </td>
            <td>{fmtInt(model.calls)}</td>
            <td>{formatUsd(model.cost)}</td>
            <td className={model.savingsUSD > 0 ? 'pos' : undefined}>{formatUsd(model.savingsUSD)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
    const key = JSON.stringify([row.provider, row.model])
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { provider: row.provider, model: row.model, rows: [row] })
  }
  return [...groups.values()]
}
