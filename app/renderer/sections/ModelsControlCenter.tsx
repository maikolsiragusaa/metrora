import { useEffect, useMemo, useState } from 'react'

import { Dropdown } from '../components/Dropdown'
import { EmptyNote } from '../components/EmptyState'
import { ProviderFilterStrip, type ProviderFilterOption } from '../components/ProviderFilterStrip'
import { ProviderLogo } from '../components/ProviderLogo'
import { formatCompact, formatDayShort, formatUsd } from '../lib/format'
import { modelHouseLabel, modelHouseLogoKey, modelHouseValues, type ModelHouseId } from '../lib/modelPresentation'
import { formatProviderLabel, providerLogoKey } from '../lib/providerPresentation'
import { additiveReasoningTokenCount, formatReuseMultiple } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow, MenubarPayload, ModelAccounting, ModelPresentation } from '../lib/types'
import {
  clientSourceValues,
  costQuality,
  deliveryProviderValues,
  deliveryQuality,
  fmtInt,
  formatMsPer1K,
  modelCacheReuse,
  modelMsPer1K,
  modelTotal,
  modelUnitCost,
  normalize,
  sortRows,
  type DurableModelRow,
  type ModelColumnSort,
  type ModelSortKey,
  type UnpricedModel,
  ModelsByModelTable,
} from './ModelsByModelTable'
import { ModelIdentity } from './ModelsDurableTable'
import { ModelsCompareWorkspace } from './ModelsSidePanels'

function formatLabel(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function modelBrandValues(row: DurableModelRow): Exclude<ModelHouseId, 'unresolved'>[] {
  return modelHouseValues(row).filter((value): value is Exclude<ModelHouseId, 'unresolved'> => value !== 'unresolved')
}

function modelBrandText(row: DurableModelRow): string {
  const values = modelBrandValues(row)
  return values.length > 0 ? values.map(modelHouseLabel).join(', ') : 'Unavailable'
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
          <ModelsByModelTable
            rows={filteredRows}
            sort={sort}
            selectedId={selectedId}
            unpricedModels={unpricedModels}
            onSort={onSortColumn}
            onSelect={setSelectedId}
          />
        )}
        <div className="models-bounded-note">{filteredRows.length.toLocaleString('en-US')} rows shown from canonical model accounting · unavailable facts remain explicit</div>
      </section>

      {selectedRow ? <ModelInspector row={selectedRow} unpricedModels={unpricedModels} history={history} onClose={() => setSelectedId(null)} /> : null}
    </div>
  )
}
