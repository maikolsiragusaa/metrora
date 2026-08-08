import { useMemo, useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { EmptyNote } from '../components/EmptyState'
import { seriesColorForModel } from '../components/ListRow'
import { Panel } from '../components/Panel'
import { ProviderLogo } from '../components/ProviderLogo'
import { SectionSkeleton } from '../components/Skeleton'
import { SegTabs } from '../components/SegTabs'
import { StaleBanner } from '../components/StaleBanner'
import type { Section } from '../components/Sidebar'
import { usePolled, type Polled } from '../hooks/usePolled'
import { formatCompact, formatUsd } from '../lib/format'
import { metrora } from '../lib/ipc'
import { cacheReuseMultiple, cacheShare, costPerMillionObserved, formatReuseMultiple, observedTokenTotal } from '../lib/usageMetrics'
import type { AuditRow, DateRange, MenubarPayload, ModelReportRow, Period } from '../lib/types'
import type { SettingsPane } from './Settings'
import { combineModelPricing, modelPricingPresentation } from './modelPricingPresentation'

type ModelsLens = 'model' | 'task' | 'audit'
type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'speed' | 'unitCost'
type DurableModelRow = {
  name: string
  cost: number
  savingsUSD: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokenDetail: boolean
  activeDurationMs?: number
  activeGeneratedTokens?: number
}
type DurableModelAccounting = {
  rows: DurableModelRow[]
  gap: { cost: number; savingsUSD: number; calls: number }
  coverage: { cost: number; calls: number }
  tokenCoverage?: { cost: number; calls: number }
}

const LENSES = [
  { value: 'model', label: 'By model' },
  { value: 'task', label: 'By task' },
  { value: 'audit', label: 'Audit' },
]

const MODEL_SORTS = [
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Total tokens' },
  { value: 'calls', label: 'Calls' },
  { value: 'cache', label: 'Cache reuse' },
  { value: 'speed', label: 'ms / 1K' },
  { value: 'unitCost', label: 'Cost / 1M' },
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
  // but do not invent a token split the old payload never carried.
  const rows: DurableModelRow[] = data.current.topModels.map(model => ({
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

function hasAccountingValue(accounting: DurableModelAccounting): boolean {
  return accounting.rows.length > 0 || accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001
}

function modelLogoProvider(name: string): string | null {
  const model = name.toLowerCase()
  if (/^(gpt|o1|o3|o4|codex)/.test(model) || model.includes('openai')) return 'codex'
  if (model.includes('claude')) return 'claude'
  if (model.includes('gemini')) return 'gemini'
  if (model.includes('qwen')) return 'qwen'
  if (model.includes('grok')) return 'grok'
  if (model.includes('kimi')) return 'kimi'
  if (model.includes('mistral') || model.includes('ministral')) return 'mistral-vibe'
  return null
}

function ModelIdentity({ name }: { name: string }) {
  const provider = modelLogoProvider(name)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {provider
        ? <ProviderLogo provider={provider} size={16} />
        : <span className="provider-logo provider-mono" style={{ width: 16, height: 16, fontSize: 9 }} aria-hidden>{(name.trim()[0] ?? '?').toUpperCase()}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  )
}

function tokenTotal(row: DurableModelRow): number {
  return observedTokenTotal(row)
}

function modelCacheReuse(row: DurableModelRow): number | null {
  return row.tokenDetail ? cacheReuseMultiple(row.inputTokens, row.cacheReadTokens) : null
}

function modelUnitCost(row: DurableModelRow): number | null {
  return row.tokenDetail ? costPerMillionObserved(row.cost, tokenTotal(row)) : null
}

function modelMsPer1K(row: DurableModelRow): number | null {
  const duration = row.activeDurationMs ?? 0
  const tokens = row.activeGeneratedTokens ?? 0
  if (!(duration > 0) || !(tokens > 0)) return null
  return duration * 1000 / tokens
}

function formatMsPer1K(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}ms`
}

function compareNullableDescending(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return b - a
}

function compareNullableAscending(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

function sortDurableRows(rows: DurableModelRow[], sort: ModelSort): DurableModelRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'tokens') return tokenTotal(b) - tokenTotal(a)
    if (sort === 'calls') return b.calls - a.calls
    if (sort === 'cache') return compareNullableDescending(modelCacheReuse(a), modelCacheReuse(b))
    if (sort === 'speed') return compareNullableAscending(modelMsPer1K(a), modelMsPer1K(b))
    if (sort === 'unitCost') return compareNullableDescending(modelUnitCost(a), modelUnitCost(b))
    return (b.cost - a.cost) || (b.calls - a.calls)
  })
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
  const incomplete = accounting.coverage.cost < 0.999999 || accounting.coverage.calls < 0.999999
  const tokenIncomplete = (accounting.tokenCoverage?.cost ?? 0) < 0.999999 || (accounting.tokenCoverage?.calls ?? 0) < 0.999999

  return (
    <>
      {overview.error && <StaleBanner error={overview.error} />}
      <Panel className="scroll-x">
        <div style={{ padding: '12px 14px 4px' }}>
          <strong>Model usage</strong>
          <div style={authorityNoteStyle}>Historical cost, calls and retained token detail from Metrora&apos;s durable local ledger.</div>
          <div style={authorityNoteStyle}>ms / 1K uses observed active-generation timing from source sessions still available on this device; lower is faster and — means no reliable timing evidence.</div>
          {incomplete ? <div style={authorityNoteStyle}>Some older usage no longer has a reliable model identity; that remainder is shown as Other models.</div> : null}
          {tokenIncomplete ? <div style={authorityNoteStyle}>Legacy rows without a durable token split show — for token-derived metrics instead of guessing.</div> : null}
        </div>
        {hasAccountingValue(accounting) ? (
          <DurableModelsTable accounting={accounting} />
        ) : (
          <EmptyNote>No model usage in this range yet.</EmptyNote>
        )}
      </Panel>
    </>
  )
}

function DurableModelsTable({ accounting }: { accounting: DurableModelAccounting }) {
  const [sort, setSort] = useState<ModelSort>('cost')
  const hasSavings = accounting.rows.some(row => row.savingsUSD > 0) || accounting.gap.savingsUSD > 0
  const rows = useMemo(() => {
    const values = [...accounting.rows]
    if (accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001) {
      values.push({
        name: 'Other models',
        ...accounting.gap,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokenDetail: false,
      })
    }
    return sortDurableRows(values, sort)
  }, [accounting, sort])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 0' }}>
        <SegTabs options={MODEL_SORTS} value={sort} onChange={value => setSort(value as ModelSort)} />
      </div>
      <table aria-label="Model usage">
        <thead>
          <tr>
            <th>Model</th>
            <th>Calls</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache R</th>
            <th>Cache W</th>
            <th title="Cached input read per uncached input token">Cache ×</th>
            <th>Total</th>
            <th title="Active generation milliseconds per 1,000 generated tokens. Lower is faster; tool wait is excluded where the collector supplies active timing.">ms / 1K</th>
            <th>Cost</th>
            <th title="Effective API-equivalent value per 1M observed tokens">Cost / 1M</th>
            {hasSavings ? <th>Saved</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((model, index) => {
            const total = model.tokenDetail ? tokenTotal(model) : null
            const reuse = modelCacheReuse(model)
            const share = model.tokenDetail ? cacheShare(model.inputTokens, model.cacheReadTokens) : null
            const unitCost = modelUnitCost(model)
            const speed = modelMsPer1K(model)
            return (
              <tr key={`${model.name}-${index}`}>
                <td title={model.name}><ModelIdentity name={model.name} /></td>
                <td>{fmtInt(model.calls)}</td>
                <td>{model.tokenDetail ? formatCompact(model.inputTokens) : '—'}</td>
                <td>{model.tokenDetail ? formatCompact(model.outputTokens) : '—'}</td>
                <td>{model.tokenDetail ? formatCompact(model.cacheReadTokens) : '—'}</td>
                <td>{model.tokenDetail ? formatCompact(model.cacheWriteTokens) : '—'}</td>
                <td title={share == null ? undefined : `${Math.round(share * 1000) / 10}% of input served from cache`}>{formatReuseMultiple(reuse)}</td>
                <td>{total == null ? '—' : formatCompact(total)}</td>
                <td title={speed == null ? 'No reliable active-generation timing for this model in the available source sessions.' : `${formatCompact(model.activeGeneratedTokens ?? 0)} timed generated tokens from available source sessions.`}>{formatMsPer1K(speed)}</td>
                <td>{formatUsd(model.cost)}</td>
                <td>{unitCost == null ? '—' : formatUsd(unitCost)}</td>
                {hasSavings ? <td className={model.savingsUSD > 0 ? 'pos' : undefined}>{model.savingsUSD > 0 ? formatUsd(model.savingsUSD) : '—'}</td> : null}
              </tr>
            )
          })}
        </tbody>
      </table>
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
  return observedTokenTotal(row)
}

function ModelGroupRow({ rows, onAddAlias }: { rows: ModelReportRow[]; onAddAlias: () => void }) {
  const model = rows[0]!
  const calls = rows.reduce((sum, row) => sum + row.calls, 0)
  const costUSD = rows.reduce((sum, row) => sum + row.costUSD, 0)
  const input = rows.reduce((sum, row) => sum + row.inputTokens, 0)
  const output = rows.reduce((sum, row) => sum + row.outputTokens, 0)
  const cacheRead = rows.reduce((sum, row) => sum + row.cacheReadTokens, 0)
  const cacheWrite = rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0)
  const total = observedTokenTotal({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite })
  const pricing = modelPricingPresentation(combineModelPricing(rows), calls)
  const costValue = pricing.costMode === 'unavailable' ? '—' : formatUsd(costUSD)
  const reuse = cacheReuseMultiple(input, cacheRead)
  const unitCost = costPerMillionObserved(costUSD, total)

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
  const unitCost = costPerMillionObserved(row.costUSD, total)

  return (
    <tr className="model-task-row">
      <td>{row.category ?? 'general'}</td>
      <td>{fmtInt(row.calls)}</td>
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