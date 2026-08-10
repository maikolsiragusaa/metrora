import { getHistoricalPricingModelKey, getShortModelName } from './models.js'
import type { ModelAccounting, ModelAccountingRow } from './menubar-json.js'
import {
  combineReasoningSemantics,
  reasoningSemanticsForProviders,
  separatelyReportedReasoningTokens,
  type ReasoningTokenSemantics,
} from './token-semantics.js'

export type DeliveryStatus = 'exact' | 'partial' | 'unavailable'
export type TimingCoverage = 'observed' | 'partial' | 'unavailable'

export type ModelPresentationRow = {
  /** Stable presentation identity; never used as the accounting identity. */
  presentationIdentity: string
  name: string
  cost: number
  savingsUSD: number
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokenDetail: boolean
  reasoningSemantics: ReasoningTokenSemantics
  provider?: string
  providers: string[]
  sourceProviders: string[]
  rawModels: string[]
  canonicalIdentities: string[]
  economicVariants: string[]
  activeDurationMs?: number
  activeGeneratedTokens?: number
  estimatedCostUSD?: number
  costIsEstimated?: boolean
  timingCoverage: TimingCoverage
  pricingState?: 'settled' | 'estimated' | 'mixed' | 'unavailable'
  /** Exact accounting rows; the projection never synthesizes a source split. */
  deliveryRows: ModelAccountingRow[]
  deliveryStatus: DeliveryStatus
}

export type ModelPresentation = {
  rows: ModelPresentationRow[]
  /** The durable exact rows used to build this view, for audit hand-off. */
  accountingRowCount: number
}

type PresentationIdentity = { key: string; name: string; family?: string }

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/-+/g, '-')
}

function variantOf(value: string | undefined): string | undefined {
  const normalizedValue = normalized(value ?? '')
  if (!normalizedValue) return undefined
  const match = normalizedValue.match(/(?:^|[-:])(free|high|low|medium|tiered|default|preview)(?:$|[-:])/)
  return match?.[1]
}

function exactFallback(row: ModelAccountingRow): PresentationIdentity {
  const canonical = row.canonicalIdentity ?? (row.rawModels?.[0] ? getHistoricalPricingModelKey(row.rawModels[0]) : row.name)
  const variant = row.semanticVariant ?? variantOf(row.name) ?? 'default'
  const provider = row.provider ?? 'unresolved-provider'
  return {
    key: `exact:${normalized(canonical)}\u0000${variant}\u0000${normalized(provider)}\u0000${normalized(row.name)}`,
    name: row.name,
  }
}

/**
 * Safe family whitelist plus a conservative alias rule.  The whitelist covers
 * families whose diagnostics proved route/provider identity is delivery
 * evidence.  The alias rule only groups rows with the same canonical pricing
 * identity, the same semantic variant, and the same friendly model name; it
 * cannot erase a free/paid or variant distinction.
 */
export function presentationIdentityForAccountingRow(row: ModelAccountingRow): PresentationIdentity {
  const candidates = [row.name, ...(row.rawModels ?? []), row.canonicalIdentity ?? ''].map(normalized)
  const joined = candidates.join(' ')
  const variant = row.semanticVariant ?? variantOf(row.name)
  const free = variant === 'free' || /\bfree\b/i.test(joined)

  let family: string | undefined
  let displayName: string | undefined
  if (/deepseek-v4-pro/.test(joined)) {
    family = 'deepseek-v4-pro'
    displayName = 'DeepSeek v4 Pro'
  } else if (/deepseek-v4-flash/.test(joined)) {
    family = 'deepseek-v4-flash'
    displayName = free ? 'DeepSeek v4 Flash Free' : 'DeepSeek v4 Flash'
  } else if (/gpt-5-6-luna/.test(joined)) {
    family = 'gpt-5.6-luna'
    displayName = 'GPT-5.6 Luna'
  } else if (/gemini-3-1-pro/.test(joined)) {
    family = 'gemini-3.1-pro'
    displayName = 'Gemini 3.1 Pro'
  } else if (/gemini-3-6-flash/.test(joined)) {
    family = 'gemini-3.6-flash'
    displayName = 'Gemini 3.6 Flash'
  } else if (/glm-5(?:-2|p2|p1)/.test(joined) || /glm-5-2/.test(joined)) {
    family = 'glm-5.2'
    displayName = 'GLM-5.2'
  }

  if (family) {
    const economicVariant = free ? 'free' : variant === 'preview' ? 'preview' : 'paid'
    return {
      key: `family:${family}\u0000${economicVariant}`,
      name: displayName!,
      family,
    }
  }

  const canonical = row.canonicalIdentity
  const rawNames = row.rawModels ?? [row.name]
  const shortNames = rawNames.map(getShortModelName)
  const sameFriendlyName = shortNames.every(name => name === shortNames[0])
  const safeVariant = variant ?? 'default'
  if (canonical && sameFriendlyName && safeVariant !== 'free') {
    return {
      key: `canonical:${normalized(canonical)}\u0000${safeVariant}`,
      name: getShortModelName(rawNames[0] ?? row.name),
    }
  }

  return exactFallback(row)
}

export function presentationIdentityForModelName(model: string): { key: string; name: string } {
  const normalizedModel = normalized(model)
  if (/deepseek-v4-pro/.test(normalizedModel)) return { key: 'family:deepseek-v4-pro\u0000paid', name: 'DeepSeek v4 Pro' }
  if (/deepseek-v4-flash/.test(normalizedModel)) {
    const free = /\bfree\b/i.test(normalizedModel)
    return { key: `family:deepseek-v4-flash\u0000${free ? 'free' : 'paid'}`, name: free ? 'DeepSeek v4 Flash Free' : 'DeepSeek v4 Flash' }
  }
  if (/gpt-5-6-luna/.test(normalizedModel)) return { key: 'family:gpt-5.6-luna\u0000paid', name: 'GPT-5.6 Luna' }
  if (/gemini-3-1-pro/.test(normalizedModel)) return { key: 'family:gemini-3.1-pro\u0000paid', name: 'Gemini 3.1 Pro' }
  if (/gemini-3-6-flash/.test(normalizedModel)) return { key: 'family:gemini-3.6-flash\u0000paid', name: 'Gemini 3.6 Flash' }
  if (/glm-5(?:-2|p2|p1)/.test(normalizedModel)) return { key: 'family:glm-5.2\u0000paid', name: 'GLM-5.2' }
  const name = getShortModelName(model)
  return { key: `raw:${normalizedModel}`, name }
}

function pricingState(rows: readonly ModelAccountingRow[]): ModelPresentationRow['pricingState'] {
  if (rows.length === 0) return 'unavailable'
  const states = rows.map(row => {
    if (row.costIsEstimated === true || (row.estimatedCostUSD ?? 0) > 0) return 'estimated'
    if (row.tokenDetail === false && row.cost === 0 && row.calls > 0) return 'unavailable'
    return 'settled'
  })
  const unique = new Set(states)
  return unique.size === 1 ? states[0] : 'mixed'
}

function deliveryStatus(rows: readonly ModelAccountingRow[]): DeliveryStatus {
  if (rows.length === 0) return 'unavailable'
  const hasRouteOrSource = rows.some(row => row.provider || (row.sourceProviders?.length ?? 0) > 0)
  if (!hasRouteOrSource) return 'unavailable'
  if (rows.some(row => !row.provider || (row.sourceProviders?.length ?? 0) === 0)) return 'partial'
  return 'exact'
}

function buildRow(identity: PresentationIdentity, rows: ModelAccountingRow[]): ModelPresentationRow {
  const providers = [...new Set(rows.flatMap(row => row.provider ? [row.provider] : []))].sort()
  const sourceProviders = [...new Set(rows.flatMap(row => row.sourceProviders ?? []))].sort()
  const rawModels = [...new Set(rows.flatMap(row => row.rawModels ?? [row.name]))].sort()
  const canonicalIdentities = [...new Set(rows.flatMap(row => row.canonicalIdentity ? [row.canonicalIdentity] : []))].sort()
  const economicVariants = [...new Set(rows.map(row => row.semanticVariant ?? 'default'))].sort()
  const reasoningSemantics = combineReasoningSemantics(rows.map(row =>
    row.reasoningSemantics ?? reasoningSemanticsForProviders(row.sourceProviders),
  ))
  const tokenDetail = rows.every(row => row.tokenDetail)
  const reasoningTokens = rows.reduce((sum, row) => {
    const rowSemantics = row.reasoningSemantics ?? reasoningSemanticsForProviders(row.sourceProviders)
    return sum + separatelyReportedReasoningTokens(row.reasoningTokens, rowSemantics)
  }, 0)
  const hasReasoningEvidence = reasoningSemantics === 'separate'
    || (reasoningSemantics === 'mixed' && reasoningTokens > 0)
  const activeDurationMs = rows.reduce((sum, row) => sum + (row.activeDurationMs ?? 0), 0)
  const activeGeneratedTokens = rows.reduce((sum, row) => sum + (row.activeGeneratedTokens ?? 0), 0)
  const estimatedCostUSD = rows.reduce((sum, row) => sum + (row.estimatedCostUSD ?? 0), 0)
  const timingStates = rows.map(row => row.timingCoverage ?? (row.activeDurationMs && row.activeGeneratedTokens ? 'observed' : 'unavailable'))
  const timingCoverage: TimingCoverage = timingStates.every(state => state === 'observed')
    ? 'observed'
    : timingStates.every(state => state === 'unavailable')
      ? 'unavailable'
      : 'partial'
  return {
    presentationIdentity: identity.key,
    name: identity.name,
    cost: rows.reduce((sum, row) => sum + row.cost, 0),
    savingsUSD: rows.reduce((sum, row) => sum + row.savingsUSD, 0),
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    ...(hasReasoningEvidence ? { reasoningTokens } : {}),
    cacheReadTokens: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    cacheWriteTokens: rows.reduce((sum, row) => sum + row.cacheWriteTokens, 0),
    tokenDetail,
    reasoningSemantics,
    ...(providers.length === 1 ? { provider: providers[0] } : {}),
    providers,
    sourceProviders,
    rawModels,
    canonicalIdentities,
    economicVariants,
    ...(activeDurationMs > 0 && activeGeneratedTokens > 0 ? { activeDurationMs, activeGeneratedTokens } : {}),
    ...(estimatedCostUSD > 0 ? { estimatedCostUSD } : {}),
    ...(rows.some(row => row.costIsEstimated === true) ? { costIsEstimated: true } : {}),
    timingCoverage,
    pricingState: pricingState(rows),
    deliveryRows: rows,
    deliveryStatus: deliveryStatus(rows),
  }
}

export function buildModelPresentation(accounting: ModelAccounting): ModelPresentation {
  const groups = new Map<string, { identity: PresentationIdentity; rows: ModelAccountingRow[] }>()
  for (const row of accounting.rows) {
    const identity = presentationIdentityForAccountingRow(row)
    const group = groups.get(identity.key)
    if (group) group.rows.push(row)
    else groups.set(identity.key, { identity, rows: [row] })
  }
  const rows = [...groups.values()]
    .map(group => buildRow(group.identity, group.rows))
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
  return { rows, accountingRowCount: accounting.rows.length }
}
