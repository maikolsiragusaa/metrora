import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatUsd } from '../lib/format'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { cacheReuseMultiple, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow } from '../lib/types'
import { ModelIdentity } from './ModelsDurableTable'

export type DurableModelRow = DurableModelPresentationRow
export type UnpricedModel = { model: string; calls: number; tokens: number }
type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'activeMs' | 'unitCost'
export type ModelSortKey = ModelSort | 'input' | 'output' | 'cacheRead' | 'cacheWrite'
type ModelSortDirection = 'desc' | 'asc'
export type ModelColumnSort = { key: ModelSortKey; direction: ModelSortDirection }
type CostQualityKind = 'settled' | 'estimated' | 'partial' | 'unpriced' | 'unresolved'
export type CostQuality = { kind: CostQualityKind; label: string; detail: string }

export function fmtInt(value: number): string {
  return value.toLocaleString('en-US')
}

export function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/** Delivery/API providers; never use this for the model-house strip. */
export function deliveryProviderValues(row: DurableModelRow): string[] {
  if (row.providers.length > 0) return row.providers
  return row.provider ? [row.provider] : []
}

/** Metrora clients/sources that contributed the observed row. */
export function clientSourceValues(row: DurableModelRow): string[] {
  return row.sourceProviders.filter(value => value.trim().length > 0)
}

function compactIdentity(values: string[], emptyLabel = 'Unavailable'): { label: string; title: string } {
  const labels = values.map(formatProviderLabel)
  if (labels.length === 0) return { label: emptyLabel, title: emptyLabel }
  return {
    label: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0]!,
    title: labels.join(', '),
  }
}

export function modelTotal(row: DurableModelRow): number | null {
  return row.tokenDetail ? totalTokenCount(row) : null
}

export function modelCacheReuse(row: DurableModelRow): number | null {
  return row.tokenDetail ? cacheReuseMultiple(row.inputTokens, row.cacheReadTokens) : null
}

export function modelUnitCost(row: DurableModelRow): number | null {
  return row.tokenDetail ? costPerMillionTotal(row.cost, row) : null
}

export function modelMsPer1K(row: DurableModelRow): number | null {
  const duration = row.activeDurationMs ?? 0
  const generated = row.activeGeneratedTokens ?? 0
  if (!(duration > 0) || !(generated > 0)) return null
  return duration * 1000 / generated
}

export function formatMsPer1K(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}ms`
}

/**
 * Direction is always numeric (desc = larger values first) so the header arrow
 * and aria-sort stay truthful. Unavailable (null) metrics sort last in both
 * directions; the original row index breaks ties for stability.
 */
export function sortRows(rows: DurableModelRow[], sort: ModelColumnSort): DurableModelRow[] {
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

export function costQuality(row: DurableModelRow, unpricedModels: UnpricedModel[]): CostQuality {
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

export function deliveryQuality(delivery: DurableModelAccountingRow): CostQuality {
  const state = deliveryPricingState(delivery)
  if (state === 'unavailable') return { kind: 'unpriced', label: 'unpriced', detail: 'No authoritative pricing evidence was resolved for this delivery.' }
  if (state === 'estimated') return { kind: 'estimated', label: 'est.', detail: 'Cost includes usage priced from estimated tokens.' }
  return { kind: 'settled', label: '', detail: 'Cost has settled pricing evidence.' }
}

function unavailableValue(explanation: string) {
  return <span className="models-unavailable" aria-label={explanation}>—</span>
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

export function ModelsByModelTable({
  rows,
  sort,
  selectedId,
  unpricedModels,
  onSort,
  onSelect,
}: {
  rows: DurableModelRow[]
  sort: ModelColumnSort
  selectedId: string | null
  unpricedModels: UnpricedModel[]
  onSort: (key: ModelSortKey) => void
  onSelect: (id: string) => void
}) {
  return (
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
            <ModelSortHeader label="Calls" sortKey="calls" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Input" sortKey="input" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Output" sortKey="output" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Cache R" sortKey="cacheRead" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Cache W" sortKey="cacheWrite" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Cache×" sortKey="cache" sort={sort} title="Cached input read per uncached input token · click to sort, double-click to reverse" onSort={onSort}/>
            <ModelSortHeader label="Total" sortKey="tokens" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="ms/1K" sortKey="activeMs" sort={sort} title="Active generation milliseconds per 1,000 generated tokens · click to sort, double-click to reverse" onSort={onSort}/>
            <ModelSortHeader label="Cost" sortKey="cost" sort={sort} onSort={onSort}/>
            <ModelSortHeader label="Cost/1M" sortKey="unitCost" sort={sort} title="Effective observed cost per one million total tokens · click to sort, double-click to reverse" onSort={onSort}/>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <ModelTableRow key={row.presentationIdentity} row={row} selected={selectedId === row.presentationIdentity} unpricedModels={unpricedModels} onSelect={() => onSelect(row.presentationIdentity)} />)}
        </tbody>
      </table>
    </div>
  )
}
