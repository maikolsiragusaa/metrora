import { hostedProviderRoute, type HarnessHostedProvider, type HarnessReasoningCapability, type HarnessReasoningEffort } from './harness-runtime-types.js'

export type HarnessOpenCodeZenTransport = 'responses' | 'messages' | 'gemini' | 'chat'

type ReviewedEntry = {
  provider: HarnessHostedProvider
  model: string
  efforts: readonly HarnessReasoningEffort[]
}

const REVIEWED_ENTRIES: readonly ReviewedEntry[] = [
  { provider: 'opencode-zen', model: 'gpt-5.6-sol', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-fable-5-1', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-fable-5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-opus-5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-opus-4-8', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-opus-4-7', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-opus-4-6', efforts: ['low', 'medium', 'high', 'max'] },
  { provider: 'opencode-zen', model: 'claude-opus-4-5', efforts: ['low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'claude-sonnet-5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'opencode-zen', model: 'claude-sonnet-4-6', efforts: ['low', 'medium', 'high', 'max'] },
  { provider: 'opencode-zen', model: 'claude-sonnet-4-5', efforts: [] },
  { provider: 'opencode-zen', model: 'claude-haiku-4-5', efforts: [] },
  { provider: 'opencode-zen', model: 'deepseek-v4-pro', efforts: ['high', 'max'] },
  { provider: 'opencode-zen', model: 'deepseek-v4-flash', efforts: ['low', 'high', 'max'] },
  { provider: 'opencode-zen', model: 'gemini-3.8-flash', efforts: ['low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3.7-flash', efforts: ['low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3.6-flash', efforts: ['minimal', 'low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3.5-flash', efforts: ['minimal', 'low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3.5-flash-lite', efforts: ['minimal', 'low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3.1-pro', efforts: ['low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'gemini-3-flash', efforts: ['minimal', 'low', 'medium', 'high'] },
  { provider: 'opencode-zen', model: 'kimi-k2.5', efforts: [] },
  { provider: 'opencode-zen', model: 'qwen3.5-plus', efforts: [] },
  { provider: 'opencode-zen', model: 'qwen3.7-max', efforts: [] },
  { provider: 'opencode-zen', model: 'qwen3.7-plus', efforts: [] },
  { provider: 'opencode-zen', model: 'qwen3.6-plus', efforts: [] },
  { provider: 'opencode-zen', model: 'minimax-m3', efforts: [] },
  { provider: 'opencode-zen', model: 'minimax-m2.7', efforts: [] },
  { provider: 'opencode-zen', model: 'minimax-m2.5', efforts: [] },
]

const entriesByKey = new Map(REVIEWED_ENTRIES.map(entry => [`${entry.provider}\u0000${entry.model}`, entry]))

type OpenCodeZenAnthropicWire = 'adaptive' | 'budget'
const OPENCODE_ZEN_ANTHROPIC_WIRE_BY_MODEL = new Map<string, OpenCodeZenAnthropicWire>([
  ['claude-fable-5-1', 'adaptive'],
  ['claude-fable-5', 'adaptive'],
  ['claude-opus-5', 'adaptive'],
  ['claude-opus-4-8', 'adaptive'],
  ['claude-opus-4-7', 'adaptive'],
  ['claude-opus-4-6', 'adaptive'],
  ['claude-opus-4-5', 'budget'],
  ['claude-sonnet-5', 'adaptive'],
  ['claude-sonnet-4-6', 'adaptive'],
  ['claude-sonnet-4-5', 'budget'],
  ['claude-haiku-4-5', 'budget'],
])
const OPENCODE_ZEN_ANTHROPIC_SUMMARY_MODELS = new Set([
  'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5',
])

/** Exact model IDs from OpenCode's published Zen endpoint table. Unknown IDs
 * deliberately stay unresolved until their transport has been reviewed. */
const OPENCODE_ZEN_TRANSPORT_BY_MODEL = new Map<string, HarnessOpenCodeZenTransport>([
  ...[
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
    'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'grok-4.6', 'grok-4.5', 'grok-build-0.1', 'muse-spark-1.2', 'muse-spark-1.3-contributor-free', 'muse-spark-1.2-contributor-free',
  ].map(model => [model, 'responses'] as [string, HarnessOpenCodeZenTransport]),
  ...[
    'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
    'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus',
  ].map(model => [model, 'messages'] as [string, HarnessOpenCodeZenTransport]),
  ...[
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro', 'gemini-3-flash',
  ].map(model => [model, 'gemini'] as [string, HarnessOpenCodeZenTransport]),
  ...[
    'deepseek-v4-pro', 'deepseek-v4-flash', 'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'glm-5.2', 'glm-5.1', 'glm-5', 'kimi-k2.5', 'kimi-k2.6',
    'kimi-k2.7-code', 'kimi-k3', 'big-pickle', 'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free',
  ].map(model => [model, 'chat'] as [string, HarnessOpenCodeZenTransport]),
])

/** Exact reviewed provider/model records. Model names are keys, never hints. */
export function reviewedReasoningCapability(route: string, model: string): HarnessReasoningCapability | undefined {
  const provider = (Object.keys({ openai: 1, anthropic: 1, gemini: 1, openrouter: 1, 'opencode-zen': 1 }) as HarnessHostedProvider[]).find(item => hostedProviderRoute(item) === route)
  if (!provider) return undefined
  const entry = entriesByKey.get(`${provider}\u0000${model}`)
  return entry ? { efforts: [...entry.efforts], source: 'catalog', automatic: true } : undefined
}

export function reviewedOpenCodeZenTransport(model: string): HarnessOpenCodeZenTransport | undefined {
  return OPENCODE_ZEN_TRANSPORT_BY_MODEL.get(model)
}

/** Exact OpenCode Zen native wire shapes for reviewed model/effort pairs. The
 * adapter must not derive these from model-name substrings or generic effort
 * aliases; an unreviewed pair remains unsupported. */
export function reviewedOpenCodeZenReasoningConfig(model: string, effort: HarnessReasoningEffort): Record<string, unknown> | undefined {
  const transport = reviewedOpenCodeZenTransport(model)
  if (transport === 'chat') return { reasoning_effort: effort }
  const entry = entriesByKey.get(`opencode-zen\u0000${model}`)
  if (transport === 'gemini' && entry?.efforts.includes(effort)) {
    return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
  }
  if (transport === 'messages') {
    const wire = OPENCODE_ZEN_ANTHROPIC_WIRE_BY_MODEL.get(model)
    if (!wire) return undefined
    if (wire === 'adaptive' && entry?.efforts.includes(effort)) {
      return { thinking: { type: 'adaptive', ...(OPENCODE_ZEN_ANTHROPIC_SUMMARY_MODELS.has(model) ? { display: 'summarized' } : {}) }, effort }
    }
    if (wire === 'budget') {
      const match = /(?:budget|thinking[-_:./]?budget|tokens?)[^0-9]*(\d{2,6})$/iu.exec(effort) ?? /^(\d{2,6})$/u.exec(effort)
      const budget = match ? Number(match[1]) : NaN
      if (Number.isSafeInteger(budget) && budget >= 256 && budget <= 1_000_000) return { thinking: { type: 'enabled', budget_tokens: budget } }
      if (entry?.efforts.includes(effort)) return { thinking: { type: 'enabled', budget_tokens: 16_000 } }
    }
  }
  return undefined
}

/** Reserved seam for individually reviewed local/OSS variant records. Empty
 * until a model-specific record has been verified and licensed for inclusion. */
export function reviewedOssReasoningCapability(_route: string, _model: string): HarnessReasoningCapability | undefined {
  return undefined
}
