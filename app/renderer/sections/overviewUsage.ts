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

export type OverviewCurrent = MenubarPayload['current'] & {
  estimatedCostUSD?: number
  projectDetailCoverage?: {
    models: 'complete' | 'partial' | 'unavailable'
    tokens: 'complete' | 'partial' | 'unavailable'
    categories: 'complete' | 'partial' | 'unavailable'
    historical: boolean
  }
}

export function asOverviewCurrent(current: MenubarPayload['current']): OverviewCurrent {
  return current as OverviewCurrent
}

function tokenMetric(value: number | null, state: OverviewEvidenceState): OverviewTokenMetric {
  return { value, state }
}

function combineReasoningSemantics(rows: DurableModelAccountingRow[]): ReasoningTokenSemantics {
  const semantics = rows.map(row => row.reasoningSemantics ?? 'unavailable')
  if (semantics.length === 0 || semantics.every(value => value === 'unavailable')) return 'unavailable'
  const first = semantics[0]
  return semantics.every(value => value === first) ? first : 'mixed'
}

function reasoningForRows(rows: DurableModelAccountingRow[]): OverviewReasoning {
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
    state: semantics === 'mixed' ? 'partial' : 'available',
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

function reasoningFromAccounting(current: MenubarPayload['current']): OverviewReasoning {
  const detailedRows = current.modelAccounting?.rows.filter(row => row.tokenDetail) ?? []
  return reasoningForRows(detailedRows)
}

function projectTokenUsage(current: OverviewCurrent): OverviewUsageDetails | null {
  const coverage = current.projectDetailCoverage?.tokens
  if (!coverage) return null

  const reasoning = reasoningFromAccounting(current)
  if (coverage === 'unavailable') {
    return {
      ...unavailableUsage('Token totals are unavailable for this Project scope; missing values are not shown as zero.'),
      reasoning,
    }
  }

  const state: OverviewEvidenceState = coverage === 'complete' ? 'available' : 'partial'
  return {
    input: tokenMetric(current.inputTokens, state),
    output: tokenMetric(current.outputTokens, state),
    cacheRead: tokenMetric(current.cacheReadTokens, state),
    cacheWrite: tokenMetric(current.cacheWriteTokens, state),
    reasoning,
    evidenceNote: coverage === 'complete'
      ? 'Period token totals are complete for this Project scope; model identity detail is tracked separately.'
      : 'Period token totals remain factual for this Project scope, but the supporting detail is partial.',
  }
}

/**
 * Derives Overview-only display facts. It does not aggregate accounting data
 * for any other surface and never turns an absent token field into zero.
 */
export function deriveOverviewUsage(current: MenubarPayload['current']): OverviewUsageDetails {
  const overviewCurrent = asOverviewCurrent(current)
  const projectUsage = projectTokenUsage(overviewCurrent)
  if (projectUsage) return projectUsage

  const values = [overviewCurrent.inputTokens, overviewCurrent.outputTokens, overviewCurrent.cacheReadTokens, overviewCurrent.cacheWriteTokens]
  const hasAccountingTokenEvidence = overviewCurrent.modelAccounting?.rows.some(row => row.tokenDetail) ?? false
  const hasLegacyEvidence = overviewCurrent.calls === 0 || values.some(value => value > 0) || hasAccountingTokenEvidence
  if (!hasLegacyEvidence) {
    return unavailableUsage('This payload does not include token-level evidence for the selected scope.')
  }

  const reasoning = reasoningFromAccounting(overviewCurrent)
  return {
    input: tokenMetric(overviewCurrent.inputTokens, 'available'),
    output: tokenMetric(overviewCurrent.outputTokens, 'available'),
    cacheRead: tokenMetric(overviewCurrent.cacheReadTokens, 'available'),
    cacheWrite: tokenMetric(overviewCurrent.cacheWriteTokens, 'available'),
    reasoning,
    evidenceNote: reasoning.state === 'unavailable'
      ? 'Usage totals are reported by this Overview payload; reasoning detail is unavailable here.'
      : 'Usage totals are reported by this Overview payload; reasoning detail comes from model accounting evidence.',
  }
}

/**
 * Keeps pricing coverage language factual and intentionally separate from the
 * cost calculation. Historical price records and route-level provenance are
 * not part of the Overview payload, so this is not a "Why this cost?" answer.
 */
export function deriveOverviewPricing(current: MenubarPayload['current']): OverviewPricingDetails {
  const overviewCurrent = asOverviewCurrent(current)
  const coverage = overviewCurrent.pricingCoverage
  const estimatedCostUSD = overviewCurrent.estimatedCostUSD ?? 0
  const hasEstimatedRows = overviewCurrent.modelAccounting?.rows.some(row => row.costIsEstimated === true || (row.estimatedCostUSD ?? 0) > 0) ?? false
  const hasUnpricedModels = (overviewCurrent.unpricedModels?.length ?? 0) > 0

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
