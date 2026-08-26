import { Fragment, useMemo, useState } from 'react'

import { ProviderLogo } from '../components/ProviderLogo'
import { SegTabs } from '../components/SegTabs'
import { formatCompact, formatUsd } from '../lib/format'
import { cacheReuseMultiple, cacheShare, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow, ModelAccounting, ModelPresentation } from '../lib/types'

type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'speed' | 'activeMs' | 'unitCost'
type DurableModelRow = DurableModelPresentationRow
type UnpricedModel = { model: string; calls: number; tokens: number }
type CostQualityKind = 'settled' | 'estimated' | 'partial' | 'unpriced' | 'unresolved'
type CostQuality = { kind: CostQualityKind; label: string; detail: string }

const MODEL_SORTS = [
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Total tokens' },
  { value: 'calls', label: 'Calls' },
  { value: 'cache', label: 'Cache reuse' },
  { value: 'speed', label: 'Generated tok/s' },
  { value: 'activeMs', label: 'Active ms / 1K' },
  { value: 'unitCost', label: 'Cost / 1M' },
]

export const providerTagStyle = { color: 'var(--mut)', fontSize: 'var(--fs-label)', fontWeight: 450 } as const

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
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

export function ModelIdentity({ name }: { name: string }) {
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
  return totalTokenCount(row)
}

function reasoningDisplay(row: Pick<DurableModelAccountingRow, 'reasoningSemantics' | 'reasoningTokens'>): string {
  if (row.reasoningSemantics === 'unavailable' || row.reasoningTokens === undefined) return '—'
  return formatCompact(row.reasoningTokens)
}

function reasoningTitle(row: Pick<DurableModelAccountingRow, 'reasoningSemantics' | 'reasoningTokens'>): string {
  if (row.reasoningSemantics === 'separate') return 'Observed reasoning evidence; reasoning reported separately is included in Total.'
  if (row.reasoningSemantics === 'aggregate-output') return 'Observed reasoning is already included in Output; it is not added separately to Total.'
  if (row.reasoningSemantics === 'mixed') return 'Observed reasoning may include both output-included and separately additive tokens; only the additive subset is included separately in Total.'
  return 'Observed reasoning evidence is unavailable; it is not guessed.'
}

function modelCacheReuse(row: DurableModelRow): number | null {
  return row.tokenDetail ? cacheReuseMultiple(row.inputTokens, row.cacheReadTokens) : null
}

function modelUnitCost(row: DurableModelRow): number | null {
  return row.tokenDetail ? costPerMillionTotal(row.cost, row) : null
}

function modelGeneratedTps(row: DurableModelRow): number | null {
  const duration = row.activeDurationMs ?? 0
  const tokens = row.activeGeneratedTokens ?? 0
  if (!(duration > 0) || !(tokens > 0)) return null
  return tokens / (duration / 1000)
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

function formatGeneratedTps(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)} tok/s`
}

function deliveryPricingState(delivery: DurableModelAccountingRow): 'settled' | 'estimated' | 'unavailable' {
  if (delivery.costIsEstimated === true || (delivery.estimatedCostUSD ?? 0) > 0) return 'estimated'
  if (delivery.tokenDetail === false && delivery.cost === 0 && delivery.calls > 0) return 'unavailable'
  return 'settled'
}

function normalizedModelReference(value: string): string {
  return value.trim().toLowerCase()
}

function matchesUnpricedModel(model: Pick<DurableModelRow, 'name' | 'rawModels'>, unpricedModels: UnpricedModel[]): boolean {
  const names = new Set([model.name, ...model.rawModels].map(normalizedModelReference))
  return unpricedModels.some(item => names.has(normalizedModelReference(item.model)))
}

function costQualityForModel(model: DurableModelRow, unpricedModels: UnpricedModel[]): CostQuality {
  const deliveryStates = model.deliveryRows.map(deliveryPricingState)
  const hasEstimated = model.pricingState === 'estimated'
    || model.costIsEstimated === true
    || (model.estimatedCostUSD ?? 0) > 0
    || deliveryStates.includes('estimated')
  const hasUnpricedModel = matchesUnpricedModel(model, unpricedModels)
  const hasUnpriced = model.pricingState === 'unavailable'
    || deliveryStates.includes('unavailable')
    || hasUnpricedModel
  const hasMixedDeliveryState = deliveryStates.includes('unavailable')
    && (deliveryStates.includes('estimated') || deliveryStates.includes('settled'))

  if (model.pricingState === 'mixed' || hasMixedDeliveryState || (hasUnpricedModel && model.cost > 0)) {
    return {
      kind: 'partial',
      label: 'partial',
      detail: 'Cost is partial: some model usage is estimated or unpriced.',
    }
  }
  if (hasUnpriced) {
    return {
      kind: 'unpriced',
      label: 'unpriced',
      detail: 'Cost is unavailable because no authoritative pricing evidence was resolved for this model.',
    }
  }
  if (hasEstimated) {
    return {
      kind: 'estimated',
      label: 'est.',
      detail: 'Cost includes usage priced from estimated tokens.',
    }
  }
  return { kind: 'settled', label: '', detail: 'Cost has settled pricing evidence.' }
}

function costQualityForDelivery(delivery: DurableModelAccountingRow, aggregateUnpriced: boolean, deliveryCount: number): CostQuality {
  const state = deliveryPricingState(delivery)
  if (state === 'unavailable') {
    return {
      kind: 'unpriced',
      label: 'unpriced',
      detail: 'Cost is unavailable because no authoritative pricing evidence was resolved for this delivery.',
    }
  }
  if (state === 'estimated') return { kind: 'estimated', label: 'est.', detail: 'Cost includes usage priced from estimated tokens.' }
  if (aggregateUnpriced) {
    if (deliveryCount === 1) {
      return {
        kind: 'unpriced',
        label: 'unpriced',
        detail: 'Cost is unavailable because aggregate model evidence reports unpriced usage for this single delivery.',
      }
    }
    return {
      kind: 'unresolved',
      label: 'unresolved',
      detail: 'Aggregate model evidence reports unpriced usage, but this payload does not identify which delivery or route it belongs to.',
    }
  }
  return { kind: 'settled', label: '', detail: 'Cost has settled pricing evidence.' }
}

function unavailableValue(explanation: string) {
  return <span className="models-unavailable" aria-label={explanation}>—</span>
}

function savedValue(row: Pick<DurableModelAccountingRow, 'savingsUSD'>): number | null {
  return typeof row.savingsUSD === 'number' && Number.isFinite(row.savingsUSD) ? row.savingsUSD : null
}

function SavedCell({ row }: { row: Pick<DurableModelAccountingRow, 'savingsUSD'> }) {
  const value = savedValue(row)
  return (
    <td className={value != null && value > 0 ? 'pos' : undefined}>
      {value == null ? unavailableValue('Saved is unavailable for this model; no savings value was reported.') : formatUsd(value)}
    </td>
  )
}

function CostContents({ cost, quality, subject }: { cost: number; quality: CostQuality; subject: string }) {
  return (
    <span className="models-cost-content" title={quality.kind === 'settled' ? undefined : quality.detail}>
      {quality.kind === 'unpriced'
        ? unavailableValue(`Cost unavailable for ${subject}. ${quality.detail}`)
        : formatUsd(cost)}
      {quality.kind !== 'settled' ? <span className={`models-cost-quality models-cost-quality-${quality.kind}`} aria-label={quality.detail}>{quality.label}</span> : null}
    </span>
  )
}

function modelCostLabel(quality: CostQuality): string {
  if (quality.kind === 'estimated') return 'Estimated'
  if (quality.kind === 'partial') return 'Partial pricing'
  if (quality.kind === 'unpriced') return 'Unpriced'
  if (quality.kind === 'unresolved') return 'Unresolved'
  return 'Settled'
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
    if (sort === 'speed') return compareNullableDescending(modelGeneratedTps(a), modelGeneratedTps(b))
    if (sort === 'activeMs') return compareNullableAscending(modelMsPer1K(a), modelMsPer1K(b))
    if (sort === 'unitCost') return compareNullableDescending(modelUnitCost(a), modelUnitCost(b))
    return (b.cost - a.cost) || (b.calls - a.calls)
  })
}

function coverageText(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable'
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

function hasAccountingGap(accounting: ModelAccounting): boolean {
  return accounting.gap.cost > 0.000001 || accounting.gap.calls > 0 || accounting.gap.savingsUSD > 0.000001
}

function ModelDetailsNotes({ accounting, unpricedModels }: { accounting: ModelAccounting; unpricedModels: UnpricedModel[] }) {
  const tokenCoverage = accounting.tokenCoverage
  const tokenIncomplete = !tokenCoverage || tokenCoverage.cost < 0.999999 || tokenCoverage.calls < 0.999999
  const incomplete = accounting.coverage.cost < 0.999999 || accounting.coverage.calls < 0.999999
  const hasGap = hasAccountingGap(accounting)

  return (
    <div className="models-details-notes">
      <p>These recorded model facts use the existing durable accounting values. Details qualify coverage, pricing, timing, and reconstruction state without recalculating Cost or Saved.</p>
      <dl className="models-details-coverage">
        <div><dt>Accounting coverage</dt><dd>{coverageText(accounting.coverage.calls)} calls · {coverageText(accounting.coverage.cost)} cost</dd></div>
        <div><dt>Token detail coverage</dt><dd>{tokenCoverage ? `${coverageText(tokenCoverage.calls)} calls · ${coverageText(tokenCoverage.cost)} cost` : 'Unavailable'}</dd></div>
      </dl>
      {incomplete || hasGap ? <p>Other models is the retained accounting remainder for usage that cannot be assigned to a named model without guessing.</p> : null}
      {tokenIncomplete ? <p>Rows without a durable token split show unavailable token-derived facts rather than inferred zeros.</p> : null}
      {unpricedModels.length > 0 ? <p>Unpriced model usage is marked in the relevant Cost rows; its reported amount must not be read as settled pricing.</p> : null}
    </div>
  )
}

function modelDeliveryId(model: DurableModelRow, index: number): string {
  const safeIdentity = model.presentationIdentity.replace(/[^a-z0-9_-]+/gi, '-') || 'model'
  return `model-delivery-${index}-${safeIdentity}`
}

export function DurableModelsTable({
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
  const [sort, setSort] = useState<ModelSort>('cost')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const rows = useMemo(() => {
    const values = [...presentation.rows]
    if (hasAccountingGap(accounting)) {
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
    return sortDurableRows(values, sort)
  }, [accounting, presentation, sort, legacyPresentationRow])

  return (
    <>
      <table className="models-primary-table" aria-label="Model usage">
        <caption className="sr-only">Primary model usage summary</caption>
        <colgroup>
          <col style={{ width: 300 }} /><col style={{ width: 88 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Calls</th>
            <th scope="col">Cost</th>
            <th scope="col">Saved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((model, index) => {
            const providerLabel = model.providers.length > 0
              ? model.providers.join(', ')
              : model.sourceProviders.length > 0 ? model.sourceProviders.join(', ') : undefined
            const quality = costQualityForModel(model, unpricedModels)
            return (
              <tr key={`primary-${model.presentationIdentity}-${index}`}>
                <td title={providerLabel ? `${model.name} · ${providerLabel}` : model.name}>
                  <span className="models-primary-model">
                    <ModelIdentity name={model.name} />
                    {providerLabel ? <span style={providerTagStyle}>{providerLabel}</span> : null}
                  </span>
                </td>
                <td>{fmtInt(model.calls)}</td>
                <td className={quality.kind === 'settled' ? undefined : 'models-cost-quality-cell'}>
                  <CostContents cost={model.cost} quality={quality} subject={model.name} />
                </td>
                <SavedCell row={model} />
              </tr>
            )
          })}
        </tbody>
      </table>

      <details
        className="models-details"
        data-testid="models-details"
        onToggle={event => setDetailsOpen(event.currentTarget.open)}
      >
        <summary>Details</summary>
        {detailsOpen ? (
          <div className="models-details-body">
            <ModelDetailsNotes accounting={accounting} unpricedModels={unpricedModels} />
            <div className="models-sort-controls">
              <span>Sort details by</span>
              <SegTabs options={MODEL_SORTS} value={sort} onChange={value => setSort(value as ModelSort)} />
            </div>
            <div className="models-evidence-scroll">
              <table className="models-evidence-table" aria-label="Model usage details">
                <caption className="sr-only">Model usage details: token, cache, timing, pricing, delivery, and savings evidence.</caption>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Reasoning</th>
                    <th scope="col">Input</th>
                    <th scope="col">Output</th>
                    <th scope="col">Cache R</th>
                    <th scope="col">Cache W</th>
                    <th scope="col" title="Cached input read per uncached input token">Cache ×</th>
                    <th scope="col">Total</th>
                    <th scope="col" title="Observed generated tokens per active second; tool wait is excluded where the collector supplies active timing.">Generated tok/s</th>
                    <th scope="col" title="Active generation milliseconds per 1,000 generated tokens; lower is faster.">Active ms / 1K</th>
                    <th scope="col">Cost</th>
                    <th scope="col" title="Effective API-equivalent value per 1M safe total tokens">Cost / 1M</th>
                    <th scope="col">Saved</th>
                    <th scope="col">Timing</th>
                    <th scope="col">Pricing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((model, index) => {
                    const total = model.tokenDetail ? tokenTotal(model) : null
                    const reuse = modelCacheReuse(model)
                    const share = model.tokenDetail ? cacheShare(model.inputTokens, model.cacheReadTokens) : null
                    const quality = costQualityForModel(model, unpricedModels)
                    const unitCost = quality.kind === 'unpriced' ? null : modelUnitCost(model)
                    const generatedTps = modelGeneratedTps(model)
                    const activeMs = modelMsPer1K(model)
                    const providerLabel = model.providers.length > 0
                      ? model.providers.join(', ')
                      : model.sourceProviders.length > 0 ? model.sourceProviders.join(', ') : undefined
                    const expandable = model.deliveryRows.length > 1 || model.deliveryStatus === 'partial'
                    const isExpanded = expanded.has(model.presentationIdentity)
                    const deliveryId = modelDeliveryId(model, index)
                    return (
                      <Fragment key={`${model.presentationIdentity}-${index}`}>
                        <tr>
                          <td title={providerLabel ? `${model.name} · ${providerLabel}` : model.name}>
                            <span className="models-evidence-model">
                              <ModelIdentity name={model.name} />
                              {providerLabel ? <span style={providerTagStyle}>{providerLabel}</span> : null}
                              {expandable ? (
                                <button
                                  type="button"
                                  className="alias models-delivery-toggle"
                                  aria-expanded={isExpanded}
                                  aria-controls={deliveryId}
                                  onClick={() => setExpanded(current => {
                                    const next = new Set(current)
                                    if (next.has(model.presentationIdentity)) next.delete(model.presentationIdentity)
                                    else next.add(model.presentationIdentity)
                                    return next
                                  })}
                                >{isExpanded ? 'hide delivery' : `${model.deliveryRows.length} deliveries`}</button>
                              ) : null}
                            </span>
                          </td>
                          <td>{fmtInt(model.calls)}</td>
                          <td title={reasoningTitle(model)}>{model.tokenDetail && model.reasoningSemantics !== 'unavailable' && model.reasoningTokens !== undefined
                            ? <span aria-label={`${reasoningDisplay(model)}. ${reasoningTitle(model)}`}>{reasoningDisplay(model)}</span>
                            : unavailableValue('Reasoning token evidence is unavailable for this model.')}</td>
                          <td>{model.tokenDetail ? formatCompact(model.inputTokens) : unavailableValue('Input token evidence is unavailable for this model.')}</td>
                          <td>{model.tokenDetail ? formatCompact(model.outputTokens) : unavailableValue('Output token evidence is unavailable for this model.')}</td>
                          <td>{model.tokenDetail ? formatCompact(model.cacheReadTokens) : unavailableValue('Cache-read token evidence is unavailable for this model.')}</td>
                          <td>{model.tokenDetail ? formatCompact(model.cacheWriteTokens) : unavailableValue('Cache-write token evidence is unavailable for this model.')}</td>
                          <td title={share == null ? undefined : `${Math.round(share * 1000) / 10}% of input served from cache`}>{reuse == null
                            ? unavailableValue('Cache reuse is unavailable because no valid input denominator is recorded for this model.')
                            : formatReuseMultiple(reuse)}</td>
                          <td>{total == null ? unavailableValue('Total token evidence is unavailable for this model.') : formatCompact(total)}</td>
                          <td title={generatedTps == null ? 'No reliable active-generation timing for this delivery.' : `Observed active-generation timing: ${formatCompact(model.activeGeneratedTokens ?? 0)} timed generated tokens from available source sessions; timing coverage is ${model.timingCoverage}.`}>{generatedTps == null
                            ? unavailableValue('Generated tok/s is unavailable because reliable active-generation timing is not recorded.')
                            : formatGeneratedTps(generatedTps)}</td>
                          <td title={activeMs == null ? 'No reliable active-generation timing for this delivery.' : 'Inverse of Generated tok/s.'}>{activeMs == null
                            ? unavailableValue('Active ms / 1K is unavailable because reliable active-generation timing is not recorded.')
                            : formatMsPer1K(activeMs)}</td>
                          <td className={quality.kind === 'settled' ? undefined : 'models-cost-quality-cell'}><CostContents cost={model.cost} quality={quality} subject={model.name} /></td>
                          <td>{unitCost == null
                            ? unavailableValue('Cost / 1M is unavailable because a safe token denominator is not recorded.')
                            : formatUsd(unitCost)}</td>
                          <SavedCell row={model} />
                          <td>{model.timingCoverage}</td>
                          <td title={quality.detail}>{modelCostLabel(quality)}</td>
                        </tr>
                        {isExpanded ? <tr className="model-delivery-row"><td colSpan={16}><DeliveryBreakdown id={deliveryId} model={model} unpricedModels={unpricedModels} /></td></tr> : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </details>
    </>
  )
}

function DeliveryBreakdown({ id, model, unpricedModels }: { id: string; model: DurableModelRow; unpricedModels: UnpricedModel[] }) {
  const aggregateUnpriced = matchesUnpricedModel(model, unpricedModels)
  return (
    <div id={id} className="model-delivery-breakdown" role="region" aria-label={`${model.name} delivery breakdown`}>
      <div className="model-delivery-note">Recorded constituent delivery rows. Partial historical delivery detail is shown as unavailable rather than synthesized.</div>
      <table className="model-delivery-table" aria-label={`${model.name} delivery evidence`}>
        <caption className="sr-only">{model.name} delivery evidence</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th><th scope="col">API provider / route</th><th scope="col">Source tool</th><th scope="col">Calls</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Reasoning</th><th scope="col">Cache R</th><th scope="col">Cache W</th><th scope="col">Total</th><th scope="col">Cost</th><th scope="col">Cost / 1M</th><th scope="col">Generated tok/s</th><th scope="col">Timing coverage</th><th scope="col">Pricing</th>
          </tr>
        </thead>
        <tbody>
          {model.deliveryRows.map((delivery, index) => {
            const semantics = delivery.reasoningSemantics ?? 'unavailable'
            const usage = { ...delivery, reasoningSemantics: semantics }
            const total = delivery.tokenDetail ? totalTokenCount(usage) : null
            const quality = costQualityForDelivery(delivery, aggregateUnpriced, model.deliveryRows.length)
            const unit = quality.kind === 'unpriced' || !delivery.tokenDetail ? null : costPerMillionTotal(delivery.cost, usage)
            const reasoning = reasoningDisplay({ reasoningSemantics: semantics, reasoningTokens: delivery.reasoningTokens })
            const generated = delivery.activeDurationMs && delivery.activeGeneratedTokens
              ? delivery.activeGeneratedTokens / (delivery.activeDurationMs / 1000)
              : null
            const timingCoverage = delivery.timingCoverage ?? (generated == null ? 'unavailable' : 'observed')
            return (
              <tr key={`${delivery.name}-${delivery.provider ?? 'unknown'}-${index}`}>
                <td>{delivery.semanticVariant ?? 'default'}</td>
                <td>{delivery.provider ?? 'Unavailable'}</td>
                <td>{delivery.sourceProviders?.join(', ') || 'Unavailable'}</td>
                <td>{fmtInt(delivery.calls)}</td>
                <td>{delivery.tokenDetail ? formatCompact(delivery.inputTokens) : unavailableValue('Input token evidence is unavailable for this delivery.')}</td>
                <td>{delivery.tokenDetail ? formatCompact(delivery.outputTokens) : unavailableValue('Output token evidence is unavailable for this delivery.')}</td>
                <td title={reasoningTitle({ reasoningSemantics: semantics, reasoningTokens: delivery.reasoningTokens })}>{delivery.tokenDetail && semantics !== 'unavailable' && delivery.reasoningTokens !== undefined
                  ? <span aria-label={`${reasoning}. ${reasoningTitle({ reasoningSemantics: semantics, reasoningTokens: delivery.reasoningTokens })}`}>{reasoning}</span>
                  : unavailableValue('Reasoning token evidence is unavailable for this delivery.')}</td>
                <td>{delivery.tokenDetail ? formatCompact(delivery.cacheReadTokens) : unavailableValue('Cache-read token evidence is unavailable for this delivery.')}</td>
                <td>{delivery.tokenDetail ? formatCompact(delivery.cacheWriteTokens) : unavailableValue('Cache-write token evidence is unavailable for this delivery.')}</td>
                <td>{total == null ? unavailableValue('Total token evidence is unavailable for this delivery.') : formatCompact(total)}</td>
                <td className={quality.kind === 'settled' ? undefined : 'models-cost-quality-cell'}><CostContents cost={delivery.cost} quality={quality} subject={`${model.name} delivery`} /></td>
                <td>{unit == null
                  ? unavailableValue('Cost / 1M is unavailable because a safe token denominator is not recorded for this delivery.')
                  : formatUsd(unit)}</td>
                <td>{generated == null ? unavailableValue('Generated tok/s is unavailable because reliable active-generation timing is not recorded for this delivery.') : `${generated.toFixed(1)} tok/s`}</td>
                <td>{timingCoverage}</td>
                <td title={quality.detail}>{modelCostLabel(quality)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
