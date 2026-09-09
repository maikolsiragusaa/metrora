import { useEffect, useMemo, useState } from 'react'

import { EmptyNote } from '../components/EmptyState'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatUsd } from '../lib/format'
import { additiveReasoningTokenCount, cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow, ModelAccounting, ModelPresentation } from '../lib/types'
import { ModelIdentity } from './ModelsDurableTable'

type DurableModelRow = DurableModelPresentationRow
type UnpricedModel = { model: string; calls: number; tokens: number }
type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'activeMs' | 'unitCost'
type CostQualityKind = 'settled' | 'estimated' | 'partial' | 'unpriced' | 'unresolved'
type CostQuality = { kind: CostQualityKind; label: string; detail: string }

const MODEL_SORTS: Array<{ value: ModelSort; label: string }> = [
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'calls', label: 'Calls' },
  { value: 'cache', label: 'Cache ×' },
  { value: 'activeMs', label: 'ms / 1K' },
  { value: 'unitCost', label: 'Cost / 1M' },
]

function fmtInt(value: number): string {
  return value.toLocaleString('en-US')
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function providerLogoKey(value: string): string {
  const normalizedValue = normalize(value)
  if (normalizedValue.includes('openai') || normalizedValue === 'codex') return 'codex'
  if (normalizedValue.includes('anthropic') || normalizedValue.includes('claude')) return 'claude'
  if (normalizedValue.includes('google') || normalizedValue.includes('gemini')) return 'gemini'
  if (normalizedValue.includes('mistral')) return 'mistral-vibe'
  if (normalizedValue.includes('alibaba') || normalizedValue.includes('qwen')) return 'qwen'
  if (normalizedValue.includes('x.ai') || normalizedValue.includes('grok')) return 'grok'
  return value
}

function providerValues(row: DurableModelRow): string[] {
  if (row.providers.length > 0) return row.providers
  return row.provider ? [row.provider] : []
}

function sourceValues(row: DurableModelRow): string[] {
  return row.sourceProviders.filter(value => value.trim().length > 0)
}

function modelTotal(row: DurableModelRow): number | null {
  return row.tokenDetail ? totalTokenCount(row) : null
}

function modelCacheReuse(row: DurableModelRow): number | null {
  return row.tokenDetail ? cacheReuseMultiple(row.inputTokens, row.cacheReadTokens) : null
}

function modelUnitCost(row: DurableModelRow): number | null {
  return row.tokenDetail ? costPerMillionTotal(row.cost, row) : null
}

function modelMsPer1K(row: DurableModelRow): number | null {
  const duration = row.activeDurationMs ?? 0
  const generated = row.activeGeneratedTokens ?? 0
  if (!(duration > 0) || !(generated > 0)) return null
  return duration * 1000 / generated
}

function formatMsPer1K(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}ms`
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return right - left
}

function compareNullableAscending(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return left - right
}

function sortRows(rows: DurableModelRow[], sort: ModelSort): DurableModelRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = left.row
      const b = right.row
      let comparison = 0
      if (sort === 'tokens') comparison = compareNullableDescending(modelTotal(a), modelTotal(b))
      else if (sort === 'calls') comparison = b.calls - a.calls
      else if (sort === 'cache') comparison = compareNullableDescending(modelCacheReuse(a), modelCacheReuse(b))
      else if (sort === 'activeMs') comparison = compareNullableAscending(modelMsPer1K(a), modelMsPer1K(b))
      else if (sort === 'unitCost') comparison = compareNullableAscending(modelUnitCost(a), modelUnitCost(b))
      else comparison = (b.cost - a.cost) || (b.calls - a.calls)
      return comparison || left.index - right.index
    })
    .map(item => item.row)
}

function deliveryPricingState(delivery: DurableModelAccountingRow): 'settled' | 'estimated' | 'unavailable' {
  if (delivery.costIsEstimated === true || (delivery.estimatedCostUSD ?? 0) > 0) return 'estimated'
  if (delivery.tokenDetail === false && delivery.cost === 0 && delivery.calls > 0) return 'unavailable'
  return 'settled'
}

function matchesUnpricedModel(row: Pick<DurableModelRow, 'name' | 'rawModels'>, unpricedModels: UnpricedModel[]): boolean {
  const names = new Set([row.name, ...row.rawModels].map(normalize))
  return unpricedModels.some(item => names.has(normalize(item.model)))
}

function costQuality(row: DurableModelRow, unpricedModels: UnpricedModel[]): CostQuality {
  const deliveryStates = row.deliveryRows.map(deliveryPricingState)
  const hasEstimated = row.pricingState === 'estimated'
    || row.costIsEstimated === true
    || (row.estimatedCostUSD ?? 0) > 0
    || deliveryStates.includes('estimated')
  const hasUnpricedModel = matchesUnpricedModel(row, unpricedModels)
  const hasUnpriced = row.pricingState === 'unavailable'
    || deliveryStates.includes('unavailable')
    || hasUnpricedModel
  const hasMixedDelivery = deliveryStates.includes('unavailable')
    && (deliveryStates.includes('estimated') || deliveryStates.includes('settled'))

  if (row.pricingState === 'mixed' || hasMixedDelivery || (hasUnpricedModel && row.cost > 0)) {
    return { kind: 'partial', label: 'partial', detail: 'Cost is partial: some model usage is estimated or unpriced.' }
  }
  if (hasUnpriced) {
    return { kind: 'unpriced', label: 'unpriced', detail: 'Cost is unavailable because no authoritative pricing evidence was resolved for this model.' }
  }
  if (hasEstimated) {
    return { kind: 'estimated', label: 'est.', detail: 'Cost includes usage priced from estimated tokens.' }
  }
  return { kind: 'settled', label: '', detail: 'Cost has settled pricing evidence.' }
}

function deliveryQuality(delivery: DurableModelAccountingRow): CostQuality {
  const state = deliveryPricingState(delivery)
  if (state === 'unavailable') return { kind: 'unpriced', label: 'unpriced', detail: 'No authoritative pricing evidence was resolved for this delivery.' }
  if (state === 'estimated') return { kind: 'estimated', label: 'est.', detail: 'Cost includes usage priced from estimated tokens.' }
  return { kind: 'settled', label: '', detail: 'Cost has settled pricing evidence.' }
}

function unavailableValue(explanation: string) {
  return <span className="models-unavailable" aria-label={explanation}>—</span>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="models-inspector-metric" title={detail ? `${label}: ${detail}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="models-filter-select">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        <option value="all">All {label.toLowerCase()}s</option>
        {options.map(option => <option key={option} value={option}>{formatLabel(option)}</option>)}
      </select>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </label>
  )
}

function CostCell({ row, quality }: { row: DurableModelRow; quality: CostQuality }) {
  return (
    <span className="models-cost-content" title={quality.kind === 'settled' ? undefined : quality.detail}>
      {quality.kind === 'unpriced' ? unavailableValue(`Cost unavailable for ${row.name}. ${quality.detail}`) : formatUsd(row.cost)}
      {quality.kind !== 'settled' ? <small className={`models-cost-quality models-cost-quality-${quality.kind}`}>{quality.label}</small> : null}
    </span>
  )
}

function ProviderCell({ row }: { row: DurableModelRow }) {
  const values = providerValues(row)
  const label = values.length > 0 ? values.map(formatLabel).join(', ') : 'Unavailable'
  return (
    <span className="models-provider-value" title={label}>
      {values.length > 0 ? <ProviderLogo provider={providerLogoKey(values[0]!)} size={14} /> : null}
      <span>{label}</span>
    </span>
  )
}

function SourceCell({ row }: { row: DurableModelRow }) {
  const values = sourceValues(row)
  const label = values.length > 0 ? values.map(formatLabel).join(', ') : 'Unavailable'
  return <span className={`models-source-value${values.length === 0 ? ' is-unavailable' : ''}`} title={label}>{label}</span>
}

function ModelTableRow({
  row,
  selected,
  unpricedModels,
  onSelect,
}: {
  row: DurableModelRow
  selected: boolean
  unpricedModels: UnpricedModel[]
  onSelect: () => void
}) {
  const quality = costQuality(row, unpricedModels)
  const total = modelTotal(row)
  const reuse = modelCacheReuse(row)
  const unitCost = quality.kind === 'unpriced' ? null : modelUnitCost(row)
  const timing = modelMsPer1K(row)
  return (
    <tr className={selected ? 'is-selected' : undefined}>
      <td className="models-model-cell">
        <button
          type="button"
          className="models-row-trigger"
          aria-label={`Select ${row.name}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          <span className="models-row-marker" aria-hidden="true" />
          <ModelIdentity name={row.name} />
        </button>
      </td>
      <td><ProviderCell row={row} /></td>
      <td><SourceCell row={row} /></td>
      <td className="models-number">{fmtInt(row.calls)}</td>
      <td className="models-number models-token-input">{row.tokenDetail ? formatCompact(row.inputTokens) : unavailableValue('Input token evidence is unavailable for this model.')}</td>
      <td className="models-number models-token-output">{row.tokenDetail ? formatCompact(row.outputTokens) : unavailableValue('Output token evidence is unavailable for this model.')}</td>
      <td className="models-number models-token-cache">{row.tokenDetail ? formatCompact(row.cacheReadTokens) : unavailableValue('Cache-read token evidence is unavailable for this model.')}</td>
      <td className="models-number models-token-cache">{row.tokenDetail ? formatCompact(row.cacheWriteTokens) : unavailableValue('Cache-write token evidence is unavailable for this model.')}</td>
      <td className="models-number" title={reuse == null ? 'Cache reuse is unavailable because no valid input denominator is recorded for this model.' : undefined}>{reuse == null ? unavailableValue('Cache reuse is unavailable for this model.') : formatReuseMultiple(reuse)}</td>
      <td className="models-number models-total">{total == null ? unavailableValue('Total token evidence is unavailable for this model.') : formatCompact(total)}</td>
      <td className="models-number" title={timing == null ? 'Reliable active-generation timing is unavailable for this model.' : `Timing coverage: ${row.timingCoverage}`}>
        {timing == null ? unavailableValue('Milliseconds per 1K generated tokens is unavailable for this model.') : formatMsPer1K(timing)}
      </td>
      <td className={quality.kind === 'settled' ? undefined : 'models-cost-quality-cell'}><CostCell row={row} quality={quality} /></td>
      <td className="models-number models-unit-cost" title={unitCost == null ? 'Cost / 1M is unavailable because a safe token denominator is not recorded.' : quality.detail}>
        {unitCost == null ? unavailableValue('Cost / 1M is unavailable for this model.') : formatUsd(unitCost)}
      </td>
    </tr>
  )
}

function tokenParts(row: DurableModelRow): Array<{ label: string; value: number; className: string }> {
  if (!row.tokenDetail) return []
  const parts = [
    { label: 'Input', value: row.inputTokens, className: 'input' },
    { label: 'Output', value: row.outputTokens, className: 'output' },
    { label: 'Cache R', value: row.cacheReadTokens, className: 'cache-read' },
    { label: 'Cache W', value: row.cacheWriteTokens, className: 'cache-write' },
  ]
  const additiveReasoning = additiveReasoningTokenCount(row)
  if (additiveReasoning > 0) parts.push({ label: 'Reasoning', value: additiveReasoning, className: 'reasoning' })
  return parts
}

function TokenComposition({ row }: { row: DurableModelRow }) {
  const parts = tokenParts(row)
  if (!row.tokenDetail) {
    return <div className="models-inspector-unavailable" role="status">Token composition is unavailable for this row; aggregate cost and calls remain canonical.</div>
  }
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <section className="models-inspector-section" aria-labelledby="models-token-composition-title">
      <div className="models-inspector-section-head">
        <div><h3 id="models-token-composition-title">Token composition</h3><span>Observed metered volume</span></div>
        <strong>{formatCompact(total)} total</strong>
      </div>
      <div className="models-token-bar" role="img" aria-label={`Observed token composition: ${formatCompact(total)} total`}>
        {parts.map(part => <span key={part.label} className={`models-token-segment ${part.className}`} style={{ width: `${total > 0 ? part.value / total * 100 : 0}%` }} title={`${part.label}: ${formatCompact(part.value)}`} />)}
      </div>
      <div className="models-token-legend">
        {parts.map(part => <span key={part.label}><i className={part.className} aria-hidden="true" />{part.label}<strong>{formatCompact(part.value)}</strong></span>)}
      </div>
    </section>
  )
}

function statusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function ModelInspector({ row, unpricedModels, onClose }: { row: DurableModelRow; unpricedModels: UnpricedModel[]; onClose: () => void }) {
  const quality = costQuality(row, unpricedModels)
  const total = modelTotal(row)
  const reuse = modelCacheReuse(row)
  const unitCost = quality.kind === 'unpriced' ? null : modelUnitCost(row)
  const timing = modelMsPer1K(row)
  const providers = providerValues(row)
  const sources = sourceValues(row)
  const pricingLabel = quality.kind === 'settled' ? 'Priced' : statusLabel(quality.kind)
  return (
    <aside className="models-inspector" aria-label="Model inspector">
      <div className="models-inspector-header">
        <div className="models-inspector-kicker">Model detail</div>
        <button type="button" className="models-inspector-close" aria-label="Close model inspector" onClick={onClose}>×</button>
        <div className="models-inspector-title-row">
          <ModelIdentity name={row.name} />
          <span className="models-inspector-provider">{providers.length > 0 ? providers.map(formatLabel).join(', ') : 'Provider unavailable'}</span>
        </div>
        <div className="models-inspector-source">{sources.length > 0 ? sources.map(formatLabel).join(', ') : 'Source unavailable'}</div>
        <div className="models-inspector-tags">
          <span className={`models-status-chip ${quality.kind}`}>{pricingLabel}</span>
          <span className={`models-status-chip ${row.tokenDetail ? 'available' : 'unavailable'}`}>{row.tokenDetail ? 'Token detail' : 'Token detail unavailable'}</span>
          <span className={`models-status-chip ${row.timingCoverage}`}>{statusLabel(row.timingCoverage)} timing</span>
        </div>
      </div>

      <div className="models-inspector-metrics" aria-label="Model metrics">
        <Metric label="Total cost" value={quality.kind === 'unpriced' ? 'Unavailable' : formatUsd(row.cost)} detail={quality.detail} />
        <Metric label="Total tokens" value={total == null ? 'Unavailable' : formatCompact(total)} detail={row.tokenDetail ? 'Observed metered volume' : 'No durable token split'} />
        <Metric label="Canonical calls" value={fmtInt(row.calls)} />
        <Metric label="Cache ×" value={formatReuseMultiple(reuse)} detail="Cache-read per uncached input" />
        <Metric label="ms / 1K" value={formatMsPer1K(timing)} detail={timing == null ? 'Active-generation timing unavailable' : `${statusLabel(row.timingCoverage)} timing`} />
        <Metric label="Cost / 1M" value={unitCost == null ? 'Unavailable' : formatUsd(unitCost)} detail="Effective observed value" />
      </div>

      <div className="models-inspector-evidence" aria-label="Model evidence state">
        <div><span>Pricing</span><strong>{pricingLabel}</strong></div>
        <div><span>Delivery</span><strong>{statusLabel(row.deliveryStatus)}</strong></div>
        <div><span>Timing</span><strong>{statusLabel(row.timingCoverage)}</strong></div>
      </div>

      <TokenComposition row={row} />

      <section className="models-inspector-section models-inspector-provenance" aria-label="Model provenance">
        <div className="models-inspector-section-head"><div><h3>Provenance</h3><span>Recorded route and collector facts</span></div></div>
        <dl>
          <div><dt>Provider</dt><dd>{providers.length > 0 ? providers.map(formatLabel).join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Source</dt><dd>{sources.length > 0 ? sources.map(formatLabel).join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Delivery state</dt><dd>{statusLabel(row.deliveryStatus)}</dd></div>
        </dl>
      </section>

      {row.deliveryRows.length > 1 ? (
        <section className="models-inspector-section" aria-label="Recorded model deliveries">
          <div className="models-inspector-section-head"><div><h3>Recorded deliveries</h3><span>No source split is synthesized</span></div><strong>{row.deliveryRows.length}</strong></div>
          <div className="models-delivery-list">
            {row.deliveryRows.map((delivery, index) => {
              const deliveryCost = deliveryQuality(delivery)
              const provider = delivery.provider ? formatLabel(delivery.provider) : 'Provider unavailable'
              const source = delivery.sourceProviders?.length ? delivery.sourceProviders.map(formatLabel).join(', ') : 'Source unavailable'
              return (
                <div className="models-delivery-item" key={`${delivery.name}-${delivery.provider ?? 'unknown'}-${index}`}>
                  <div><strong>{formatLabel(delivery.semanticVariant ?? 'default')}</strong><span>{provider} · {source}</span></div>
                  <div><strong>{fmtInt(delivery.calls)}</strong><span>{deliveryCost.kind === 'unpriced' ? 'unpriced' : formatUsd(delivery.cost)}</span></div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <p className="models-inspector-note">Indicators show observed Metrora data only. Unavailable values are not inferred.</p>
    </aside>
  )
}

export function ModelsControlCenter({
  accounting,
  presentation,
  legacyPresentationRow,
  unpricedModels = [],
}: {
  accounting: ModelAccounting
  presentation: ModelPresentation
  legacyPresentationRow: (row: DurableModelAccountingRow, index: number) => DurableModelPresentationRow
  unpricedModels?: UnpricedModel[]
}) {
  const [query, setQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sort, setSort] = useState<ModelSort>('cost')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const values = [...presentation.rows]
    if (accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001) {
      values.push(legacyPresentationRow({
        name: 'Other models',
        ...accounting.gap,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokenDetail: false,
      }, presentation.rows.length))
    }
    return values
  }, [accounting, legacyPresentationRow, presentation.rows])

  const providerOptions = useMemo(() => [...new Set(rows.flatMap(providerValues))].sort((a, b) => a.localeCompare(b)), [rows])
  const sourceOptions = useMemo(() => [...new Set(rows.flatMap(sourceValues))].sort((a, b) => a.localeCompare(b)), [rows])
  const filteredRows = useMemo(() => {
    const normalizedQuery = normalize(query)
    const values = rows.filter(row => {
      const providers = providerValues(row)
      const sources = sourceValues(row)
      const haystack = [row.name, ...row.rawModels, ...providers, ...sources].map(normalize).join(' ')
      return (!normalizedQuery || haystack.includes(normalizedQuery))
        && (providerFilter === 'all' || providers.includes(providerFilter))
        && (sourceFilter === 'all' || sources.includes(sourceFilter))
    })
    return sortRows(values, sort)
  }, [providerFilter, query, rows, sort, sourceFilter])

  useEffect(() => {
    if (selectedId && !filteredRows.some(row => row.presentationIdentity === selectedId)) setSelectedId(null)
  }, [filteredRows, selectedId])

  const selectedRow = selectedId ? filteredRows.find(row => row.presentationIdentity === selectedId) ?? null : null
  const hasFilters = query.trim().length > 0 || providerFilter !== 'all' || sourceFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setProviderFilter('all')
    setSourceFilter('all')
  }

  return (
    <div className={`models-workspace${selectedRow ? ' has-inspector' : ''}`}>
      <section className="models-list-pane" aria-label="Models control center">
        <div className="models-filter-row">
          <label className="models-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
            <span className="sr-only">Filter models</span>
            <input aria-label="Filter models" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter models, providers, or sources…" />
          </label>
          <FilterSelect label="Provider" value={providerFilter} options={providerOptions} onChange={setProviderFilter} />
          <FilterSelect label="Source" value={sourceFilter} options={sourceOptions} onChange={setSourceFilter} />
          {hasFilters ? <button type="button" className="models-clear-filter" onClick={clearFilters}>Clear filters</button> : null}
        </div>

        <div className="models-sort-toolbar">
          <div className="models-sort" role="group" aria-label="Sort models">
            <span>Sort</span>
            {MODEL_SORTS.map(option => <button key={option.value} type="button" aria-pressed={sort === option.value} onClick={() => setSort(option.value)}>{option.label}</button>)}
          </div>
          <span className="models-result-count">{filteredRows.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} models</span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="models-empty-state"><strong>{hasFilters ? 'No models match the current filters.' : 'No model usage in this range yet.'}</strong>{hasFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : <EmptyNote>Change the scope or refresh after new activity is collected.</EmptyNote>}</div>
        ) : (
          <div className="models-table-panel">
            <table className="models-table" aria-label="Model usage">
              <caption className="sr-only">Detailed model usage for the selected scope</caption>
              <colgroup>
                <col className="models-col-model" /><col className="models-col-provider" /><col className="models-col-source" /><col className="models-col-calls" />
                <col className="models-col-token" /><col className="models-col-token" /><col className="models-col-cache" /><col className="models-col-cache" /><col className="models-col-cachex" />
                <col className="models-col-total" /><col className="models-col-timing" /><col className="models-col-cost" /><col className="models-col-unit" />
              </colgroup>
              <thead>
                <tr>
                  <th>Model</th><th>Provider</th><th>Source</th><th className="models-number">Calls</th><th className="models-number">Input</th><th className="models-number">Output</th>
                  <th className="models-number">Cache R</th><th className="models-number">Cache W</th><th className="models-number" title="Cached input read per uncached input token">Cache×</th>
                  <th className="models-number">Total</th><th className="models-number" title="Active generation milliseconds per 1,000 generated tokens">ms/1K</th><th className="models-number">Cost</th><th className="models-number">Cost/1M</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => <ModelTableRow key={row.presentationIdentity} row={row} selected={selectedId === row.presentationIdentity} unpricedModels={unpricedModels} onSelect={() => setSelectedId(row.presentationIdentity)} />)}
              </tbody>
            </table>
          </div>
        )}
        <div className="models-bounded-note">{filteredRows.length.toLocaleString('en-US')} rows shown from canonical model accounting · unavailable facts remain explicit</div>
      </section>

      {selectedRow ? <ModelInspector row={selectedRow} unpricedModels={unpricedModels} onClose={() => setSelectedId(null)} /> : null}
    </div>
  )
}
