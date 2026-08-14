import type {
  HistoricalPricePolicyConditionV1,
  HistoricalPricePolicyV1,
  HistoricalPriceRecordV1,
  HistoricalPriceRatesV1,
  HistoricalPriceTimeWindowV1,
} from './history.js'
import type { HistoricalPricingEvidenceV1 } from './pricing-context.js'

export type HistoricalPricePolicyRequestV1 = {
  timestamp?: string
  promptInputTokens?: number
  route?: string
  billingTier?: string
  speed: 'standard' | 'fast'
  cacheTier?: 'none' | 'read' | 'write-5m' | 'write-1h'
  pricingEvidence?: readonly HistoricalPricingEvidenceV1[]
}

export type HistoricalPricePolicySelectionV1 =
  | { kind: 'base' }
  | { kind: 'pricing-policy'; policyId: string; conditionKinds: string[] }
  | { kind: 'pricing-evidence'; evidenceKind: HistoricalPricingEvidenceV1['kind'] }

export type HistoricalPricePolicyResolutionV1 =
  | {
      kind: 'selected'
      rates: HistoricalPriceRatesV1
      selection: HistoricalPricePolicySelectionV1
    }
  | {
      kind: 'unavailable'
      reason: 'missing-pricing-evidence' | 'ambiguous-pricing-policy'
    }

type ConditionResult = 'true' | 'false' | 'unknown'

function localTimeParts(timestamp: string, timeZone: string): { day: number; minute: number } | undefined {
  const at = new Date(timestamp)
  if (!Number.isFinite(at.getTime())) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const values = new Map(parts.map(part => [part.type, part.value]))
    const weekdays: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }
    const day = weekdays[values.get('weekday') ?? '']
    const hour = Number(values.get('hour'))
    const minute = Number(values.get('minute'))
    if (day === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
    return { day, minute: hour * 60 + minute }
  } catch {
    return undefined
  }
}

/** Evaluate a half-open recurring window in the provider-declared timezone. */
export function matchesHistoricalPriceTimeWindowV1(
  timestamp: string | undefined,
  window: HistoricalPriceTimeWindowV1,
): boolean | undefined {
  if (!timestamp) return undefined
  const local = localTimeParts(timestamp, window.timeZone)
  if (!local) return undefined

  const days = window.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]
  let day = local.day
  let active: boolean
  if (window.startMinute < window.endMinute) {
    active = window.startMinute <= local.minute && local.minute < window.endMinute
  } else {
    // For a crossing-midnight window, the post-midnight portion belongs to
    // the calendar day on which the window began.
    const beforeMidnight = local.minute >= window.startMinute
    const afterMidnight = local.minute < window.endMinute
    active = beforeMidnight || afterMidnight
    if (afterMidnight) day = (day + 6) % 7
  }
  return active && days.includes(day)
}

function evidenceOfKind(
  evidence: readonly HistoricalPricingEvidenceV1[] | undefined,
  kind: HistoricalPricingEvidenceV1['kind'],
): HistoricalPricingEvidenceV1 | undefined {
  return evidence?.find(item => item.kind === kind)
}

function conditionResult(
  condition: HistoricalPricePolicyConditionV1,
  request: HistoricalPricePolicyRequestV1,
): ConditionResult {
  switch (condition.kind) {
    case 'prompt-input-tokens-above':
      return request.promptInputTokens === undefined
        ? 'unknown'
        : request.promptInputTokens > condition.tokens ? 'true' : 'false'
    case 'route-is':
      return request.route === undefined ? 'unknown' : request.route === condition.route ? 'true' : 'false'
    case 'billing-tier-is':
      return request.billingTier === undefined
        ? 'unknown'
        : request.billingTier === condition.billingTier ? 'true' : 'false'
    case 'speed-is':
      return request.speed === condition.speed ? 'true' : 'false'
    case 'cache-tier-is':
      return request.cacheTier === undefined ? 'unknown' : request.cacheTier === condition.tier ? 'true' : 'false'
    case 'time-window': {
      const matched = matchesHistoricalPriceTimeWindowV1(request.timestamp, condition.window)
      return matched === undefined ? 'unknown' : matched ? 'true' : 'false'
    }
    case 'provider-reported-tier-is': {
      const evidence = evidenceOfKind(request.pricingEvidence, 'provider-reported-tier')
      return evidence === undefined
        ? 'unknown'
        : evidence.kind === 'provider-reported-tier' && evidence.tier === condition.tier ? 'true' : 'false'
    }
    case 'provider-reported-multiplier-at-least': {
      const evidence = evidenceOfKind(request.pricingEvidence, 'provider-reported-multiplier')
      return evidence === undefined
        ? 'unknown'
        : evidence.kind === 'provider-reported-multiplier' && evidence.multiplier >= condition.multiplier ? 'true' : 'false'
    }
  }
}

function scaleRates(rates: HistoricalPriceRatesV1, multiplier: number): HistoricalPriceRatesV1 {
  return {
    ...rates,
    inputPerToken: rates.inputPerToken * multiplier,
    outputPerToken: rates.outputPerToken * multiplier,
    cacheReadPerToken: rates.cacheReadPerToken * multiplier,
    cacheWritePerToken: rates.cacheWritePerToken * multiplier,
    ...(rates.webSearchPerRequest === undefined ? {} : { webSearchPerRequest: rates.webSearchPerRequest * multiplier }),
    ...(rates.requestCharges === undefined ? {} : {
      requestCharges: {
        ...(rates.requestCharges.gatewayServicePerRequest === undefined
          ? {}
          : { gatewayServicePerRequest: rates.requestCharges.gatewayServicePerRequest * multiplier }),
        ...(rates.requestCharges.toolRequestPerRequest === undefined
          ? {}
          : { toolRequestPerRequest: rates.requestCharges.toolRequestPerRequest * multiplier }),
      },
    }),
  }
}

function dynamicRates(
  record: HistoricalPriceRecordV1,
  rates: HistoricalPriceRatesV1,
  request: HistoricalPricePolicyRequestV1,
): HistoricalPriceRatesV1 | Extract<HistoricalPricePolicyResolutionV1, { kind: 'unavailable' }> {
  const mode = record.pricingMode
  if (!mode || mode.kind === 'deterministic') return rates

  const evidence = evidenceOfKind(request.pricingEvidence, mode.requiredEvidence)
  if (!evidence) return { kind: 'unavailable', reason: 'missing-pricing-evidence' }
  if (evidence.kind === 'provider-reported-multiplier') return scaleRates(rates, evidence.multiplier)
  if (evidence.kind === 'quoted-rates') return evidence.rates
  return rates
}

function policyResult(
  policy: HistoricalPricePolicyV1,
  request: HistoricalPricePolicyRequestV1,
): ConditionResult {
  let unknown = false
  for (const condition of policy.when) {
    const result = conditionResult(condition, request)
    if (result === 'false') return 'false'
    if (result === 'unknown') unknown = true
  }
  return unknown ? 'unknown' : 'true'
}

/**
 * Resolve bounded request conditions without using catalog order as a tie
 * breaker. Any unresolved or equally-specific candidate fails closed.
 */
export function selectHistoricalPricePolicyV1(
  record: HistoricalPriceRecordV1,
  request: HistoricalPricePolicyRequestV1,
): HistoricalPricePolicyResolutionV1 {
  const policies = record.pricingPolicies ?? []
  let rates = record.rates
  let selection: HistoricalPricePolicySelectionV1 = { kind: 'base' }

  if (policies.length > 0) {
    const matches: HistoricalPricePolicyV1[] = []
    let unresolved = false
    for (const policy of policies) {
      const result = policyResult(policy, request)
      if (result === 'true') matches.push(policy)
      else if (result === 'unknown') unresolved = true
    }

    if (unresolved) return { kind: 'unavailable', reason: 'missing-pricing-evidence' }
    if (matches.length > 0) {
      const maxSpecificity = Math.max(...matches.map(policy => policy.when.length))
      const strongest = matches.filter(policy => policy.when.length === maxSpecificity)
      if (strongest.length !== 1) return { kind: 'unavailable', reason: 'ambiguous-pricing-policy' }
      const selected = strongest[0]!
      rates = selected.rates
      selection = {
        kind: 'pricing-policy',
        policyId: selected.policyId,
        conditionKinds: selected.when.map(condition => condition.kind),
      }
    }
  }

  const resolved = dynamicRates(record, rates, request)
  if ('kind' in resolved) return resolved
  if (selection.kind === 'base') {
    const dynamicEvidence = record.pricingMode?.kind === 'dynamic'
      ? evidenceOfKind(request.pricingEvidence, record.pricingMode.requiredEvidence)
      : undefined
    if (dynamicEvidence) {
      selection = { kind: 'pricing-evidence', evidenceKind: dynamicEvidence.kind }
    }
  }
  return { kind: 'selected', rates: resolved, selection }
}
