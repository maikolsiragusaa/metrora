import { useEffect, useMemo, useState } from 'react'

import { Dropdown } from '../components/Dropdown'
import { EmptyNote } from '../components/EmptyState'
import { ProviderFilterStrip, type ProviderFilterOption } from '../components/ProviderFilterStrip'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatDayShort, formatUsd } from '../lib/format'
import { modelHouseLabel, modelHouseLogoKey, modelHouseValues, type ModelHouseId } from '../lib/modelPresentation'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { additiveReasoningTokenCount, cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow, MenubarPayload, ModelAccounting, ModelPresentation } from '../lib/types'
import { ModelIdentity } from './ModelsDurableTable'
import { ModelsCompareWorkspace } from './ModelsSidePanels'

type DurableModelRow = DurableModelPresentationRow
type UnpricedModel = { model: string; calls: number; tokens: number }
type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'activeMs' | 'unitCost'
type ModelSortKey = ModelSort | 'input' | 'output' | 'cacheRead' | 'cacheWrite'
type ModelSortDirection = 'desc' | 'asc'
type ModelColumnSort = { key: ModelSortKey; direction: ModelSortDirection }
type CostQualityKind = 'settled' | 'estimated' | 'partial' | 'unpriced' | 'unresolved'
type CostQuality = { kind: CostQualityKind; label: string; detail: string }

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

/** Delivery/API providers; never use this for the model-house strip. */
function deliveryProviderValues(row: DurableModelRow): string[] {
  if (row.providers.length > 0) return row.providers
  return row.provider ? [row.provider] : []
}

/** Metrora clients/sources that contributed the observed row. */
function clientSourceValues(row: DurableModelRow): string[] {
  return row.sourceProviders.filter(value => value.trim().length > 0)
}

function modelBrandValues(row: DurableModelRow): Exclude<ModelHouseId, 'unresolved'>[] {
  return modelHouseValues(row).filter((value): value is Exclude<ModelHouseId, 'unresolved'> => value !== 'unresolved')
}

function modelBrandText(row: DurableModelRow): string {
  const values = modelBrandValues(row)
  return values.length > 0 ? values.map(modelHouseLabel).join(', ') : 'Unavailable'
}

function compactIdentity(values: string[], emptyLabel = 'Unavailable'): { label: string; title: string } {
  const labels = values.map(formatProviderLabel)
  if (labels.length === 0) return { label: emptyLabel, title: emptyLabel }
  return {
    label: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0]!,
    title: labels.join(', '),
  }
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

/**
 * Direction is always numeric (desc = larger values first) so the header arrow
 * and aria-sort stay truthful. Unavailable (null) metrics sort last in both
 * directions; the original row index breaks ties for stability.
 */
function sortRows(rows: DurableModelRow[], sort: ModelColumnSort): DurableModelRow[] {
  const sign = sort.direction === 'asc' ? -1 : 1
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = left.row
      const b = right.row
      const key = sort.key
      let comparison: number
      if (key === 'tokens' || key === 'cache' || key === 'activeMs' || key === 'unitCost') {
        const leftValue = key === 'tokens' ? modelTotal(a) : key === 'cache' ? modelCacheReuse(a) : key === 'activeMs' ? modelMsPer1K(a) : modelUnitCost(a)
        const rightValue = key === 'tokens' ? modelTotal(b) : key === 'cache' ? modelCacheReuse(b) : key === 'activeMs' ? modelMsPer1K(b) : modelUnitCost(b)
        if (leftValue == null && rightValue == null) comparison = 0
        else if (leftValue == null) comparison = 1
        else if (rightValue == null) comparison = -1
        else comparison = sign * (rightValue - leftValue)
      } else {
        const leftValue = key === 'input' ? a.inputTokens : key === 'output' ? a.outputTokens : key === 'cacheRead' ? a.cacheReadTokens : key === 'cacheWrite' ? a.cacheWriteTokens : a.cost
        const rightValue = key === 'input' ? b.inputTokens : key === 'output' ? b.outputTokens : key === 'cacheRead' ? b.cacheReadTokens : key === 'cacheWrite' ? b.cacheWriteTokens : b.cost
        comparison = sign * (rightValue - leftValue)
      }
      if (key === 'cost' && comparison === 0) comparison = sign * (b.calls - a.calls)
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

function SourceFilter({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div className="models-source-filter">
      <Dropdown
        id="models-source-filter"
        ariaLabel="Model source"
        value={value}
        width="100%"
        options={[{ value: 'all', label: 'All model sources' }, ...options.map(option => ({ value: option, label: formatProviderLabel(option) }))]}
        onChange={onChange}
        renderIcon={source => source === 'all'
          ? <span className="models-source-filter-icon" aria-hidden="true">◌</span>
          : <ProviderLogo provider={providerLogoKey(source)} size={13} />}
      />
    </div>
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
  const values = deliveryProviderValues(row)
  const identity = compactIdentity(values)
  return (
    <span className={`models-provider-value${values.length === 0 ? ' is-unavailable' : ''}`} title={`Delivery provider/API route: ${identity.title}`}>
      {values.length > 0 ? <ProviderLogo provider={providerLogoKey(values[0]!)} size={14} /> : null}
      <span>{identity.label}</span>
    </span>
  )
}

function SourceCell({ row }: { row: DurableModelRow }) {
  const values = clientSourceValues(row)
  const identity = compactIdentity(values)
  return (
    <span className={`models-source-value${values.length === 0 ? ' is-unavailable' : ''}`} title={`Metrora client/source: ${identity.title}`}>
      {values.length > 0 ? <ProviderLogo provider={providerLogoKey(values[0]!)} size={13} /> : null}
      <span>{identity.label}</span>
    </span>
  )
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
          <ModelIdentity name={row.name} brandId={row.brandId} />
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

/** Sortable table header: every sortable column carries a faint arrow so the
 * affordance is visible; the active column's arrow is colored and points in
 * the current direction. One click on the active column reverses it. */
function ModelSortHeader({
  label,
  sortKey,
  sort,
  title,
  onSort,
}: {
  label: string
  sortKey: ModelSortKey
  sort: ModelColumnSort
  title?: string
  onSort: (key: ModelSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th
      className="models-number"
      aria-sort={active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : undefined}
      title={title ?? 'Click to sort by this column · click again to reverse the direction'}
    >
      <button
        type="button"
        className={`models-sort-header${active ? ' on' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="models-sort-arrow" aria-hidden="true">
          {active ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </button>
    </th>
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

type ModelInspectorTab = 'providers' | 'metadata'

function ModelActivityChart({ row, history }: { row: DurableModelRow; history?: MenubarPayload['history'] }) {
  const names = new Set([row.name, ...row.rawModels].map(normalize))
  const points = (history?.daily ?? []).map(day => {
    const matches = day.topModels.filter(model => names.has(normalize(model.name)))
    return {
      date: day.date,
      input: matches.reduce((sum, model) => sum + model.inputTokens, 0),
      output: matches.reduce((sum, model) => sum + model.outputTokens, 0),
      calls: matches.reduce((sum, model) => sum + model.calls, 0),
    }
  }).filter(point => point.input > 0 || point.output > 0 || point.calls > 0)
  const max = Math.max(0, ...points.map(point => point.input + point.output))
  const input = points.reduce((sum, point) => sum + point.input, 0)
  const output = points.reduce((sum, point) => sum + point.output, 0)
  const calls = points.reduce((sum, point) => sum + point.calls, 0)
  if (points.length === 0) {
    return (
      <section className="models-inspector-activity models-inspector-activity-empty" aria-labelledby="models-token-activity-title">
        <div className="models-inspector-activity-empty-head">
          <h3 id="models-token-activity-title">Available daily token activity</h3>
          <span role="status">Daily activity unavailable for this model.</span>
        </div>
      </section>
    )
  }
  return (
    <section className="models-inspector-chart" aria-labelledby="models-token-activity-title">
      <div className="models-inspector-section-head">
        <div><h3 id="models-token-activity-title">Available daily token activity</h3><span>{calls.toLocaleString('en-US')} calls · derived from available daily top-model evidence</span></div>
        <div className="models-activity-legend"><span><i className="input" aria-hidden="true" />Input</span><span><i className="output" aria-hidden="true" />Output</span></div>
      </div>
      <div className="models-activity-plot" role="img" aria-label={`Daily token activity for ${row.name}: ${formatCompact(input)} input and ${formatCompact(output)} output.`}>
        <div className="models-activity-grid">{points.map((point, index) => <span className="models-activity-bar" key={`${point.date}-${index}`} title={`${formatDayShort(point.date)} · ${point.calls.toLocaleString('en-US')} calls`} style={{ height: `${max > 0 ? Math.max(8, (point.input + point.output) / max * 100) : 8}%` }}><i className="input" style={{ flexGrow: point.input }} /><i className="output" style={{ flexGrow: point.output }} /></span>)}</div>
      </div>
      <div className="models-activity-axis" aria-hidden="true"><span>{formatDayShort(points[0]!.date)}</span><span>{formatDayShort(points[Math.floor(points.length / 2)]!.date)}</span><span>{formatDayShort(points[points.length - 1]!.date)}</span></div>
      <div className="models-activity-summary"><span>Input {formatCompact(input)} · Output {formatCompact(output)}</span><strong>{formatCompact(input + output)} observed</strong></div>
    </section>
  )
}

function ModelInspector({ row, unpricedModels, history, onClose }: { row: DurableModelRow; unpricedModels: UnpricedModel[]; history?: MenubarPayload['history']; onClose: () => void }) {
  const [tab, setTab] = useState<ModelInspectorTab>('providers')
  useEffect(() => setTab('providers'), [row.presentationIdentity])
  const quality = costQuality(row, unpricedModels)
  const total = modelTotal(row)
  const reuse = modelCacheReuse(row)
  const unitCost = quality.kind === 'unpriced' ? null : modelUnitCost(row)
  const timing = modelMsPer1K(row)
  const deliveryProviders = deliveryProviderValues(row)
  const clientSources = clientSourceValues(row)
  const pricingLabel = quality.kind === 'settled' ? 'Resolved' : quality.kind === 'partial' ? 'Partial' : statusLabel(quality.kind)
  return (
    <aside className="models-inspector" aria-label="Model inspector">
      <div className="models-inspector-header">
        <div className="models-inspector-kicker">Model detail</div>
        <button type="button" className="models-inspector-close" aria-label="Close model inspector" onClick={onClose}>×</button>
        <div className="models-inspector-title-row">
          <ModelIdentity name={row.name} brandId={row.brandId} />
        </div>
        <div className="models-inspector-identity" aria-label="Model identity details">
          <span><small>Brand</small><strong>{modelBrandText(row)}</strong></span>
          <span><small>Provider</small><strong>{deliveryProviders.length > 0 ? deliveryProviders.map(formatProviderLabel).join(', ') : 'Provider unavailable'}</strong></span>
          <span><small>Source</small><strong>{clientSources.length > 0 ? clientSources.map(formatProviderLabel).join(', ') : 'Source unavailable'}</strong></span>
        </div>
      </div>

      <div className="models-inspector-metrics" aria-label="Model metrics">
        <Metric label="Total cost" value={quality.kind === 'unpriced' ? 'Unavailable' : formatUsd(row.cost)} detail={quality.detail} />
        <Metric label="Total tokens" value={total == null ? 'Unavailable' : formatCompact(total)} detail={row.tokenDetail ? 'Observed metered volume' : 'No durable token split'} />
        <Metric label="Calls" value={fmtInt(row.calls)} />
        <Metric label="Cache×" value={formatReuseMultiple(reuse)} detail="Cache-read per uncached input" />
        <Metric label="ms/1K" value={formatMsPer1K(timing)} detail={timing == null ? 'Active-generation timing unavailable' : `${statusLabel(row.timingCoverage)} timing`} />
        <Metric label="Cost/1M" value={unitCost == null ? 'Unavailable' : formatUsd(unitCost)} detail="Effective observed value" />
      </div>

      <TokenComposition row={row} />

      <ModelActivityChart row={row} history={history} />

      <div className="models-inspector-tabs" role="tablist" aria-label="Model detail views">
        <button type="button" role="tab" aria-selected={tab === 'providers'} onClick={() => setTab('providers')}>Providers / Routes</button>
        <button type="button" role="tab" aria-selected={tab === 'metadata'} onClick={() => setTab('metadata')}>Metadata</button>
      </div>

      {tab === 'providers' ? <section className="models-inspector-section" aria-label="Recorded model deliveries">
        <div className="models-inspector-section-head"><div><h3>Providers / Routes</h3><span>Recorded delivery and collector facts</span></div><strong>{row.deliveryRows.length}</strong></div>
        <div className="models-inspector-evidence" aria-label="Model evidence state">
          <div><span>Pricing</span><strong>{pricingLabel}</strong></div>
          <div><span>Delivery</span><strong>{statusLabel(row.deliveryStatus)}</strong></div>
          <div><span>Timing</span><strong>{statusLabel(row.timingCoverage)}</strong></div>
        </div>
        <div className="models-delivery-list">
          {row.deliveryRows.map((delivery, index) => {
            const deliveryCost = deliveryQuality(delivery)
            const deliveryProvider = delivery.provider ? formatProviderLabel(delivery.provider) : 'Provider unavailable'
            const clientSource = delivery.sourceProviders?.length ? delivery.sourceProviders.map(formatProviderLabel).join(', ') : 'Source unavailable'
            return (
              <div className="models-delivery-item" key={`${delivery.name}-${delivery.provider ?? 'unknown'}-${index}`}>
                <div><strong>{formatLabel(delivery.semanticVariant ?? 'default')}</strong><span>Provider: {deliveryProvider} · Client/source: {clientSource}</span></div>
                <div><strong>{fmtInt(delivery.calls)}</strong><span>{deliveryCost.kind === 'unpriced' ? 'unpriced' : formatUsd(delivery.cost)}</span></div>
              </div>
            )
          })}
        </div>
      </section> : <section className="models-inspector-section models-inspector-provenance" aria-label="Model metadata">
        <div className="models-inspector-section-head"><div><h3>Metadata</h3><span>Exact identifiers retained by Metrora</span></div></div>
        <dl>
          <div><dt>Brand</dt><dd>{modelBrandText(row)}</dd></div>
          <div><dt>Provider</dt><dd>{deliveryProviders.length > 0 ? deliveryProviders.map(formatProviderLabel).join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Source</dt><dd>{clientSources.length > 0 ? clientSources.map(formatProviderLabel).join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Pricing</dt><dd>{pricingLabel}</dd></div>
          <div><dt>Timing</dt><dd>{statusLabel(row.timingCoverage)}</dd></div>
          <div><dt>Display name</dt><dd>{row.name}</dd></div>
          <div><dt>Raw model</dt><dd>{row.rawModels.length > 0 ? row.rawModels.join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Canonical ID</dt><dd>{row.canonicalIdentities.length > 0 ? row.canonicalIdentities.join(', ') : 'Unavailable'}</dd></div>
          <div><dt>Variant</dt><dd>{row.economicVariants.length > 0 ? row.economicVariants.join(', ') : 'Unavailable'}</dd></div>
        </dl>
      </section>}

      <p className="models-inspector-note">Indicators show observed Metrora data only. Unavailable values are not inferred.</p>
    </aside>
  )
}

export function ModelsControlCenter({
  mode = 'model',
  accounting,
  presentation,
  legacyPresentationRow,
  unpricedModels = [],
  history,
  onExitCompare = () => undefined,
}: {
  mode?: 'model' | 'task' | 'compare'
  accounting: ModelAccounting
  presentation: ModelPresentation
  legacyPresentationRow: (row: DurableModelAccountingRow, index: number) => DurableModelPresentationRow
  unpricedModels?: UnpricedModel[]
  history?: MenubarPayload['history']
  onExitCompare?: () => void
}) {
  const [query, setQuery] = useState('')
  const [modelHouseFilter, setModelHouseFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [sort, setSort] = useState<ModelColumnSort>({ key: 'cost', direction: 'desc' })
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

  const modelHouseOptions = useMemo<ModelHouseId[]>(() => [...new Set(rows.flatMap(modelHouseValues))].sort((a, b) => {
    if (a === 'unresolved') return 1
    if (b === 'unresolved') return -1
    return modelHouseLabel(a).localeCompare(modelHouseLabel(b))
  }), [rows])
  const modelHouseStripOptions = useMemo<ProviderFilterOption[]>(() => modelHouseOptions.map(value => ({ id: value, label: modelHouseLabel(value), logoProvider: modelHouseLogoKey(value) })), [modelHouseOptions])
  const sourceOptions = useMemo(() => [...new Set(rows.flatMap(clientSourceValues))].sort((a, b) => a.localeCompare(b)), [rows])
  const filteredRows = useMemo(() => {
    const normalizedQuery = normalize(query)
    const values = rows.filter(row => {
      const deliveryProviders = deliveryProviderValues(row)
      const modelHouses = modelHouseValues(row)
      const clientSources = clientSourceValues(row)
      const haystack = [row.name, ...row.rawModels, ...modelHouses.map(modelHouseLabel), ...deliveryProviders, ...clientSources].map(normalize).join(' ')
      return (!normalizedQuery || haystack.includes(normalizedQuery))
        && (modelHouseFilter === 'all' || modelHouses.includes(modelHouseFilter as ModelHouseId))
        && (sourceFilter === 'all' || clientSources.includes(sourceFilter))
    })
    return sortRows(values, sort)
  }, [modelHouseFilter, query, rows, sort, sourceFilter])

  useEffect(() => {
    if (selectedId && !filteredRows.some(row => row.presentationIdentity === selectedId)) setSelectedId(null)
  }, [filteredRows, selectedId])

  useEffect(() => {
    if (modelHouseFilter !== 'all' && !modelHouseOptions.includes(modelHouseFilter as ModelHouseId)) setModelHouseFilter('all')
  }, [modelHouseFilter, modelHouseOptions])

  const selectedRow = selectedId ? filteredRows.find(row => row.presentationIdentity === selectedId) ?? null : null
  const hasFilters = query.trim().length > 0 || modelHouseFilter !== 'all' || sourceFilter !== 'all'

  const onSortColumn = (key: ModelSortKey) => {
    setSort(current => current.key === key
      ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction: 'desc' })
  }

  if (mode === 'compare') return <ModelsCompareWorkspace rows={rows} onExit={onExitCompare} />

  const clearFilters = () => {
    setQuery('')
    setModelHouseFilter('all')
    setSourceFilter('all')
  }

  return (
    <div className={`models-workspace${selectedRow ? ' has-right-rail' : ''}`}>
      <section className="models-list-pane" aria-label="Models control center">
        {modelHouseStripOptions.length > 0 && <ProviderFilterStrip
          provider={modelHouseFilter}
          providers={modelHouseStripOptions}
          onProviderChange={setModelHouseFilter}
          ariaLabel="Filter models by model brand"
          allLabel="All model brands"
          className="session-provider-filter models-provider-filter"
        />}
        <div className="models-filter-row">
          <label className="models-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>
            <span className="sr-only">Filter models</span>
            <input aria-label="Filter models" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter models, brands, providers, or sources…" />
          </label>
          <SourceFilter value={sourceFilter} options={sourceOptions} onChange={setSourceFilter} />
          {hasFilters ? <button type="button" className="models-clear-filter" onClick={clearFilters}>Clear filters</button> : null}
        </div>

        <div className="models-sort-toolbar">
          <span className="models-sort-hint" role="note">Click a column to sort · click again to reverse</span>
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
                  <th title="Model brand identity and display name">Model</th>
                  <th title="Delivery provider or API route">Provider</th>
                  <th title="Metrora client/source that contributed the usage">Source</th>
                  <ModelSortHeader label="Calls" sortKey="calls" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Input" sortKey="input" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Output" sortKey="output" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Cache R" sortKey="cacheRead" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Cache W" sortKey="cacheWrite" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Cache×" sortKey="cache" sort={sort} title="Cached input read per uncached input token · click to sort, double-click to reverse" onSort={onSortColumn}/>
                  <ModelSortHeader label="Total" sortKey="tokens" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="ms/1K" sortKey="activeMs" sort={sort} title="Active generation milliseconds per 1,000 generated tokens · click to sort, double-click to reverse" onSort={onSortColumn}/>
                  <ModelSortHeader label="Cost" sortKey="cost" sort={sort} onSort={onSortColumn}/>
                  <ModelSortHeader label="Cost/1M" sortKey="unitCost" sort={sort} title="Effective observed cost per one million total tokens · click to sort, double-click to reverse" onSort={onSortColumn}/>
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

      {selectedRow ? <ModelInspector row={selectedRow} unpricedModels={unpricedModels} history={history} onClose={() => setSelectedId(null)} /> : null}
    </div>
  )
}
