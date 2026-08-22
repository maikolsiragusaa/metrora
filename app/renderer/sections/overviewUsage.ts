import type { DurableModelAccountingRow, MenubarPayload, ReasoningTokenSemantics } from '../lib/types'

export type OverviewEvidenceState = 'available' | 'partial' | 'unavailable'

export type OverviewTokenMetric = {
  value: number | null
  state: OverviewEvidenceState
}

export type OverviewReasoning = {
  observedTokens: number | null
  semantics: ReasoningTokenSemantics
  state: OverviewEvidenceState
}

export type OverviewUsageDetails = {
  input: OverviewTokenMetric
  output: OverviewTokenMetric
  cacheRead: OverviewTokenMetric
  cacheWrite: OverviewTokenMetric
  reasoning: OverviewReasoning
  evidenceNote: string
}

export type OverviewPricingDetails = {
  label: string
  detail: string
  state: 'complete' | 'partial' | 'unavailable' | 'estimated'
}

const EMPTY_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

function tokenMetric(value: number | null, state: OverviewEvidenceState): OverviewTokenMetric {
  return { value, state }
}

function sumTokenRows(rows: DurableModelAccountingRow[]) {
  return rows.reduce((totals, row) => ({
    inputTokens: totals.inputTokens + row.inputTokens,
    outputTokens: totals.outputTokens + row.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + row.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens + row.cacheWriteTokens,
  }), { ...EMPTY_TOKENS })
}

function combineReasoningSemantics(rows: DurableModelAccountingRow[]): ReasoningTokenSemantics {
  const semantics = rows.map(row => row.reasoningSemantics ?? 'unavailable')
  if (semantics.length === 0 || semantics.every(value => value === 'unavailable')) return 'unavailable'
  const first = semantics[0]
  return semantics.every(value => value === first) ? first : 'mixed'
}

function reasoningForRows(rows: DurableModelAccountingRow[], state: OverviewEvidenceState): OverviewReasoning {
  const semantics = combineReasoningSemantics(rows)
  if (semantics === 'unavailable') {
    return { observedTokens: null, semantics, state: 'unavailable' }
  }

  const observedTokens = rows.reduce((total, row) => {
    if ((row.reasoningSemantics ?? 'unavailable') === 'unavailable') return total
    return total + (row.reasoningTokens ?? 0)
  }, 0)

  return {
    observedTokens,
    semantics,
    state: semantics === 'mixed' || state === 'partial' ? 'partial' : 'available',
  }
}

function fromTokenRows(current: MenubarPayload['current']): OverviewUsageDetails | null {
  const accounting = current.modelAccounting
  if (!accounting) return null

  const detailedRows = accounting.rows.filter(row => row.tokenDetail)
  if (detailedRows.length === 0) {
    // A genuinely empty scope can truthfully show explicit zeros. A non-empty
    // scope without token-detail rows must remain unavailable instead.
    if (current.calls === 0 && accounting.gap.calls === 0 && accounting.gap.cost <= 0.000001) {
      return {
        input: tokenMetric(0, 'available'),
        output: tokenMetric(0, 'available'),
        cacheRead: tokenMetric(0, 'available'),
        cacheWrite: tokenMetric(0, 'available'),
        reasoning: { observedTokens: null, semantics: 'unavailable', state: 'unavailable' },
        evidenceNote: 'No usage was recorded for this scope.',
      }
    }
    return unavailableUsage('Token-level evidence is unavailable for this scope, so missing values are not shown as zero.')
  }

  const totals = sumTokenRows(detailedRows)
  const complete = accounting.rows.length > 0
    && accounting.rows.every(row => row.tokenDetail)
    && accounting.gap.calls === 0
    && accounting.gap.cost <= 0.000001
  const state: OverviewEvidenceState = complete ? 'available' : 'partial'
  const evidenceNote = complete
    ? 'Usage totals are reported for the selected scope.'
    : 'Some usage does not include token-level detail; this breakdown is partial.'

  return {
    input: tokenMetric(totals.inputTokens, state),
    output: tokenMetric(totals.outputTokens, state),
    cacheRead: tokenMetric(totals.cacheReadTokens, state),
    cacheWrite: tokenMetric(totals.cacheWriteTokens, state),
    reasoning: reasoningForRows(detailedRows, state),
    evidenceNote,
  }
}

function unavailableUsage(evidenceNote: string): OverviewUsageDetails {
  return {
    input: tokenMetric(null, 'unavailable'),
    output: tokenMetric(null, 'unavailable'),
    cacheRead: tokenMetric(null, 'unavailable'),
    cacheWrite: tokenMetric(null, 'unavailable'),
    reasoning: { observedTokens: null, semantics: 'unavailable', state: 'unavailable' },
    evidenceNote,
  }
}

/**
 * Derives Overview-only display facts. It does not aggregate accounting data
 * for any other surface and never turns an absent token field into zero.
 */
export function deriveOverviewUsage(current: MenubarPayload['current']): OverviewUsageDetails {
  const fromRows = fromTokenRows(current)
  if (fromRows) return fromRows

  const values = [current.inputTokens, current.outputTokens, current.cacheReadTokens, current.cacheWriteTokens]
  const hasLegacyEvidence = current.calls === 0 || values.some(value => value > 0)
  if (!hasLegacyEvidence) {
    return unavailableUsage('This payload does not include token-level evidence for the selected scope.')
  }

  return {
    input: tokenMetric(current.inputTokens, 'available'),
    output: tokenMetric(current.outputTokens, 'available'),
    cacheRead: tokenMetric(current.cacheReadTokens, 'available'),
    cacheWrite: tokenMetric(current.cacheWriteTokens, 'available'),
    reasoning: { observedTokens: null, semantics: 'unavailable', state: 'unavailable' },
    evidenceNote: 'Usage totals are reported by this Overview payload; reasoning detail is unavailable here.',
  }
}

/**
 * Keeps pricing coverage language factual and intentionally separate from the
 * cost calculation. Historical price records and route-level provenance are
 * not part of the Overview payload, so this is not a "Why this cost?" answer.
 */
export function deriveOverviewPricing(current: MenubarPayload['current']): OverviewPricingDetails {
  const coverage = current.pricingCoverage
  const estimatedCostUSD = (current as MenubarPayload['current'] & { estimatedCostUSD?: number }).estimatedCostUSD ?? 0
  const hasEstimatedRows = current.modelAccounting?.rows.some(row => row.costIsEstimated === true || (row.estimatedCostUSD ?? 0) > 0) ?? false
  const hasUnpricedModels = (current.unpricedModels?.length ?? 0) > 0

  if (typeof coverage !== 'number') {
    return {
      label: hasEstimatedRows || estimatedCostUSD > 0 ? 'Coverage unavailable · some estimated' : 'Coverage unavailable',
      detail: hasEstimatedRows || estimatedCostUSD > 0
        ? 'Pricing coverage is not reported, and part of the cost uses estimated usage.'
        : 'This payload does not report pricing coverage, so cost completeness is not asserted.',
      state: hasEstimatedRows || estimatedCostUSD > 0 ? 'estimated' : 'unavailable',
    }
  }

  if (coverage < 1 || hasUnpricedModels) {
    const percent = Math.max(0, Math.min(99, Math.round(coverage * 100)))
    return {
      label: `${percent}% priced`,
      detail: 'Some usage could not be priced; cost is partially calculated.',
      state: 'partial',
    }
  }

  if (estimatedCostUSD > 0 || hasEstimatedRows) {
    return {
      label: 'Fully priced · some estimated',
      detail: 'Pricing is present, but part of the cost uses estimated usage.',
      state: 'estimated',
    }
  }

  return {
    label: 'Fully priced',
    detail: 'All cost-bearing usage in this scope resolved a price.',
    state: 'complete',
  }
}
