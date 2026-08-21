import { calculateCost, getHistoricalPricingModelKey } from './models.js'
import { billableOutputTokens } from './token-semantics.js'
import type { CachedCall, SessionCache } from './session-cache.js'
import { settledCostUsdV1 } from './pricing/cost-assignment.js'
import { assignRuntimeCostV1 } from './pricing/runtime-cost-assignment.js'

function currentCostForCachedCall(call: CachedCall): number {
  const u = call.usage
  const outputForCost = billableOutputTokens(call.provider, u.outputTokens, u.reasoningTokens, call.reasoningSemantics)
  return calculateCost(
    call.model, u.inputTokens, outputForCost,
    u.cacheCreationInputTokens, u.cacheReadInputTokens,
    u.webSearchRequests, call.speed, u.cacheCreationOneHourTokens,
  )
}

const DEEPSEEK_V4_PRICING_CUTOVER_MS = Date.parse('2026-08-16T16:00:00Z')
const DEEPSEEK_V4_LEGACY_RECORDS = new Map<string, {
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  successorRecordId: string
}>([
  ['deepseek:deepseek-v4-flash:standard:official-2026-08-07', {
    model: 'deepseek-v4-flash',
    successorRecordId: 'deepseek:deepseek-v4-flash:standard:official-2026-08-16',
  }],
  ['deepseek:deepseek-v4-pro:standard:official-2026-08-07', {
    model: 'deepseek-v4-pro',
    successorRecordId: 'deepseek:deepseek-v4-pro:standard:official-2026-08-16',
  }],
])

function normalizedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

/**
 * Explicit, one-release repair authority for the DeepSeek V4 pricing cutover.
 * This is deliberately narrower than generic assignment immutability: only an
 * old reviewed-book token assignment can be replaced, and only when the call
 * timestamp and model identity prove that the old interval is impossible.
 */
export function deepseekV4PricingMigrationTargetV1(call: CachedCall): {
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  successorRecordId: string
} | undefined {
  const assignment = call.costAssignment
  if (assignment?.kind !== 'token-price' || assignment.priceOrigin !== 'reviewed-book') return undefined

  const target = DEEPSEEK_V4_LEGACY_RECORDS.get(assignment.priceRecordId)
  if (!target) return undefined

  const timestamp = Date.parse(call.timestamp)
  if (!Number.isFinite(timestamp) || timestamp < DEEPSEEK_V4_PRICING_CUTOVER_MS) return undefined
  if (getHistoricalPricingModelKey(call.model) !== target.model) return undefined

  const contextAuthority = normalizedOptional(call.pricingContext?.pricingAuthority)
  if (contextAuthority !== undefined && contextAuthority !== 'deepseek') return undefined
  const contextRoute = normalizedOptional(call.pricingContext?.route)
  if (contextRoute !== undefined && contextRoute !== 'standard') return undefined

  const provenance = assignment.pricingProvenance
  if (normalizedOptional(provenance?.pricingAuthority) !== undefined
    && normalizedOptional(provenance?.pricingAuthority) !== 'deepseek') return undefined
  if (provenance?.pricingModel !== undefined
    && getHistoricalPricingModelKey(provenance.pricingModel) !== target.model) return undefined
  if (normalizedOptional(provenance?.route) !== undefined
    && normalizedOptional(provenance?.route) !== 'standard') return undefined

  return target
}

function migrationLegacyEvidenceUSD(call: CachedCall): number {
  return call.legacyCostUSD
    ?? call.costUSD
    ?? (call.costAssignment ? settledCostUsdV1(call.costAssignment) : undefined)
    ?? currentCostForCachedCall(call)
}

export function settleCachedCallCost(call: CachedCall) {
  const migration = deepseekV4PricingMigrationTargetV1(call)
  const legacyCostUSD = migration ? migrationLegacyEvidenceUSD(call) : undefined
  return assignRuntimeCostV1({
    provider: call.provider,
    model: call.model,
    modelProvider: call.modelProvider, pricingContext: call.pricingContext,
    timestamp: call.timestamp,
    speed: call.speed,
    usage: call.usage,
    reasoningSemantics: call.reasoningSemantics,
    legacyCostUSD: legacyCostUSD ?? call.legacyCostUSD ?? call.costUSD ?? currentCostForCachedCall(call),
    isEstimated: call.isEstimated,
    ...(migration ? {} : { existingAssignment: call.costAssignment }),
    ...(migration ? {} : { existingStoredCostUSD: call.costUSD }),
    ...(migration ? {} : { existingLegacyCostUSD: call.legacyCostUSD }),
  })
}

/**
 * Migrate only legacy Copilot OTel rows whose two positive cache buckets prove
 * the old parser stored cache-inclusive input. A zero bucket is ambiguous and
 * remains untouched because old zeroes may have been parser fallbacks.
 */
export function migrateLegacyCopilotOtelCacheCall(call: CachedCall): boolean {
  if (call.provider !== 'copilot' || !call.deduplicationKey.startsWith('copilot-otel:')) return false
  if (call.cacheTokenEvidence !== undefined) return false

  const { inputTokens, cacheReadInputTokens, cacheCreationInputTokens } = call.usage
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cacheReadInputTokens) || !Number.isFinite(cacheCreationInputTokens)) return false
  if (cacheReadInputTokens <= 0 || cacheCreationInputTokens <= 0) return false
  const normalizedInput = inputTokens - cacheReadInputTokens - cacheCreationInputTokens
  if (normalizedInput < 0) return false

  const previousInput = call.usage.inputTokens
  const previousCost = call.costUSD
  const previousAssignment = call.costAssignment
  const previousLegacyCost = call.legacyCostUSD
  const previousEvidence = call.cacheTokenEvidence

  try {
    call.usage.inputTokens = normalizedInput
    call.cacheTokenEvidence = 'complete'
    delete call.costUSD
    delete call.costAssignment
    delete call.legacyCostUSD

    const settlement = settleCachedCallCost(call)
    if (settlement.storedCostUSD === undefined) delete call.costUSD
    else call.costUSD = settlement.storedCostUSD
    call.costAssignment = settlement.storedAssignment
    if (settlement.storedLegacyCostUSD === undefined) delete call.legacyCostUSD
    else call.legacyCostUSD = settlement.storedLegacyCostUSD
    return true
  } catch {
    call.usage.inputTokens = previousInput
    if (previousCost === undefined) delete call.costUSD
    else call.costUSD = previousCost
    if (previousAssignment === undefined) delete call.costAssignment
    else call.costAssignment = previousAssignment
    if (previousLegacyCost === undefined) delete call.legacyCostUSD
    else call.legacyCostUSD = previousLegacyCost
    if (previousEvidence === undefined) delete call.cacheTokenEvidence
    else call.cacheTokenEvidence = previousEvidence
    return false
  }
}

export function settleSessionCacheCostsForRuntimeV1(cache: SessionCache): boolean {
  let changed = false
  for (const section of Object.values(cache.providers)) {
    for (const file of Object.values(section.files)) {
      for (const turn of file.turns) {
        for (const call of turn.calls) {
          const settlement = settleCachedCallCost(call)
          const nextCost = settlement.storedCostUSD
          if (nextCost === undefined) {
            if (call.costUSD !== undefined) { delete call.costUSD; changed = true }
          } else if (call.costUSD !== nextCost) {
            call.costUSD = nextCost
            changed = true
          }
          const nextAssignment = JSON.stringify(settlement.storedAssignment)
          if (JSON.stringify(call.costAssignment) !== nextAssignment) {
            call.costAssignment = settlement.storedAssignment
            changed = true
          }
          if (settlement.storedLegacyCostUSD === undefined) {
            if (call.legacyCostUSD !== undefined) { delete call.legacyCostUSD; changed = true }
          } else if (call.legacyCostUSD !== settlement.storedLegacyCostUSD) {
            call.legacyCostUSD = settlement.storedLegacyCostUSD
            changed = true
          }
        }
      }
    }
  }
  return changed
}
