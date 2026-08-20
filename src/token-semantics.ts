/**
 * The token ledger keeps output and separately reported reasoning apart.  A
 * source that only exposes one generated-output number is deliberately marked
 * unavailable rather than guessed: adding a hidden reasoning estimate would
 * make both totals and Cost / 1M unsafe.
 */
export type ReasoningTokenSemantics = 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'

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

export function separatelyReportedReasoningTokens(
  reasoningTokens: number | undefined,
  semantics: ReasoningTokenSemantics | undefined,
): number {
  // A mixed row may retain a positive subtotal from the independently observed
  // constituent(s). Preserve that evidence, while the mixed status tells the
  // presentation that other constituents are unavailable or aggregate-output;
  // no missing reasoning is estimated.
  if (semantics !== 'separate' && semantics !== 'mixed') return 0
  return typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens) && reasoningTokens > 0
    ? reasoningTokens
    : 0
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
  const includeReasoning = semantics === 'separate'
    || semantics === 'mixed'
    || (semantics === undefined && provider !== 'claude')
  return outputTokens + (includeReasoning ? reasoningTokens : 0)
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
  return semantics === 'aggregate-output' || semantics === 'unavailable'
    ? outputTokens
    : outputTokens + reasoningTokens
}
