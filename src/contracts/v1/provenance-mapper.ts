import type { ModelCosts } from '../../models.js'
import { calculateCost, getModelCosts } from '../../models.js'
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

export type MeasurementEvidenceResolutionOptionsV1 = {
  sessionIdExported: boolean
  pricingLookup?: (model: string) => ModelCosts | null
  costCalculator?: typeof calculateCost
}

type TokenFact = {
  value: number
  provenance: FactProvenanceV1
}

function assertNormalizedToken(value: number, name: string): void {
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
    assertNormalizedToken(fact.value, [
      'inputTokens',
      'outputTokens',
      'cacheReadInputTokens',
      'cacheCreationInputTokens',
      'reasoningTokens',
    ][index]!)
  }

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
  sessionIdExported: boolean,
): UsageMeasurementDataV1['quality']['sessionIdentity'] {
  if (!sessionIdExported) return 'unknown'
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
  let sawBillableFact = false
  const requireRate = (value: number, rate: number): boolean => {
    if (value <= 0) return true
    sawBillableFact = true
    return Number.isFinite(rate) && rate > 0
  }

  const covered =
    requireRate(call.usage.inputTokens, costs.inputCostPerToken) &&
    requireRate(call.usage.outputTokens + call.usage.reasoningTokens, costs.outputCostPerToken) &&
    requireRate(call.usage.cacheCreationInputTokens, costs.cacheWriteCostPerToken) &&
    requireRate(call.usage.cacheReadInputTokens, costs.cacheReadCostPerToken) &&
    requireRate(call.usage.webSearchRequests, costs.webSearchCostPerRequest)

  return covered && sawBillableFact
}

function locallyCalculatedCostMatches(
  call: ParsedApiCall,
  calculator: typeof calculateCost,
): boolean {
  const expected = calculator(
    call.model,
    call.usage.inputTokens,
    call.usage.outputTokens + call.usage.reasoningTokens,
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
  return Math.round(expected * 1_000_000) === Math.round(call.costUSD * 1_000_000)
}

function resolveCostEvidence(
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

/**
 * Combine a reviewed collector profile with the actual normalized call and the
 * current pricing registry. Returning undefined is intentional: an unreviewed
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
  const pricingLookup = options.pricingLookup ?? getModelCosts
  const calculator = options.costCalculator ?? calculateCost

  return {
    profile,
    quality: {
      tokenCounts: rollUpTokenQuality(tokenFacts),
      modelIdentity: rollUpModelIdentity(profile.facts.modelIdentity),
      sessionIdentity: rollUpSessionIdentity(
        profile.facts.sessionIdentity,
        options.sessionIdExported,
      ),
    },
    costEvidence: resolveCostEvidence(call, profile, pricingLookup, calculator),
  }
}
