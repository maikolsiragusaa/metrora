import { useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatUsd } from '../lib/format'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { additiveReasoningTokenCount, cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { AuditRow, DurableModelPresentationRow, ModelReportRow } from '../lib/types'
import { ModelIdentity } from './ModelsDurableTable'

type ModelRow = DurableModelPresentationRow
type DistributionMetric = 'calls' | 'tokens' | 'spend'
type CompareTab = 'overview' | 'cost' | 'tokens' | 'cache'

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function providersFor(row: ModelRow): string[] {
  return row.providers.length > 0 ? row.providers : row.provider ? [row.provider] : []
}

function totalFor(row: ModelRow): number | null {
  return row.tokenDetail ? totalTokenCount(row) : null
}

function unitCostFor(row: ModelRow): number | null {
  return row.tokenDetail ? costPerMillionTotal(row.cost, row) : null
}

function cacheFor(row: ModelRow): number | null {
  return row.tokenDetail ? cacheReuseMultiple(row.inputTokens, row.cacheReadTokens) : null
}

function timingFor(row: ModelRow): number | null {
  if (!(row.activeDurationMs && row.activeGeneratedTokens)) return null
  if (row.activeDurationMs <= 0 || row.activeGeneratedTokens <= 0) return null
  return row.activeDurationMs * 1000 / row.activeGeneratedTokens
}

function formatTiming(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}ms`
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function percent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

function tokenParts(row: ModelRow): Array<{ label: string; value: number; className: string }> {
  if (!row.tokenDetail) return []
  const parts = [
    { label: 'Input', value: row.inputTokens, className: 'input' },
    { label: 'Output', value: row.outputTokens, className: 'output' },
    { label: 'Cache read', value: row.cacheReadTokens, className: 'cache-read' },
    { label: 'Cache write', value: row.cacheWriteTokens, className: 'cache-write' },
  ]
  const reasoning = additiveReasoningTokenCount(row)
  if (reasoning > 0) parts.push({ label: 'Reasoning', value: reasoning, className: 'reasoning' })
  return parts
}

function pricingLabel(row: ModelRow): string {
  if (row.pricingState === 'unavailable') return 'Unpriced'
  if (row.pricingState === 'mixed') return 'Partial pricing'
  if (row.pricingState === 'estimated' || row.costIsEstimated) return 'Estimated'
  return 'Priced'
}

function providerText(row: ModelRow): string {
  const providers = providersFor(row)
  return providers.length > 0 ? providers.map(formatProviderLabel).join(', ') : 'Provider unavailable'
}

function DistributionValue({ metric, value }: { metric: DistributionMetric; value: number }) {
  return <>{metric === 'calls' ? value.toLocaleString('en-US') : metric === 'tokens' ? formatCompact(value) : formatUsd(value)}</>
}

function DistributionBars({ rows, metric }: { rows: ModelRow[]; metric: DistributionMetric }) {
  const ranked = rows
    .map(row => ({ row, value: metric === 'calls' ? row.calls : metric === 'tokens' ? totalFor(row) : row.cost }))
    .filter((entry): entry is { row: ModelRow; value: number } => entry.value != null && Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value)
  const top = ranked.slice(0, 5)
  const others = ranked.slice(5).reduce((sum, entry) => sum + entry.value, 0)
  const entries = others > 0 ? [...top, { row: null, value: others }] : top
  const max = Math.max(0, ...entries.map(entry => entry.value))
  const total = ranked.reduce((sum, entry) => sum + entry.value, 0)

  if (entries.length === 0) {
    return <div className="models-side-empty" role="status">{metric === 'tokens' ? 'Token detail is unavailable for these rows.' : 'No observed usage is available.'}</div>
  }

  return (
    <div className="models-distribution-list" aria-label={`Model usage distribution by ${metric}`}>
      {entries.map((entry, index) => {
        const name = entry.row?.name ?? 'Other models'
        const share = total > 0 ? entry.value / total * 100 : 0
        return (
          <div className="models-distribution-row" key={entry.row?.presentationIdentity ?? 'other'}>
            <div className="models-distribution-label">
              {entry.row ? <><ProviderLogo provider={providerLogoKey(modelRowProvider(entry.row))} size={14} /><span>{name} · {percent(share, 1)}</span></> : <><span className="models-distribution-other-mark" aria-hidden="true" /><span>{name} · {percent(share, 1)}</span></>}
            </div>
            <span className="models-distribution-track" aria-hidden="true"><span className={`models-distribution-fill tone-${index % 5}`} style={{ width: `${max > 0 ? Math.max(5, entry.value / max * 100) : 0}%` }} /></span>
            <span className="models-distribution-value"><DistributionValue metric={metric} value={entry.value} /><small>{percent(share, 1)}</small></span>
          </div>
        )
      })}
    </div>
  )
}

function ModelSummaryCard({ row }: { row: ModelRow | null }) {
  if (!row) return <div className="models-side-empty" role="status">Select a model to inspect its observed details.</div>
  const total = totalFor(row)
  const unitCost = unitCostFor(row)
  const cache = cacheFor(row)
  const timing = timingFor(row)
  return (
    <section className="models-side-card models-summary-card" aria-labelledby="models-summary-title">
      <div className="models-side-card-head">
        <div><span className="models-side-eyebrow">Model details</span><h2 id="models-summary-title">{row.name} · observed</h2><p>{providerText(row)}</p></div>
        <span className="models-summary-status">Observed</span>
      </div>
      <div className="models-summary-copy">Observed usage, pricing and route evidence for the selected scope.</div>
      <div className="models-summary-tags">
        <span className="models-side-chip">{row.tokenDetail ? 'Token detail' : 'Token detail unavailable'}</span>
        <span className={`models-side-chip ${row.pricingState === 'unavailable' ? 'is-warn' : ''}`}>{pricingLabel(row)}</span>
        {row.timingCoverage !== 'unavailable' ? <span className="models-side-chip">Timing observed</span> : null}
      </div>
      <div className="models-summary-metrics">
        <SideMetric label="Calls" value={row.calls.toLocaleString('en-US')} />
        <SideMetric label="Total tokens" value={total == null ? '—' : formatCompact(total)} detail={total == null ? 'Unavailable' : 'metered volume'} />
        <SideMetric label="Total cost" value={formatUsd(row.cost)} />
        <SideMetric label="Cost / 1M" value={unitCost == null ? '—' : formatUsd(unitCost)} />
        <SideMetric label="Cache reuse" value={formatReuseMultiple(cache)} />
        <SideMetric label="ms / 1K" value={formatTiming(timing)} />
      </div>
    </section>
  )
}

function SideMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="models-side-metric"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>
}

export function ModelsDistributionRail({ rows }: { rows: ModelRow[] }) {
  const [metric, setMetric] = useState<DistributionMetric>('calls')
  const topRow = rows[0] ?? null
  return (
    <aside className="models-side-rail" aria-label="Model insights">
      <section className="models-side-card models-distribution-card" aria-labelledby="models-distribution-title">
        <div className="models-side-card-head compact">
          <div><span className="models-side-eyebrow">Model usage distribution</span><h2 id="models-distribution-title">Usage mix</h2></div>
          <span className="models-side-link">Observed</span>
        </div>
        <div className="models-side-segmented" role="tablist" aria-label="Model distribution metric">
          {(['calls', 'tokens', 'spend'] as DistributionMetric[]).map(option => (
            <button key={option} type="button" role="tab" aria-selected={metric === option} onClick={() => setMetric(option)}>{option[0]!.toUpperCase() + option.slice(1)}</button>
          ))}
        </div>
        <DistributionBars rows={rows} metric={metric} />
      </section>
      <ModelSummaryCard row={topRow} />
    </aside>
  )
}

type TaskAggregate = { label: string; calls: number; tokens: number; cost: number }

function reportTotal(row: ModelReportRow): number {
  return Number.isFinite(row.totalTokens) ? row.totalTokens : totalTokenCount(row)
}

function aggregateTasks(rows: ModelReportRow[]): TaskAggregate[] {
  const grouped = new Map<string, TaskAggregate>()
  for (const row of rows) {
    const label = row.category ? formatLabel(row.category) : 'Uncategorized'
    const current = grouped.get(label) ?? { label, calls: 0, tokens: 0, cost: 0 }
    current.calls += row.calls
    current.tokens += reportTotal(row)
    current.cost += row.costUSD
    grouped.set(label, current)
  }
  return [...grouped.values()].sort((a, b) => b.calls - a.calls || b.tokens - a.tokens)
}

function aggregateSources(rows: ModelReportRow[]): Array<TaskAggregate & { source: string }> {
  const grouped = new Map<string, TaskAggregate & { source: string }>()
  for (const row of rows) {
    const source = row.providerDisplayName || row.provider || 'Unknown source'
    const current = grouped.get(source) ?? { label: source, source, calls: 0, tokens: 0, cost: 0 }
    current.calls += row.calls
    current.tokens += reportTotal(row)
    current.cost += row.costUSD
    grouped.set(source, current)
  }
  return [...grouped.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
}

function reportModelTotals(rows: ModelReportRow[]): Array<TaskAggregate & { model: string; source: string }> {
  const grouped = new Map<string, TaskAggregate & { model: string; source: string }>()
  for (const row of rows) {
    const key = `${row.provider}\u0000${row.model}`
    const current = grouped.get(key) ?? { label: row.modelDisplayName, model: row.modelDisplayName, source: row.providerDisplayName || row.provider, calls: 0, tokens: 0, cost: 0 }
    current.calls += row.calls
    current.tokens += reportTotal(row)
    current.cost += row.costUSD
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((a, b) => b.calls - a.calls || b.tokens - a.tokens)
}

function ReportBarList({ rows, value }: { rows: TaskAggregate[]; value: 'calls' | 'tokens' }) {
  const max = Math.max(0, ...rows.map(row => value === 'calls' ? row.calls : row.tokens))
  return (
    <div className="models-task-bar-list">
      {rows.slice(0, 5).map((row, index) => {
        const amount = value === 'calls' ? row.calls : row.tokens
        return <div className="models-task-bar-row" key={row.label}><span>{row.label}</span><span className="models-task-bar-track"><i className={`tone-${index % 5}`} style={{ width: `${max > 0 ? Math.max(6, amount / max * 100) : 0}%` }} /></span><strong>{value === 'calls' ? amount.toLocaleString('en-US') : formatCompact(amount)}</strong></div>
      })}
    </div>
  )
}

export function ModelsTaskInsightsRail({ rows }: { rows: ModelReportRow[] }) {
  const tasks = useMemo(() => aggregateTasks(rows), [rows])
  const sources = useMemo(() => aggregateSources(rows), [rows])
  const models = useMemo(() => reportModelTotals(rows), [rows])
  const mostUsed = models[0] ?? null
  const cheapest = [...models]
    .map(row => ({ row, unit: row.tokens > 0 ? row.cost / row.tokens * 1_000_000 : null }))
    .filter((entry): entry is { row: typeof models[number]; unit: number } => entry.unit != null && Number.isFinite(entry.unit))
    .sort((a, b) => a.unit - b.unit)[0] ?? null
  const taskCalls = tasks.reduce((sum, row) => sum + row.calls, 0)
  const topTask = tasks[0] ?? null

  if (rows.length === 0) return <aside className="models-side-rail" aria-label="Task insights"><div className="models-side-card"><EmptyNote>No task-level session detail is available in this range.</EmptyNote></div></aside>

  return (
    <aside className="models-side-rail" aria-label="Task insights">
      <div className="models-side-card models-highlight-card">
        <span className="models-side-eyebrow">Observed task signals</span>
        <div className="models-highlight-grid">
          <article className="models-highlight accent-purple"><span>Most used model</span>{mostUsed ? <div className="models-highlight-model"><ModelIdentity name={mostUsed.model} /></div> : <strong>—</strong>}<small>{mostUsed ? `${mostUsed.calls.toLocaleString('en-US')} calls` : 'Unavailable'}</small></article>
          <article className="models-highlight accent-green"><span>Lowest observed cost / 1M</span><strong>{cheapest ? formatUsd(cheapest.unit) : '—'}</strong><small>{cheapest ? <ModelIdentity name={cheapest.row.model} /> : 'No token denominator'}</small></article>
        </div>
      </div>
      <section className="models-side-card" aria-labelledby="models-task-usage-title">
        <div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Usage by task</span><h2 id="models-task-usage-title">Available task detail</h2></div><span className="models-side-link">{taskCalls.toLocaleString('en-US')} calls</span></div>
        <ReportBarList rows={tasks} value="calls" />
      </section>
      <section className="models-side-card" aria-labelledby="models-source-tokens-title">
        <div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Total tokens by source</span><h2 id="models-source-tokens-title">Observed volume</h2></div></div>
        <div className="models-provider-bars">
          {sources.slice(0, 5).map((row, index) => {
            const max = sources[0]?.tokens ?? 0
            return <div className="models-provider-bar-row" key={row.source}><div><ProviderLogo provider={providerLogoKey(row.source)} size={14} /><span>{row.source} usage</span></div><span className="models-task-bar-track"><i className={`tone-${index % 5}`} style={{ width: `${max > 0 ? Math.max(6, row.tokens / max * 100) : 0}%` }} /></span><strong>{formatCompact(row.tokens)}</strong></div>
          })}
        </div>
      </section>
      <div className="models-side-card models-insight-card"><span className="models-insight-icon" aria-hidden="true">✦</span><div><span className="models-side-eyebrow">Insight</span><p>{topTask ? `${topTask.label} accounts for ${percent(taskCalls > 0 ? topTask.calls / taskCalls * 100 : 0, 1)} of calls in the available task detail.` : 'No task attribution is available.'}</p><small>Task attribution uses surviving source sessions; durable model totals remain independent.</small></div></div>
    </aside>
  )
}

function auditTotal(row: AuditRow): number {
  return row.displayed.inputTokens + row.displayed.outputTokens + row.displayed.cacheReadTokens + row.displayed.cacheWriteTokens
}

function auditRecon(row: AuditRow): number | null {
  if (!row.rates) return null
  const denominator = Math.max(Math.abs(row.attributedCostUSD), 0.000001)
  if (denominator <= 0.000001 && Math.abs(row.cost.recomputedTotalUSD) <= 0.000001) return 100
  return clampPercent((1 - Math.abs(row.cost.recomputedTotalUSD - row.attributedCostUSD) / denominator) * 100)
}

function auditPricingLabel(row: AuditRow): string {
  if (!row.rates) return 'Unpriced'
  return Math.abs(row.cost.recomputedTotalUSD - row.attributedCostUSD) > 0.005 ? 'Estimated' : 'Priced'
}

type SourcePricingResolution = { source: string; total: number; resolved: number }

function sourcePricingResolution(rows: AuditRow[]): SourcePricingResolution[] {
  const grouped = new Map<string, SourcePricingResolution>()
  for (const row of rows) {
    const current = grouped.get(row.provider) ?? { source: row.provider, total: 0, resolved: 0 }
    current.total += 1
    if (row.rates) current.resolved += 1
    grouped.set(row.provider, current)
  }
  return [...grouped.values()].sort((a, b) => b.resolved - a.resolved || b.total - a.total || a.source.localeCompare(b.source))
}

function sourcePricingLabel(row: SourcePricingResolution): string {
  if (row.resolved === row.total) return 'Resolved'
  if (row.resolved === 0) return 'Unresolved'
  return 'Partial'
}

function AuditCoverageCard({ label, value, detail, tone = 'green' }: { label: string; value: string; detail: string; tone?: 'green' | 'blue' | 'orange' }) {
  const progress = value.endsWith('%') ? value : ['Complete', 'Resolved', 'Observed'].includes(value) ? '100%' : '0%'
  return <div className="models-evidence-coverage-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small><i className={`models-evidence-progress ${tone}`} style={{ width: progress }} /></div>
}

function AuditTokenChart({ row }: { row: AuditRow }) {
  const parts = [
    { label: 'Input', value: row.raw.inputTokens, className: 'input' },
    { label: 'Output', value: row.raw.outputTokens, className: 'output' },
    { label: 'Reasoning', value: row.raw.reasoningTokens, className: 'reasoning' },
    { label: 'Cache read', value: row.displayed.cacheReadTokens, className: 'cache-read' },
    { label: 'Cache write', value: row.raw.cacheCreationInputTokens, className: 'cache-write' },
  ]
  const max = Math.max(0, ...parts.map(part => part.value))
  return (
    <section className="models-side-card models-evidence-chart-card" aria-labelledby="models-evidence-token-title">
      <div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Token distribution</span><h2 id="models-evidence-token-title">Raw and displayed fields</h2></div><span className="models-side-link">{formatCompact(auditTotal(row))} displayed</span></div>
      <div className="models-evidence-bars" role="img" aria-label={`Token distribution for ${row.modelDisplayName}`}>
        {parts.map(part => <div className="models-evidence-bar" key={part.label} title={`${part.label}: ${formatCompact(part.value)}`}><i className={part.className} style={{ height: `${max > 0 ? Math.max(8, part.value / max * 100) : 8}%` }} /><span>{part.label}</span><strong>{formatCompact(part.value)} tokens</strong></div>)}
      </div>
      <div className="models-evidence-legend">{parts.map(part => <span key={part.label}><i className={part.className} aria-hidden="true" />{part.label}</span>)}</div>
    </section>
  )
}

export function ModelsEvidencePanel({ rows, selected, onClose }: { rows: AuditRow[]; selected: AuditRow | null; onClose: () => void }) {
  if (!selected) {
    return <aside className="models-side-rail" aria-label="Model evidence detail"><div className="models-side-card"><EmptyNote>No usage evidence is available for this range yet.</EmptyNote></div></aside>
  }
  const rawComplete = Object.values(selected.raw).every(value => typeof value === 'number' && Number.isFinite(value))
    && Object.values(selected.displayed).every(value => typeof value === 'number' && Number.isFinite(value))
  const recon = auditRecon(selected)
  const pricingState = auditPricingLabel(selected)
  const priced = selected.rates != null
  const sourceCoverage = sourcePricingResolution(rows)

  return (
    <aside className="models-side-rail" aria-label="Model evidence detail">
      <section className="models-side-card models-evidence-head">
        <div className="models-side-card-head"><div><span className="models-side-eyebrow">Model detail</span><h2>{selected.modelDisplayName}</h2><p>Client/source · {selected.providerDisplayName}</p></div><button type="button" className="models-side-close" aria-label="Close model evidence detail" onClick={onClose}>×</button></div>
        <div className="models-summary-tags"><span className={`models-side-chip ${pricingState === 'Unpriced' ? 'is-warn' : pricingState === 'Estimated' ? 'is-warn' : ''}`}>{pricingState}</span><span className="models-side-chip">{rawComplete ? 'Raw evidence' : 'Partial evidence'}</span>{recon != null ? <span className="models-side-chip">Cost aligned</span> : null}</div>
      </section>
      <section className="models-side-card" aria-label="Evidence and pricing status">
        <div className="models-evidence-grid">
          <AuditCoverageCard label="Raw field coverage" value={rawComplete ? 'Complete' : 'Partial'} detail={rawComplete ? `${selected.calls.toLocaleString('en-US')} calls observed` : 'One or more raw fields unavailable'} />
          <AuditCoverageCard label="Pricing resolution" value={priced ? 'Resolved' : 'Unresolved'} detail={priced ? 'Rate record resolved' : 'No rate record'} />
          <AuditCoverageCard label="Cost reconciliation" value={recon == null ? '—' : percent(recon)} detail={recon == null ? 'Cannot compare without rates' : 'Recomputed vs attributed'} tone="blue" />
          <AuditCoverageCard label="Reasoning evidence" value={selected.raw.reasoningTokens > 0 ? 'Observed' : '0'} detail={selected.raw.reasoningTokens > 0 ? `${formatCompact(selected.raw.reasoningTokens)} observed` : 'No reasoning recorded'} tone="orange" />
        </div>
      </section>
      <AuditTokenChart row={selected} />
      <section className="models-side-card" aria-labelledby="models-evidence-source-title">
        <div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Pricing resolution by source</span><h2 id="models-evidence-source-title">Resolved rate records</h2></div><span className="models-side-link">{rows.length} rows</span></div>
        <div className="models-provider-bars">
          {sourceCoverage.slice(0, 6).map((row, index) => <div className="models-provider-bar-row" key={row.source}><div><ProviderLogo provider={providerLogoKey(row.source)} size={14} /><span>{formatProviderLabel(row.source)}</span></div><span className="models-task-bar-track" title={`${row.resolved} of ${row.total} audited rows have a resolved rate record`}><i className={`tone-${index % 5}`} style={{ width: `${row.total > 0 ? row.resolved / row.total * 100 : 0}%` }} /></span><strong>{sourcePricingLabel(row)}</strong></div>)}
        </div>
      </section>
    </aside>
  )
}

function modelRowProvider(row: ModelRow): string {
  return providersFor(row)[0] ?? 'Unknown provider'
}

function CompareMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="models-compare-metric"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>
}

function CompareBars({ rows, metric }: { rows: ModelRow[]; metric: 'tokens' | 'cost' }) {
  const values = rows.map(row => ({ row, value: metric === 'tokens' ? totalFor(row) : row.cost })).filter((entry): entry is { row: ModelRow; value: number } => entry.value != null)
  const max = Math.max(0, ...values.map(entry => entry.value))
  return <div className="models-compare-bars">{values.map((entry, index) => <div className="models-compare-bar-item" key={entry.row.presentationIdentity}><div className="models-compare-bar-label"><ModelIdentity name={entry.row.name} brandId={entry.row.brandId} /><strong>{metric === 'tokens' ? formatCompact(entry.value) : formatUsd(entry.value)}</strong></div><span className="models-compare-bar-track"><i className={`tone-${index % 5}`} style={{ width: `${max > 0 ? Math.max(6, entry.value / max * 100) : 0}%` }} /></span></div>)}</div>
}

function CompareTokenMix({ rows }: { rows: ModelRow[] }) {
  return <div className="models-compare-mix-list">{rows.map(row => {
    const parts = tokenParts(row)
    const total = parts.reduce((sum, part) => sum + part.value, 0)
    return <div className="models-compare-mix-row" key={row.presentationIdentity}><div><ModelIdentity name={row.name} brandId={row.brandId} /></div>{total > 0 ? <span className="models-token-bar">{parts.map(part => <i className={part.className} key={part.label} style={{ width: `${part.value / total * 100}%` }} title={`${part.label}: ${formatCompact(part.value)}`} />)}</span> : <span className="models-compare-unavailable">Token detail unavailable</span>}<strong>{total > 0 ? formatCompact(total) : '—'}</strong></div>
  })}</div>
}

function CompareSignals({ rows }: { rows: ModelRow[] }) {
  const entries = rows.map(row => ({ row, unit: unitCostFor(row), cache: cacheFor(row), timing: timingFor(row) }))
  return <div className="models-compare-signal-list">{entries.map(entry => <div className="models-compare-signal-row" key={entry.row.presentationIdentity}><ModelIdentity name={entry.row.name} brandId={entry.row.brandId} /><span><small>Cost / 1M</small><strong>{entry.unit == null ? '—' : formatUsd(entry.unit)}</strong></span><span><small>Cache reuse</small><strong>{formatReuseMultiple(entry.cache)}</strong></span><span><small>ms / 1K</small><strong>{formatTiming(entry.timing)}</strong></span></div>)}</div>
}

function CompareTakeaways({ rows }: { rows: ModelRow[] }) {
  const withCost = rows.map(row => ({ row, value: unitCostFor(row) })).filter((entry): entry is { row: ModelRow; value: number } => entry.value != null).sort((a, b) => a.value - b.value)
  const withCache = rows.map(row => ({ row, value: cacheFor(row) })).filter((entry): entry is { row: ModelRow; value: number } => entry.value != null).sort((a, b) => b.value - a.value)
  const withTiming = rows.map(row => ({ row, value: timingFor(row) })).filter((entry): entry is { row: ModelRow; value: number } => entry.value != null).sort((a, b) => a.value - b.value)
  const items = [
    withCost[0] ? `${withCost[0].row.name} has the lowest observed cost per 1M tokens at ${formatUsd(withCost[0].value)}.` : null,
    withCache[0] ? `${withCache[0].row.name} has the highest observed cache reuse at ${formatReuseMultiple(withCache[0].value)}.` : null,
    withTiming[0] ? `${withTiming[0].row.name} has the fastest observed active generation at ${formatTiming(withTiming[0].value)} per 1K.` : null,
  ].filter((value): value is string => Boolean(value))
  if (items.length === 0) return <p className="models-side-muted">No comparable token, cache or timing signals are available for these models.</p>
  return <ol className="models-compare-takeaways">{items.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
}

function CompareModelsPanel({ rows, onClear, onRemove, onExit }: { rows: ModelRow[]; onClear: () => void; onRemove: (id: string) => void; onExit: () => void }) {
  const [tab, setTab] = useState<CompareTab>('overview')
  const knownTokens = rows.filter(row => totalFor(row) != null).reduce((sum, row) => sum + (totalFor(row) ?? 0), 0)
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0)
  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  const comparableTokens = rows.length > 0 && rows.every(row => totalFor(row) != null)
  const selectedUnitCost = comparableTokens && knownTokens > 0 ? totalCost / knownTokens * 1_000_000 : null
  const tabs: Array<{ value: CompareTab; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'cost', label: 'Cost' },
    { value: 'tokens', label: 'Token mix' },
    { value: 'cache', label: 'Cache & timing' },
  ]
  return (
    <aside className="models-compare-panel" aria-label="Compare models panel">
      <div className="models-compare-panel-head"><div><span className="models-side-eyebrow">Compare models</span><h2>Observed side-by-side analysis</h2></div><div className="models-compare-actions"><button type="button" onClick={onClear}>Clear all</button><button type="button" className="models-side-close" aria-label="Close compare panel" onClick={onExit}>×</button></div></div>
      <div className="models-compare-selection" aria-label="Selected models">
        {rows.length === 0 ? <span className="models-side-muted">Select up to three models from the table.</span> : rows.map(row => <span className="models-compare-chip" key={row.presentationIdentity}><ProviderLogo provider={providerLogoKey(modelRowProvider(row))} size={15} /><span><strong>{row.name}</strong><small>{providerText(row)}</small></span><button type="button" aria-label={`Remove ${row.name} from comparison`} onClick={() => onRemove(row.presentationIdentity)}>×</button></span>)}
      </div>
      <div className="models-compare-tabs" role="tablist" aria-label="Comparison views">
        {tabs.map(option => <button key={option.value} type="button" role="tab" aria-selected={tab === option.value} onClick={() => setTab(option.value)}>{option.label}</button>)}
      </div>
      {rows.length === 0 ? <div className="models-compare-empty"><EmptyNote>Select at least two models to compare observed usage.</EmptyNote></div> : (
        <div className="models-compare-body">
          <div className="models-compare-metrics">
            <CompareMetric label="Selected tokens" value={comparableTokens ? formatCompact(knownTokens) : formatCompact(knownTokens)} detail={`${rows.filter(row => totalFor(row) != null).length}/${rows.length} with token detail`} />
            <CompareMetric label="Selected cost" value={formatUsd(totalCost)} detail="sum of observed attribution" />
            <CompareMetric label="Calls" value={totalCalls.toLocaleString('en-US')} detail={`${rows.length} models`} />
            <CompareMetric label="Cost / 1M" value={selectedUnitCost == null ? '—' : formatUsd(selectedUnitCost)} detail={selectedUnitCost == null ? 'Requires complete token detail' : 'weighted observed value'} />
          </div>
          {tab === 'overview' ? <>
            <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Total tokens</span><h3>Selected models</h3></div></div><CompareBars rows={rows} metric="tokens" /></section>
            <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Observed cost</span><h3>Selected models</h3></div></div><CompareBars rows={rows} metric="cost" /></section>
            <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Key takeaways</span><h3>Measured signals</h3></div></div><CompareTakeaways rows={rows} /></section>
          </> : tab === 'cost' ? <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Cost efficiency</span><h3>Observed cost per 1M tokens</h3></div></div><CompareBars rows={rows} metric="cost" /><div className="models-compare-signal-list">{rows.map(row => <div className="models-compare-cost-row" key={row.presentationIdentity}><ModelIdentity name={row.name} /><strong>{unitCostFor(row) == null ? 'Unavailable' : formatUsd(unitCostFor(row)!)}</strong></div>)}</div></section> : tab === 'tokens' ? <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Token mix</span><h3>Input, output and cache</h3></div></div><CompareTokenMix rows={rows} /><div className="models-side-muted">Reasoning is included only when Metrora has an additive observed subtotal.</div></section> : <section className="models-compare-card"><div className="models-side-card-head compact"><div><span className="models-side-eyebrow">Cache & timing</span><h3>Observed efficiency signals</h3></div></div><CompareSignals rows={rows} /></section>}
        </div>
      )}
    </aside>
  )
}

export function ModelsCompareWorkspace({ rows, onExit }: { rows: ModelRow[]; onExit: () => void }) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [selectedIds, setSelectedIds] = useState<string[]>(() => rows.slice(0, 3).map(row => row.presentationIdentity))
  const providers = useMemo(() => [...new Set(rows.flatMap(providersFor))].sort((a, b) => a.localeCompare(b)), [rows])
  const filtered = useMemo(() => {
    const q = normalize(query)
    return rows.filter(row => {
      const haystack = [row.name, ...row.rawModels, ...providersFor(row)].map(normalize).join(' ')
      return (!q || haystack.includes(q)) && (provider === 'all' || providersFor(row).includes(provider))
    })
  }, [provider, query, rows])
  useEffect(() => {
    setSelectedIds(current => {
      const valid = current.filter(id => rows.some(row => row.presentationIdentity === id))
      if (valid.length > 0 || current.length === 0) return valid
      return rows.slice(0, 3).map(row => row.presentationIdentity)
    })
  }, [rows])
  const selectedRows = selectedIds.map(id => rows.find(row => row.presentationIdentity === id)).filter((row): row is ModelRow => Boolean(row))
  const toggle = (row: ModelRow) => setSelectedIds(current => current.includes(row.presentationIdentity)
    ? current.filter(id => id !== row.presentationIdentity)
    : current.length >= 3 ? current : [...current, row.presentationIdentity])
  const clear = () => setSelectedIds([])

  return (
    <div className="models-compare-workspace">
      <section className="models-list-pane models-compare-list-pane" aria-label="Models available for comparison">
        <div className="models-filter-row models-compare-filter-row">
          <label className="models-search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg><span className="sr-only">Filter models for comparison</span><input aria-label="Filter models for comparison" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter models…" /></label>
          <label className="models-filter-select"><span className="sr-only">Comparison provider</span><select aria-label="Comparison provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map(value => <option value={value} key={value}>{formatProviderLabel(value)}</option>)}</select><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></label>
          <span className="models-compare-selection-note">{selectedRows.length}/3 selected</span>
        </div>
        <div className="models-sort-toolbar"><span className="models-side-muted">Select up to three models for a factual comparison.</span><span className="models-result-count">{filtered.length.toLocaleString('en-US')} models</span></div>
        {filtered.length === 0 ? <div className="models-empty-state"><strong>No models match the current filters.</strong></div> : <div className="models-table-panel models-compare-table-panel"><table className="models-table models-compare-table" aria-label="Models available for comparison"><colgroup><col className="models-compare-col-check" /><col className="models-col-model" /><col className="models-col-provider" /><col className="models-col-calls" /><col className="models-col-total" /><col className="models-col-cost" /><col className="models-col-unit" /><col className="models-col-cachex" /><col className="models-col-timing" /></colgroup><thead><tr><th aria-label="Select" /><th>Model</th><th>Provider</th><th className="models-number">Calls</th><th className="models-number">Tokens</th><th className="models-number">Cost</th><th className="models-number">Cost / 1M</th><th className="models-number">Cache×</th><th className="models-number">ms/1K</th></tr></thead><tbody>{filtered.map(row => { const checked = selectedIds.includes(row.presentationIdentity); const disabled = !checked && selectedIds.length >= 3; return <tr key={row.presentationIdentity} className={checked ? 'is-selected' : undefined}><td className="models-compare-check"><input type="checkbox" aria-label={`Compare ${row.name}`} checked={checked} disabled={disabled} onChange={() => toggle(row)} /></td><td><ModelIdentity name={row.name} brandId={row.brandId} /></td><td><span className="models-provider-value"><ProviderLogo provider={providerLogoKey(modelRowProvider(row))} size={14} /><span>{providerText(row)}</span></span></td><td className="models-number">{row.calls.toLocaleString('en-US')}</td><td className="models-number models-total">{totalFor(row) == null ? '—' : formatCompact(totalFor(row)!)}</td><td className="models-number">{formatUsd(row.cost)}</td><td className="models-number models-unit-cost">{unitCostFor(row) == null ? '—' : formatUsd(unitCostFor(row)!)}</td><td className="models-number">{formatReuseMultiple(cacheFor(row))}</td><td className="models-number">{formatTiming(timingFor(row))}</td></tr>})}</tbody></table></div>}
        <div className="models-bounded-note">{selectedRows.length === 0 ? 'No models selected' : `${selectedRows.length} selected · selection is based on observed Metrora accounting`}</div>
      </section>
      {selectedRows.length > 0 ? <CompareModelsPanel rows={selectedRows} onClear={clear} onRemove={id => setSelectedIds(current => current.filter(value => value !== id))} onExit={onExit} /> : null}
    </div>
  )
}
