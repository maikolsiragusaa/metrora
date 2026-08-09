/**
 * The token ledger keeps output and separately reported reasoning apart.  A
 * source that only exposes one generated-output number is deliberately marked
 * unavailable rather than guessed: adding a hidden reasoning estimate would
 * make both totals and Cost / 1M unsafe.
 */
export type ReasoningTokenSemantics = 'separate' | 'aggregate-output' | 'unavailable' | 'mixed'

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
  if (hasSeparateTokenEvidence) return 'separate'
  const values = [...new Set((providers ?? []).map(provider => provider.trim().toLowerCase()).filter(Boolean))]
  const hasSeparate = values.some(providerHasSeparateReasoning)
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
  if (left === 'unavailable') return right
  if (right === 'unavailable') return left
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
  // Mixed raw rows do not carry a safe per-source split. Only a row explicitly
  // proven separate can contribute its numeric reasoning field here.
  if (semantics !== 'separate') return 0
  return typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens) && reasoningTokens > 0
    ? reasoningTokens
    : 0
}
