/**
 * The token ledger keeps output and separately reported reasoning apart.  A
 * source that only exposes one generated-output number is deliberately marked
 * unavailable rather than guessed: adding a hidden reasoning estimate would
 * make both totals and Cost / 1M unsafe.
 */
export type ReasoningTokenSemantics = 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'

export type ReasoningTokenTotals = {
  /** Factual reasoning-token evidence retained for breakdown/reporting. */
  observedReasoningTokens: number
  /** Only the reasoning subtotal that is additive to output. */
  additiveReasoningTokens: number
}

/**
 * Evidence quality for the two OTel cache subfields. `partial` is deliberate:
 * a missing cache subfield is not equivalent to an emitted zero.
 */
export type CacheTokenEvidence = 'complete' | 'partial' | 'unavailable' | 'inconsistent'

const SEPARATE_REASONING_PROVIDERS = new Set([
  'antigravity',
  'codex',
  'cursor-agent',
  'gemini',
  'opencode',
  'zcode',
])

export function providerHasSeparateReasoning(provider: string | undefined): boolean {
  return provider !== undefined && SEPARATE_REASONING_PROVIDERS.has(provider.trim().toLowerCase())
}

export function reasoningSemanticsForProviders(providers: readonly string[] | undefined, hasSeparateTokenEvidence = false): ReasoningTokenSemantics {
  const values = [...new Set((providers ?? []).map(provider => provider.trim().toLowerCase()).filter(Boolean))]
  const hasSeparate = hasSeparateTokenEvidence || values.some(providerHasSeparateReasoning)
  const hasUnavailable = values.some(provider => !providerHasSeparateReasoning(provider))
  if (hasSeparate && hasUnavailable) return 'mixed'
  if (hasSeparate) return 'separate'
  return 'unavailable'
}

export function mergeReasoningSemantics(
  left: ReasoningTokenSemantics,
  right: ReasoningTokenSemantics,
): ReasoningTokenSemantics {
  if (left === right) return left
  return 'mixed'
}

/** Combines independently evidenced call/row semantics without treating a
 * real unavailable constituent as if it had the first constituent's meaning. */
export function combineReasoningSemantics(values: readonly ReasoningTokenSemantics[]): ReasoningTokenSemantics {
  if (values.length === 0) return 'unavailable'
  const first = values[0]!
  return values.every(value => value === first) ? first : 'mixed'
}

function finiteReasoningTokens(reasoningTokens: number | undefined): number {
  return typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens) && reasoningTokens > 0
    ? reasoningTokens
    : 0
}

/**
 * Split a reasoning count into the factual breakdown and the generated-token
 * subtotal. `mixed` is intentionally non-additive: its constituents are not
 * available at this boundary, so the aggregate must carry an explicit
 * additive subtotal instead of inferring it from the observed total.
 *
 * An omitted authority preserves the historic collector behavior. Explicit
 * `unavailable` remains out of normalized aggregate evidence.
 */
export function reasoningTokenTotals(
  reasoningTokens: number | undefined,
  semantics: ReasoningTokenSemantics | undefined,
): ReasoningTokenTotals {
  const observedReasoningTokens = semantics === 'unavailable' ? 0 : finiteReasoningTokens(reasoningTokens)
  const additiveReasoningTokens = semantics === 'separate' || semantics === undefined
    ? finiteReasoningTokens(reasoningTokens)
    : 0
  return { observedReasoningTokens, additiveReasoningTokens }
}

export function observedReasoningTokens(
  reasoningTokens: number | undefined,
  semantics?: ReasoningTokenSemantics,
): number {
  return reasoningTokenTotals(reasoningTokens, semantics).observedReasoningTokens
}

export function additiveReasoningTokens(
  reasoningTokens: number | undefined,
  semantics?: ReasoningTokenSemantics,
): number {
  return reasoningTokenTotals(reasoningTokens, semantics).additiveReasoningTokens
}

/** Compatibility name retained for existing consumers; it now means only the
 * independently additive subtotal and never infers from `mixed`. */
export function separatelyReportedReasoningTokens(
  reasoningTokens: number | undefined,
  semantics: ReasoningTokenSemantics | undefined,
): number {
  return additiveReasoningTokens(reasoningTokens, semantics)
}

/**
 * The canonical cost contract prices output inclusively only when the source
 * says reasoning is separate. The undefined branch preserves the historic
 * provider defaults used by collectors that predate explicit semantics.
 */
export function billableOutputTokens(
  provider: string | undefined,
  outputTokens: number,
  reasoningTokens: number,
  semantics?: ReasoningTokenSemantics,
): number {
  const additive = semantics === undefined && provider === 'claude'
    ? 0
    : additiveReasoningTokens(reasoningTokens, semantics)
  return outputTokens + additive
}

/**
 * Generated-token display for a single call. Aggregate-output reasoning is
 * already inside the producer's output count and must not be added again.
 */
export function generatedTokensForReasoningMix(
  outputTokens: number,
  reasoningTokens: number,
  semantics?: ReasoningTokenSemantics,
): number {
  return outputTokens + additiveReasoningTokens(reasoningTokens, semantics)
}
