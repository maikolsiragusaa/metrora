import { calculateCost } from './models.js'
import { billableOutputTokens } from './token-semantics.js'
import type { CachedCall, SessionCache } from './session-cache.js'
import {
  assignRuntimeCostV1,
} from './pricing/runtime-cost-assignment.js'

function currentCostForCachedCall(call: CachedCall): number {
  const u = call.usage
  const outputForCost = billableOutputTokens(call.provider, u.outputTokens, u.reasoningTokens, call.reasoningSemantics)
  return calculateCost(
    call.model, u.inputTokens, outputForCost,
    u.cacheCreationInputTokens, u.cacheReadInputTokens,
    u.webSearchRequests, call.speed, u.cacheCreationOneHourTokens,
  )
}

export function settleCachedCallCost(call: CachedCall) {
  return assignRuntimeCostV1({
    provider: call.provider,
    model: call.model,
    modelProvider: call.modelProvider, pricingContext: call.pricingContext,
    timestamp: call.timestamp,
    speed: call.speed,
    usage: call.usage,
    reasoningSemantics: call.reasoningSemantics,
    legacyCostUSD: call.legacyCostUSD ?? call.costUSD ?? currentCostForCachedCall(call),
    isEstimated: call.isEstimated,
    existingAssignment: call.costAssignment,
    existingStoredCostUSD: call.costUSD,
    existingLegacyCostUSD: call.legacyCostUSD,
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
