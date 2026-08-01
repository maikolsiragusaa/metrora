import type { ModelCosts } from '../../models.js'
import { calculateCost, getModelCosts } from '../../models.js'
import {
  CostAssignmentV1Schema,
  costAssignmentMatchesUsdV1,
  type CostAssignmentV1,
} from '../../pricing/cost-assignment.js'
import type { ParsedApiCall } from '../../types.js'
import {
  collectorProvenanceProfileForCall,
  type CollectorProvenanceProfileV1,
  type FactProvenanceV1,
  type IdentityProvenanceV1,
} from './collector-provenance.js'
import type {
  MeasurementCostEvidenceV1,
} from './measurement-adapter.js'
import type { UsageMeasurementDataV1 } from './measurement.js'

export type MeasurementEvidenceResolutionV1 = {
  profile: CollectorProvenanceProfileV1
  quality: UsageMeasurementDataV1['quality']
  costEvidence: MeasurementCostEvidenceV1
}

export type MeasurementCostEvidenceModeV1 = 'current-compatible' | 'immutable-assignment'

export type MeasurementEvidenceResolutionOptionsV1 = {
  sessionId?: string
  pricingLookup?: (model: string) => ModelCosts | null
  costCalculator?: typeof calculateCost
  /**
   * `current-compatible` preserves the pre-history factory behavior for callers
   * that have not crossed the runtime settlement boundary yet.
   * `immutable-assignment` never consults mutable current pricing when a call
   * lacks a CostAssignmentV1; usage remains publishable with unavailable cost.
   */
  costEvidenceMode?: MeasurementCostEvidenceModeV1
}

type TokenFact = {
  value: number
  provenance: FactProvenanceV1
}

function assertNormalizedCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

function activeTokenFacts(
  call: ParsedApiCall,
  profile: CollectorProvenanceProfileV1,
): TokenFact[] {
  const facts: TokenFact[] = [
    { value: call.usage.inputTokens, provenance: profile.facts.tokens.input },
    { value: call.usage.outputTokens, provenance: profile.facts.tokens.output },
    { value: call.usage.cacheReadInputTokens, provenance: profile.facts.tokens.cacheRead },
    { value: call.usage.cacheCreationInputTokens, provenance: profile.facts.tokens.cacheWrite },
    { value: call.usage.reasoningTokens, provenance: profile.facts.tokens.reasoning },
  ]

  for (const [index, fact] of facts.entries()) {
    assertNormalizedCount(fact.value, [
      'inputTokens',
      'outputTokens',
      'cacheReadInputTokens',
      'cacheCreationInputTokens',
      'reasoningTokens',
    ][index]!)
  }
  assertNormalizedCount(call.usage.webSearchRequests, 'webSearchRequests')

  return facts.filter(fact => fact.value > 0)
}

function rollUpTokenQuality(facts: TokenFact[]): UsageMeasurementDataV1['quality']['tokenCounts'] {
  if (facts.length === 0) return 'unknown'
  if (facts.some(fact => fact.provenance === 'unknown')) return 'unknown'
  if (facts.some(fact => fact.provenance === 'estimated')) return 'estimated'
  if (facts.some(fact => fact.provenance === 'derived')) return 'derived'
  return 'measured'
}

function rollUpModelIdentity(
  provenance: IdentityProvenanceV1,
): UsageMeasurementDataV1['quality']['modelIdentity'] {
  if (provenance === 'exact') return 'exact'
  if (provenance === 'normalized') return 'normalized'
  return 'unknown'
}

function rollUpSessionIdentity(
  provenance: IdentityProvenanceV1,
  sessionId: string | undefined,
): UsageMeasurementDataV1['quality']['sessionIdentity'] {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return 'unknown'
  if (provenance === 'exact') return 'exact'
  if (provenance === 'normalized' || provenance === 'derived') return 'derived'
  return 'unknown'
}

function reasoningAttributionIsAllowed(
  call: ParsedApiCall,
  profile: CollectorProvenanceProfileV1,
): boolean {
  if (call.reasoningLevel === undefined && call.reasoningLevelSource === undefined) {
    return profile.facts.reasoningAttribution.includes('unknown')
  }
  if (call.reasoningLevel === undefined || call.reasoningLevelSource === undefined) return false
  return profile.facts.reasoningAttribution.includes(call.reasoningLevelSource)
}

function positiveUsageHasPricingCoverage(call: ParsedApiCall, costs: ModelCosts): boolean {
  const outputAndReasoning = call.usage.outputTokens + call.usage.reasoningTokens
  if (!Number.isSafeInteger(outputAndReasoning)) return false

  let sawBillableFact = false
  const requireRate = (value: number, rate: number): boolean => {
    if (value <= 0) return true
    sawBillableFact = true
    return Number.isFinite(rate) && rate > 0
  }

  const covered =
    requireRate(call.usage.inputTokens, costs.inputCostPerToken) &&
    requireRate(outputAndReasoning, costs.outputCostPerToken) &&
    requireRate(call.usage.cacheCreationInputTokens, costs.cacheWriteCostPerToken) &&
    requireRate(call.usage.cacheReadInputTokens, costs.cacheReadCostPerToken)

  return covered && sawBillableFact
}

function locallyCalculatedCostMatches(
  call: ParsedApiCall,
  calculator: typeof calculateCost,
): boolean {
  const outputAndReasoning = call.usage.outputTokens + call.usage.reasoningTokens
  if (!Number.isSafeInteger(outputAndReasoning)) return false

  const expected = calculator(
    call.model,
    call.usage.inputTokens,
    outputAndReasoning,
    call.usage.cacheCreationInputTokens,
    call.usage.cacheReadInputTokens,
    call.usage.webSearchRequests,
    call.speed,
    call.cacheCreationOneHourTokens ?? 0,
  )

  if (!Number.isFinite(expected) || !Number.isFinite(call.costUSD) || expected < 0 || call.costUSD < 0) {
    return false
  }

  // The public contract stores micro-USD integers. Compare at that exact wire
  // precision so harmless binary floating-point tails do not create drift.
  const expectedMicros = Math.round(expected * 1_000_000)
  const actualMicros = Math.round(call.costUSD * 1_000_000)
  if (!Number.isSafeInteger(expectedMicros) || !Number.isSafeInteger(actualMicros)) return false
  return expectedMicros === actualMicros
}

function assignmentCostEvidence(
  call: ParsedApiCall,
  assignmentValue: CostAssignmentV1 | unknown,
): MeasurementCostEvidenceV1 {
  const parsed = CostAssignmentV1Schema.safeParse(assignmentValue)
  if (!parsed.success) return { kind: 'unavailable' }
  const assignment = parsed.data
  if (assignment.kind === 'unavailable') return { kind: 'unavailable' }
  if (!costAssignmentMatchesUsdV1(assignment, call.costUSD)) return { kind: 'unavailable' }

  if (assignment.kind === 'metered') {
    return { kind: 'metered', source: assignment.source }
  }
  if (assignment.kind === 'token-price') {
    return { kind: 'estimated', method: 'token-pricing' }
  }
  if (assignment.kind === 'explicit-zero') {
    // Measurement v1 distinguishes intentional numeric zero from unavailable,
    // but does not expose the richer local zero-reason field yet. Keep local
    // inference separate from token-priced/free-route zero in the method.
    return {
      kind: 'estimated',
      method: assignment.reason === 'local-inference' ? 'other' : 'token-pricing',
    }
  }
  return { kind: 'estimated', method: 'other' }
}

function resolveCurrentCompatibleCostEvidence(
  call: ParsedApiCall,
  profile: CollectorProvenanceProfileV1,
  pricingLookup: (model: string) => ModelCosts | null,
  calculator: typeof calculateCost,
): MeasurementCostEvidenceV1 {
  const cost = profile.facts.cost
  if (cost.basis === 'unavailable') return { kind: 'unavailable' }
  if (cost.basis === 'provider-metered') return { kind: 'metered', source: 'provider' }
  if (cost.basis === 'client-metered') return { kind: 'metered', source: 'client' }
  if (cost.basis === 'billing-export') return { kind: 'metered', source: 'billing-export' }

  // UsageMeasurementEventV1 does not yet expose web-search request counts. A
  // locally calculated cost that includes them cannot be reconciled from the
  // public event, so withhold it until that fact has a reviewed wire field.
  if (call.usage.webSearchRequests > 0) return { kind: 'unavailable' }

  const modelCosts = pricingLookup(call.model)
  if (!modelCosts || !positiveUsageHasPricingCoverage(call, modelCosts)) {
    return { kind: 'unavailable' }
  }
  if (!locallyCalculatedCostMatches(call, calculator)) {
    return { kind: 'unavailable' }
  }

  return {
    kind: 'estimated',
    method: cost.tokenBasis === 'estimated-content-length'
      ? 'content-length'
      : 'token-pricing',
  }
}

function resolveCostEvidence(
  call: ParsedApiCall,
  profile: CollectorProvenanceProfileV1,
  options: MeasurementEvidenceResolutionOptionsV1,
): MeasurementCostEvidenceV1 {
  // Once the runtime has settled a call, that immutable assignment is the only
  // cost authority for public measurement projection. Current catalogs are not
  // allowed to re-validate or reinterpret settled historical amounts.
  if (call.costAssignment !== undefined) {
    return assignmentCostEvidence(call, call.costAssignment)
  }
  if (options.costEvidenceMode === 'immutable-assignment') {
    return { kind: 'unavailable' }
  }
  return resolveCurrentCompatibleCostEvidence(
    call,
    profile,
    options.pricingLookup ?? getModelCosts,
    options.costCalculator ?? calculateCost,
  )
}

/**
 * Combine a reviewed collector profile with the actual normalized call and the
 * approved cost authority. Returning undefined is intentional: an unreviewed
 * collector path or unsupported reasoning attribution must never inherit a
 * plausible-looking public quality claim.
 */
export function resolveMeasurementEvidenceV1(
  call: ParsedApiCall,
  options: MeasurementEvidenceResolutionOptionsV1,
): MeasurementEvidenceResolutionV1 | undefined {
  const profile = collectorProvenanceProfileForCall(call)
  if (!profile || !reasoningAttributionIsAllowed(call, profile)) return undefined

  const tokenFacts = activeTokenFacts(call, profile)

  return {
    profile,
    quality: {
      tokenCounts: rollUpTokenQuality(tokenFacts),
      modelIdentity: rollUpModelIdentity(profile.facts.modelIdentity),
      sessionIdentity: rollUpSessionIdentity(
        profile.facts.sessionIdentity,
        options.sessionId,
      ),
    },
    costEvidence: resolveCostEvidence(call, profile, options),
  }
}
