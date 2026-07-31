export const REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'adaptive',
] as const

export type ReasoningLevel = typeof REASONING_LEVELS[number]
export type ReasoningLevelOrUnknown = ReasoningLevel | 'unknown'
export type ReasoningLevelSource = 'explicit' | 'model-label'

export type ReasoningAttribution = {
  level: ReasoningLevel
  source: ReasoningLevelSource
}

export type ReasoningMixRow = {
  level: ReasoningLevelOrUnknown
  calls: number
  callShare: number
  generatedTokens: number
  reasoningTokens: number
  costUSD: number
  sources: ReasoningLevelSource[]
}

export type ReasoningMix = {
  totalCalls: number
  knownCalls: number
  coverage: number
  rows: ReasoningMixRow[]
}

export type ReasoningMixInput = {
  reasoningLevel?: ReasoningLevel
  reasoningLevelSource?: ReasoningLevelSource
  outputTokens?: number
  reasoningTokens?: number
  costUSD?: number
}

const LEVEL_SET = new Set<string>(REASONING_LEVELS)
const LEVEL_ORDER: ReasoningLevelOrUnknown[] = [...REASONING_LEVELS, 'unknown']
const EXPLICIT_KEYS = new Set([
  'effort',
  'reasoning_effort',
  'reasoningeffort',
  'reasoning_level',
  'reasoninglevel',
  'model_reasoning_effort',
  'modelreasoningeffort',
  'thinking_effort',
  'thinkingeffort',
  'thinking_level',
  'thinkinglevel',
])

function canonicalKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function normalizeReasoningLevel(value: unknown): ReasoningLevel | null {
  if (typeof value !== 'string') return null
  let normalized = value.trim().toLowerCase().replace(/[\s.-]+/g, '_')
  const aliases: Record<string, ReasoningLevel> = {
    off: 'none',
    disabled: 'none',
    no_reasoning: 'none',
    min: 'minimal',
    minimum: 'minimal',
    extra_high: 'xhigh',
    extra_high_reasoning: 'xhigh',
    x_high: 'xhigh',
    maximum: 'max',
    auto: 'adaptive',
    automatic: 'adaptive',
    dynamic: 'adaptive',
  }
  normalized = aliases[normalized] ?? normalized
  return LEVEL_SET.has(normalized) ? normalized as ReasoningLevel : null
}

/**
 * Find an explicitly persisted reasoning level in a bounded object graph.
 * Unknown values are ignored. Cycles and excessively deep payloads are safe.
 */
export function findExplicitReasoningLevel(root: unknown, maxDepth = 8): ReasoningLevel | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }]
  const seen = new Set<object>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (!current.value || typeof current.value !== 'object' || current.depth > maxDepth) continue
    if (seen.has(current.value)) continue
    seen.add(current.value)

    for (const [key, child] of Object.entries(current.value)) {
      if (EXPLICIT_KEYS.has(canonicalKey(key))) {
        const level = normalizeReasoningLevel(child)
        if (level) return level
      }
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  return null
}

function isReasoningCapableModelLabel(model: string): boolean {
  return /(?:^|[\s/_.:-])(?:gpt|codex|claude|gemini|o[134])(?:$|[\s/_.:-])/i.test(model)
}

/**
 * Extract only labels that unambiguously encode reasoning effort. This does not
 * inspect token volume, price, duration or task content and never mutates the
 * model name used by pricing or model aggregation.
 */
export function reasoningLevelFromModelLabel(model: unknown): ReasoningAttribution | null {
  if (typeof model !== 'string' || !model.trim()) return null
  const raw = model.trim()

  const phrase = raw.match(
    /(?:reasoning|thinking)(?:[\s._-]*(?:effort|level))?[\s:=._-]+(extra[\s._-]*high|x[\s._-]*high|none|minimal|low|medium|high|max(?:imum)?|adaptive)/i,
  )
  if (phrase?.[1]) {
    const level = normalizeReasoningLevel(phrase[1])
    if (level) return { level, source: 'model-label' }
  }

  const parenthesized = raw.match(
    /[([]\s*(extra[\s._-]*high|x[\s._-]*high|none|minimal|low|medium|high|max(?:imum)?|adaptive)(?:[\s._-]+reasoning)?\s*[)\]]/i,
  )
  if (parenthesized?.[1]) {
    const level = normalizeReasoningLevel(parenthesized[1])
    if (level) return { level, source: 'model-label' }
  }

  if (!isReasoningCapableModelLabel(raw)) return null
  const normalized = raw.toLowerCase().replace(/[\s._]+/g, '-').replace(/-+/g, '-')
  const suffix = normalized.match(
    /(?:^|[/:-])(extra-high|x-high|xhigh|none|minimal|low|medium|high|max|adaptive)(?:-reasoning)?(?:-fast)?$/,
  )
  if (!suffix?.[1]) return null
  const level = normalizeReasoningLevel(suffix[1])
  return level ? { level, source: 'model-label' } : null
}

export function resolveReasoningAttribution(explicitRoot: unknown, model: unknown): ReasoningAttribution | null {
  const explicit = findExplicitReasoningLevel(explicitRoot)
  if (explicit) return { level: explicit, source: 'explicit' }
  return reasoningLevelFromModelLabel(model)
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Build a call-weighted session mix. Token and cost figures are supporting
 * context only; they never determine the level assigned to a call.
 */
export function buildReasoningMix(calls: ReasoningMixInput[]): ReasoningMix {
  type Acc = Omit<ReasoningMixRow, 'callShare' | 'sources'> & { sources: Set<ReasoningLevelSource> }
  const rows = new Map<ReasoningLevelOrUnknown, Acc>()

  for (const call of calls) {
    const level: ReasoningLevelOrUnknown = call.reasoningLevel ?? 'unknown'
    const row = rows.get(level) ?? {
      level,
      calls: 0,
      generatedTokens: 0,
      reasoningTokens: 0,
      costUSD: 0,
      sources: new Set<ReasoningLevelSource>(),
    }
    row.calls++
    row.generatedTokens += finiteNonNegative(call.outputTokens) + finiteNonNegative(call.reasoningTokens)
    row.reasoningTokens += finiteNonNegative(call.reasoningTokens)
    row.costUSD += finiteNonNegative(call.costUSD)
    if (call.reasoningLevelSource) row.sources.add(call.reasoningLevelSource)
    rows.set(level, row)
  }

  const totalCalls = calls.length
  const knownCalls = calls.reduce((sum, call) => sum + (call.reasoningLevel ? 1 : 0), 0)
  const order = new Map(LEVEL_ORDER.map((level, index) => [level, index]))
  const output = [...rows.values()]
    .sort((a, b) => b.calls - a.calls || (order.get(a.level) ?? 999) - (order.get(b.level) ?? 999))
    .map(row => ({
      level: row.level,
      calls: row.calls,
      callShare: totalCalls > 0 ? row.calls / totalCalls : 0,
      generatedTokens: row.generatedTokens,
      reasoningTokens: row.reasoningTokens,
      costUSD: row.costUSD,
      sources: [...row.sources].sort(),
    }))

  return {
    totalCalls,
    knownCalls,
    coverage: totalCalls > 0 ? knownCalls / totalCalls : 0,
    rows: output,
  }
}
