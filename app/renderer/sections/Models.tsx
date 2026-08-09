import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import type { Section } from '../components/Sidebar'
import { usePolled, type Polled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { AuditRow, DateRange, DurableModelAccountingRow, DurableModelPresentationRow, MenubarPayload, ModelAccounting, ModelPresentation, ModelReportRow, Period, ReasoningTokenSemantics } from '../lib/types'
import type { SettingsPane } from './Settings'
import { combineModelPricing, modelPricingPresentation } from './modelPricingPresentation'
import { DurableModelsTable, ModelIdentity, providerTagStyle } from './ModelsDurableTable'

type ModelsLens = 'model' | 'task' | 'audit'
type DurableModelAccounting = ModelAccounting

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
const authorityNoteStyle = { color: 'var(--mut)', fontSize: 'var(--fs-label)', lineHeight: 1.45 } as const

function durableAccounting(data: MenubarPayload): DurableModelAccounting {
  const emitted = data.current.modelAccounting
  if (emitted) return emitted

  // Compatibility fallback for an older CLI payload: retain the durable headline
  // but do not invent a token split the old payload never carried.
  const rows: DurableModelAccountingRow[] = data.current.topModels.map(model => ({
    name: model.name,
    cost: model.cost,
    savingsUSD: model.savingsUSD,
    calls: model.calls,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenDetail: false,
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
    tokenCoverage: { cost: 0, calls: 0 },
  }
}

function legacyPresentationRow(row: DurableModelAccountingRow, index: number): DurableModelPresentationRow {
  const reasoningSemantics: ReasoningTokenSemantics = row.reasoningSemantics ?? 'unavailable'
  const hasRoute = Boolean(row.provider || (row.sourceProviders?.length ?? 0) > 0)
  const deliveryStatus = !hasRoute
    ? 'unavailable' as const
    : row.provider && (row.sourceProviders?.length ?? 0) > 0
      ? 'exact' as const
      : 'partial' as const
  return {
    ...row,
    presentationIdentity: `legacy:${row.name}:${index}`,
    providers: row.provider ? [row.provider] : [],
    sourceProviders: row.sourceProviders ?? [],
    rawModels: row.rawModels ?? [row.name],
    canonicalIdentities: row.canonicalIdentity ? [row.canonicalIdentity] : [],
    economicVariants: [row.semanticVariant ?? 'default'],
    reasoningSemantics,
    timingCoverage: row.timingCoverage ?? (row.activeDurationMs && row.activeGeneratedTokens ? 'observed' : 'unavailable'),
    deliveryRows: [row],
    deliveryStatus,
  }
}

function durablePresentation(data: MenubarPayload, accounting: DurableModelAccounting): ModelPresentation {
  return data.current.modelPresentation ?? {
    rows: accounting.rows.map(legacyPresentationRow),
    accountingRowCount: accounting.rows.length,
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
  overview,
  ready = true,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
  onNavigate?: (section: Section, pane?: SettingsPane) => void
  overview: Polled<MenubarPayload>
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
          overview={overview}
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
  overview,
  ready,
}: {
  period: Period
  provider: string
  range: DateRange | null
  byTask: boolean
  refreshToken: number
  onAddAlias: () => void
  overview: Polled<MenubarPayload>
  ready: boolean
}) {
  // Task attribution genuinely requires surviving source sessions. The primary
  // model table does not: it reads the already-loaded durable Overview payload,
  // avoiding both a second authority and another CLI spawn on first navigation.
  const report = usePolled<ModelReportRow[]>(
    () => range ? metrora.getModels(period, provider, true, range) : metrora.getModels(period, provider, true),
    [period, provider, range?.from, range?.to, refreshToken],
    { enabled: ready && byTask, memoKey: `models|${period}|${provider}|task|${range?.from ?? ''}-${range?.to ?? ''}` },
  )

  if (byTask) {
    if (!report.data) {
      if (report.error) return <CliErrorPanel error={report.error} subject="model task detail" />
      return <SectionSkeleton label="Loading available task detail…" rows={5} />
    }
    return (
      <>
        {report.error && <StaleBanner error={report.error} />}
        <Panel className="scroll-x">
          <div style={{ padding: '12px 14px 4px' }}>
            <strong>Task breakdown · Available detail</strong>
            <div style={authorityNoteStyle}>Task attribution needs the original session records. Model totals above remain durable after those records expire.</div>
          </div>
          {report.data.length ? (
            <ModelsByTaskTable rows={report.data} onAddAlias={onAddAlias} />
          ) : (
            <EmptyNote>No task-level session detail is available in this range.</EmptyNote>
          )}
        </Panel>
      </>
    )
  }

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="model usage" />
    return <SectionSkeleton label="Loading model totals…" rows={5} />
  }

  const accounting = durableAccounting(overview.data)
  const presentation = durablePresentation(overview.data, accounting)
  const incomplete = accounting.coverage.cost < 0.999999 || accounting.coverage.calls < 0.999999
  const tokenIncomplete = (accounting.tokenCoverage?.cost ?? 0) < 0.999999 || (accounting.tokenCoverage?.calls ?? 0) < 0.999999

  return (
    <>
      {overview.error && <StaleBanner error={overview.error} />}
      <Panel className="scroll-x">
          <div style={{ padding: '12px 14px 4px' }}>
            <strong>Model usage</strong>
            <div style={authorityNoteStyle}>Historical cost, calls and retained token detail from Metrora&apos;s durable local ledger.</div>
            <div style={authorityNoteStyle}>Generated tok/s uses retained active-generation evidence only. Observed active-generation timing is shown where the source provides it; Active ms / 1K is the inverse secondary view and unavailable routes remain —.</div>
            <div style={authorityNoteStyle}>Total = Input + Output + separately reported Reasoning + Cache R + Cache W. Reasoning is never guessed.</div>
          {incomplete ? <div style={authorityNoteStyle}>Some older usage no longer has a reliable model identity; that remainder is shown as Other models.</div> : null}
          {tokenIncomplete ? <div style={authorityNoteStyle}>Legacy rows without a durable token split show — for token-derived metrics instead of guessing.</div> : null}
        </div>
        {hasAccountingValue(accounting) ? (
          <DurableModelsTable accounting={accounting} presentation={presentation} legacyPresentationRow={legacyPresentationRow} />
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
    () => range ? metrora.getAudit(period, provider, range) : metrora.getAudit(period, provider),
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

function ModelsByTaskTable({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const groups = groupTaskRows(rows)

  return (
    <table className="models-by-task">
      <thead>
        <tr>
          <th>Task</th>
          <th>Calls</th>
          <th>Reasoning</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache R</th>
          <th>Cache W</th>
          <th>Cache ×</th>
          <th>Total</th>
          <th>Cost</th>
          <th>Cost / 1M</th>
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

function reportRowTotal(row: ModelReportRow): number {
  return totalTokenCount({
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    reasoningSemantics: row.reasoningSemantics,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  })
}

function ModelGroupRow({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const model = rows[0]!
  const calls = rows.reduce((sum, row) => sum + row.calls, 0)
  const costUSD = rows.reduce((sum, row) => sum + row.costUSD, 0)
  const input = rows.reduce((sum, row) => sum + row.inputTokens, 0)
  const output = rows.reduce((sum, row) => sum + row.outputTokens, 0)
  const reasoning = rows.reduce((sum, row) => sum + (row.reasoningTokens ?? 0), 0)
  const reasoningSemantics: ReasoningTokenSemantics = rows.some(row => row.reasoningSemantics === 'separate' || row.reasoningSemantics === 'mixed')
    ? 'separate'
    : 'unavailable'
  const cacheRead = rows.reduce((sum, row) => sum + row.cacheReadTokens, 0)
  const cacheWrite = rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0)
  const total = totalTokenCount({ inputTokens: input, outputTokens: output, reasoningTokens: reasoning, reasoningSemantics, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite })
  const pricing = modelPricingPresentation(combineModelPricing(rows), calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(costUSD)
  const reuse = cacheReuseMultiple(input, cacheRead)
  const unitCost = costPerMillionTotal(costUSD, { inputTokens: input, outputTokens: output, reasoningTokens: reasoning, reasoningSemantics, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite })

  return (
    <tr className="model-group-row">
      <td title={model.model}>
        <span className="model-group-lead">
          <ModelIdentity name={model.modelDisplayName} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={providerTagStyle}>{model.providerDisplayName}</span>
            <span style={providerTagStyle} title={pricing.title}>{pricing.label}</span>
          </span>
          {pricing.showAlias ? <button type="button" className="alias" onClick={onAddAlias}>add alias ›</button> : null}
        </span>
      </td>
      <td>{fmtInt(calls)}</td>
      <td>{reasoningSemantics === 'separate' ? formatCompact(reasoning) : '—'}</td>
      <td>{formatCompact(input)}</td>
      <td>{formatCompact(output)}</td>
      <td>{formatCompact(cacheRead)}</td>
      <td>{formatCompact(cacheWrite)}</td>
      <td>{formatReuseMultiple(reuse)}</td>
      <td>{formatCompact(total)}</td>
      <td className={pricing.muteCost ? 'dim' : undefined} title={pricing.title}>{costValue}</td>
      <td>{pricing.costMode === 'unavailable' || unitCost == null ? '—' : formatUsd(unitCost)}</td>
    </tr>
  )
}

function ModelTaskRow({ row }: { row: ModelReportRow }) {
  const pricing = modelPricingPresentation(row.pricing, row.calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(row.costUSD)
  const total = reportRowTotal(row)
  const reuse = cacheReuseMultiple(row.inputTokens, row.cacheReadTokens)
  const unitCost = costPerMillionTotal(row.costUSD, {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    reasoningSemantics: row.reasoningSemantics,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  })

  return (
    <tr className="model-task-row">
      <td>{row.category ?? 'general'}</td>
      <td>{fmtInt(row.calls)}</td>
      <td>{row.reasoningSemantics === 'separate' || row.reasoningSemantics === 'mixed' ? formatCompact(row.reasoningTokens ?? 0) : '—'}</td>
      <td>{formatCompact(row.inputTokens)}</td>
      <td>{formatCompact(row.outputTokens)}</td>
      <td>{formatCompact(row.cacheReadTokens)}</td>
      <td>{formatCompact(row.cacheWriteTokens)}</td>
      <td>{formatReuseMultiple(reuse)}</td>
      <td>{formatCompact(total)}</td>
      <td className={pricing.muteCost ? 'dim' : undefined} title={pricing.title}>{costValue}</td>
      <td>{pricing.costMode === 'unavailable' || unitCost == null ? '—' : formatUsd(unitCost)}</td>
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
