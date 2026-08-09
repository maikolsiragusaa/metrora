import { Fragment, useMemo, useState } from 'react'

import { ProviderLogo } from '../components/ProviderLogo'
import { SegTabs } from '../components/SegTabs'
import { formatCompact, formatUsd } from '../lib/format'
import { cacheReuseMultiple, cacheShare, costPerMillionTotal, formatReuseMultiple, totalTokenCount } from '../lib/usageMetrics'
import type { DurableModelAccountingRow, DurableModelPresentationRow, ModelAccounting, ModelPresentation } from '../lib/types'

type ModelSort = 'cost' | 'tokens' | 'calls' | 'cache' | 'speed' | 'activeMs' | 'unitCost'
type DurableModelRow = DurableModelPresentationRow

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
  if (row.reasoningSemantics === 'separate') return formatCompact(row.reasoningTokens ?? 0)
  if (row.reasoningSemantics === 'mixed' && (row.reasoningTokens ?? 0) > 0) {
    return `≥${formatCompact(row.reasoningTokens!)}`
  }
  return '—'
}

function reasoningTitle(row: Pick<DurableModelAccountingRow, 'reasoningSemantics' | 'reasoningTokens'>): string {
  if (row.reasoningSemantics === 'separate') return 'Separately reported reasoning tokens included in Total.'
  if (row.reasoningSemantics === 'aggregate-output') return 'Reasoning is already included in Output; it is not added separately.'
  if (row.reasoningSemantics === 'mixed' && (row.reasoningTokens ?? 0) > 0) {
    return 'At least the shown reasoning tokens were separately observed and included in Total; other delivery reasoning is unavailable or already aggregated.'
  }
  if (row.reasoningSemantics === 'mixed') {
    return 'Some delivery reasoning is unavailable or already aggregated; no separately reported reasoning evidence was retained.'
  }
  return 'Separate reasoning evidence is unavailable; it is not guessed.'
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

export function DurableModelsTable({
  accounting,
  presentation,
  legacyPresentationRow,
}: {
  accounting: ModelAccounting
  presentation: ModelPresentation
  legacyPresentationRow: (row: DurableModelAccountingRow, index: number) => DurableModelPresentationRow
}) {
  const [sort, setSort] = useState<ModelSort>('cost')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const hasSavings = accounting.rows.some(row => row.savingsUSD > 0) || accounting.gap.savingsUSD > 0
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
    return sortDurableRows(values, sort)
  }, [accounting, presentation, sort, legacyPresentationRow])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 0' }}>
        <SegTabs options={MODEL_SORTS} value={sort} onChange={value => setSort(value as ModelSort)} />
      </div>
      <table className="models-table" aria-label="Model usage">
        <colgroup>
          <col style={{ width: 240 }} /><col style={{ width: 72 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} />
          <col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 86 }} />
          <col style={{ width: 116 }} /><col style={{ width: 116 }} /><col style={{ width: 116 }} /><col style={{ width: 94 }} />
          <col style={{ width: 104 }} />{hasSavings ? <col style={{ width: 90 }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th>Model</th>
            <th>Calls</th>
            <th>Reasoning</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache R</th>
            <th>Cache W</th>
            <th title="Cached input read per uncached input token">Cache ×</th>
            <th>Total</th>
            <th title="Observed generated tokens per active second; tool wait is excluded where the collector supplies active timing.">Generated tok/s</th>
            <th title="Active generation milliseconds per 1,000 generated tokens; lower is faster.">Active ms / 1K</th>
            <th>Cost</th>
            <th title="Effective API-equivalent value per 1M safe total tokens">Cost / 1M</th>
            {hasSavings ? <th>Saved</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((model, index) => {
            const total = model.tokenDetail ? tokenTotal(model) : null
            const reuse = modelCacheReuse(model)
            const share = model.tokenDetail ? cacheShare(model.inputTokens, model.cacheReadTokens) : null
            const unitCost = modelUnitCost(model)
            const generatedTps = modelGeneratedTps(model)
            const activeMs = modelMsPer1K(model)
            const providerLabel = model.providers.length > 0
              ? model.providers.join(', ')
              : model.sourceProviders.length > 0 ? model.sourceProviders.join(', ') : undefined
            const reasoning = reasoningDisplay(model)
            const expandable = model.deliveryRows.length > 1 || model.deliveryStatus === 'partial'
            const isExpanded = expanded.has(model.presentationIdentity)
            return (
              <Fragment key={`${model.presentationIdentity}-${index}`}>
                <tr>
                  <td title={providerLabel ? `${model.name} · ${providerLabel}` : model.name}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <ModelIdentity name={model.name} />
                      {providerLabel ? <span style={providerTagStyle}>{providerLabel}</span> : null}
                      {expandable ? <button type="button" className="alias" aria-expanded={isExpanded} onClick={() => setExpanded(current => {
                        const next = new Set(current)
                        if (next.has(model.presentationIdentity)) next.delete(model.presentationIdentity)
                        else next.add(model.presentationIdentity)
                        return next
                      })}>{isExpanded ? 'hide delivery' : `${model.deliveryRows.length} deliveries`}</button> : null}
                    </span>
                  </td>
                  <td>{fmtInt(model.calls)}</td>
                  <td title={reasoningTitle(model)}>{model.tokenDetail ? reasoning : '—'}</td>
                  <td>{model.tokenDetail ? formatCompact(model.inputTokens) : '—'}</td>
                  <td>{model.tokenDetail ? formatCompact(model.outputTokens) : '—'}</td>
                  <td>{model.tokenDetail ? formatCompact(model.cacheReadTokens) : '—'}</td>
                  <td>{model.tokenDetail ? formatCompact(model.cacheWriteTokens) : '—'}</td>
                  <td title={share == null ? undefined : `${Math.round(share * 1000) / 10}% of input served from cache`}>{formatReuseMultiple(reuse)}</td>
                  <td>{total == null ? '—' : formatCompact(total)}</td>
                  <td title={generatedTps == null ? 'No reliable active-generation timing for this delivery.' : `Observed active-generation timing: ${formatCompact(model.activeGeneratedTokens ?? 0)} timed generated tokens from available source sessions; timing coverage is ${model.timingCoverage}.`}>{formatGeneratedTps(generatedTps)}</td>
                  <td title={activeMs == null ? 'No reliable active-generation timing for this delivery.' : 'Inverse of Generated tok/s.'}>{formatMsPer1K(activeMs)}</td>
                  <td>{formatUsd(model.cost)}</td>
                  <td>{unitCost == null ? '—' : formatUsd(unitCost)}</td>
                  {hasSavings ? <td className={model.savingsUSD > 0 ? 'pos' : undefined}>{model.savingsUSD > 0 ? formatUsd(model.savingsUSD) : '—'}</td> : null}
                </tr>
                {isExpanded ? <tr className="model-delivery-row"><td colSpan={hasSavings ? 14 : 13}><DeliveryBreakdown model={model} /></td></tr> : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function DeliveryBreakdown({ model }: { model: DurableModelRow }) {
  return (
    <div className="model-delivery-breakdown" role="region" aria-label={`${model.name} delivery breakdown`}>
      <div className="model-delivery-note">Exact constituent accounting rows. Partial historical delivery detail is shown as unavailable rather than synthesized.</div>
      <table className="model-delivery-table">
        <thead><tr><th>Variant</th><th>API provider / route</th><th>Source tool</th><th>Calls</th><th>Input</th><th>Output</th><th>Reasoning</th><th>Cache R</th><th>Cache W</th><th>Total</th><th>Cost</th><th>Cost / 1M</th><th>Generated tok/s</th><th>Timing coverage</th><th>Pricing</th></tr></thead>
        <tbody>{model.deliveryRows.map((delivery, index) => {
          const semantics = delivery.reasoningSemantics ?? 'unavailable'
          const usage = { ...delivery, reasoningSemantics: semantics }
          const total = delivery.tokenDetail ? totalTokenCount(usage) : null
          const unit = delivery.tokenDetail ? costPerMillionTotal(delivery.cost, usage) : null
          const reasoning = reasoningDisplay({ reasoningSemantics: semantics, reasoningTokens: delivery.reasoningTokens })
          const generated = delivery.activeDurationMs && delivery.activeGeneratedTokens
            ? delivery.activeGeneratedTokens / (delivery.activeDurationMs / 1000)
            : null
          const timingCoverage = delivery.timingCoverage ?? (generated == null ? 'unavailable' : 'observed')
          return <tr key={`${delivery.name}-${delivery.provider ?? 'unknown'}-${index}`}>
            <td>{delivery.semanticVariant ?? 'default'}</td>
            <td>{delivery.provider ?? 'Unavailable'}</td>
            <td>{delivery.sourceProviders?.join(', ') || 'Unavailable'}</td>
            <td>{fmtInt(delivery.calls)}</td>
            <td>{delivery.tokenDetail ? formatCompact(delivery.inputTokens) : '—'}</td>
            <td>{delivery.tokenDetail ? formatCompact(delivery.outputTokens) : '—'}</td>
            <td title={reasoningTitle({ reasoningSemantics: semantics, reasoningTokens: delivery.reasoningTokens })}>{delivery.tokenDetail ? reasoning : '—'}</td>
            <td>{delivery.tokenDetail ? formatCompact(delivery.cacheReadTokens) : '—'}</td>
            <td>{delivery.tokenDetail ? formatCompact(delivery.cacheWriteTokens) : '—'}</td>
            <td>{total == null ? '—' : formatCompact(total)}</td>
            <td>{formatUsd(delivery.cost)}</td>
            <td>{unit == null ? '—' : formatUsd(unit)}</td>
            <td>{generated == null ? '—' : `${generated.toFixed(1)} tok/s`}</td>
            <td>{timingCoverage}</td>
            <td>{deliveryPricingState(delivery)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}
