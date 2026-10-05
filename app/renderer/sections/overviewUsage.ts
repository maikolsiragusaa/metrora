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

type CounterEvidence = 'complete' | 'partial' | 'unavailable'

/**
 * Whether the payload carries any known primary-counter counts: evidenced
 * detail rows, or positive counters (which can only come from records that
 * reported numbers). Distinguishes mixed sets (complete records alongside
 * unevidenced ones — keep the known values) from genuinely empty evidence
 * (nothing known — never render aggregates as zeros).
 */
function hasKnownTokenCounts(current: MenubarPayload['current']): boolean {
  if (current.modelAccounting?.rows.some(row => row.tokenDetail)) return true
  return current.inputTokens > 0 || current.outputTokens > 0 || current.cacheReadTokens > 0 || current.cacheWriteTokens > 0
}

/**
 * Display reading of the primary-counter evidence class. Mirrors the web
 * token chip: incompleteness accompanies the values, it never blanks known
 * counts, and "no evidence reported" is claimed only when nothing is known.
 */
function counterDisplay(
  evidence: OverviewCurrent['usageEvidence'],
  hasKnown: boolean,
): { state: OverviewEvidenceState; note: CounterEvidence } {
  if (!evidence || evidence === 'complete') return { state: 'available', note: 'complete' }
  if (evidence === 'partial' || hasKnown) return { state: 'partial', note: 'partial' }
  return { state: 'unavailable', note: 'unavailable' }
}

const PARTIAL_COUNTER_NOTE = 'Incomplete token data: primary input/output counters are partially reported for this scope.'
const NO_COUNTER_EVIDENCE_NOTE = 'Incomplete token data: no primary input/output evidence was reported for this scope.'

function rankEvidenceState(state: OverviewEvidenceState): number {
  return state === 'available' ? 0 : state === 'partial' ? 1 : 2
}

function projectTokenUsage(current: OverviewCurrent): OverviewUsageDetails | null {
  const coverage = current.projectDetailCoverage?.tokens
  if (!coverage) return null

  const reasoning = reasoningFromAccounting(current)
  const coverageState: OverviewEvidenceState =
    coverage === 'complete' ? 'available' : coverage === 'partial' ? 'partial' : 'unavailable'
  // The displayed totals ARE the primary counters: counter evidence can only
  // downgrade what project detail coverage claims, never upgrade it. A
  // complete detail claim next to partial counters still renders partial.
  const counter = counterDisplay(current.usageEvidence, hasKnownTokenCounts(current))
  const state: OverviewEvidenceState =
    coverageState === 'unavailable' || counter.state === 'unavailable'
      ? 'unavailable'
      : coverageState === 'partial' || counter.state === 'partial'
        ? 'partial'
        : 'available'
  const value = (reported: number): number | null => (state === 'unavailable' ? null : reported)
  // The note follows the binding (worse) constraint; ties keep the
  // project-scoped wording.
  const counterBinds = rankEvidenceState(counter.state) > rankEvidenceState(coverageState)
  const evidenceNote = counterBinds
    ? counter.note === 'partial' ? PARTIAL_COUNTER_NOTE : NO_COUNTER_EVIDENCE_NOTE
    : coverage === 'complete'
      ? 'Period token totals are complete for this Project scope; model identity detail is tracked separately.'
      : coverage === 'partial'
        ? 'Period token totals remain factual for this Project scope, but the supporting detail is partial.'
        : 'Token totals are unavailable for this Project scope; missing values are not shown as zero.'
  return {
    input: tokenMetric(value(current.inputTokens), state),
    output: tokenMetric(value(current.outputTokens), state),
    cacheRead: tokenMetric(value(current.cacheReadTokens), state),
    cacheWrite: tokenMetric(value(current.cacheWriteTokens), state),
    reasoning,
    evidenceNote,
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

  const reasoning = reasoningFromAccounting(overviewCurrent)
  const evidence = overviewCurrent.usageEvidence

  // When the payload carries primary-counter evidence (e.g. DSH), it is the
  // authority for input/output — the same signal the web dashboard chip
  // reads. A reported zero is complete evidence, never a gap. Mixed sets
  // (complete records alongside unevidenced ones) keep their known counts
  // with the incompleteness attached; only a genuinely evidence-free scope
  // renders as unavailable.
  if (evidence) {
    const counter = counterDisplay(evidence, hasKnownTokenCounts(overviewCurrent))
    const value = (reported: number): number | null => (counter.state === 'unavailable' ? null : reported)
    return {
      input: tokenMetric(value(overviewCurrent.inputTokens), counter.state),
      output: tokenMetric(value(overviewCurrent.outputTokens), counter.state),
      cacheRead: tokenMetric(value(overviewCurrent.cacheReadTokens), counter.state),
      cacheWrite: tokenMetric(value(overviewCurrent.cacheWriteTokens), counter.state),
      reasoning,
      evidenceNote: counter.note === 'complete'
        ? 'Usage totals are complete for this scope.'
        : counter.note === 'partial'
          ? PARTIAL_COUNTER_NOTE
          : NO_COUNTER_EVIDENCE_NOTE,
    }
  }

  const values = [overviewCurrent.inputTokens, overviewCurrent.outputTokens, overviewCurrent.cacheReadTokens, overviewCurrent.cacheWriteTokens]
  const hasAccountingTokenEvidence = overviewCurrent.modelAccounting?.rows.some(row => row.tokenDetail) ?? false
  const hasLegacyEvidence = overviewCurrent.calls === 0 || values.some(value => value > 0) || hasAccountingTokenEvidence
  if (!hasLegacyEvidence) {
    return unavailableUsage('This payload does not include token-level evidence for the selected scope.')
  }

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
