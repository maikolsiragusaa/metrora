/**
 * Metrora-owned projection of the reviewed Models.dev snapshot. The upstream
 * TOML/JSON is intentionally not copied into the product: only the bounded
 * capability facts needed for discovery are retained here.
 *
 * The Muse provider entry is resolved through the reviewed catalog's
 * `base_model` deep-merge semantics: its core capabilities and limits come
 * from `models/meta/muse-spark-1.2.toml`, while the OpenCode override supplies
 * the free-host name, effort vocabulary, cost, and provider package.
 */
export const MODELS_DEV_SNAPSHOT_REVISION = '03c2631946bb7ce2735e8e37d04197c4b910ff66' as const
export const MODELS_DEV_SNAPSHOT_SOURCE = 'anomalyco/models.dev' as const
export const MODELS_DEV_SNAPSHOT_CAPTURED_AT = '2026-09-02' as const

export type ReviewedModelsDevCapability = {
  provider: 'opencode-zen'
  model: string
  protocol: 'openai-chat' | 'openai-responses'
  toolCall: 'supported'
  reasoning: true
  reasoningEfforts: readonly string[]
  reasoningParameter: 'openai-effort' | 'reasoning-object'
  interleavedField?: 'reasoning_content'
  contextTokens: number
  outputTokens: number
}

const REVIEWED_CAPABILITIES: readonly ReviewedModelsDevCapability[] = [
  {
    provider: 'opencode-zen',
    model: 'mimo-v2.5-free',
    protocol: 'openai-chat',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default'],
    reasoningParameter: 'openai-effort',
    interleavedField: 'reasoning_content',
    contextTokens: 200_000,
    outputTokens: 32_000,
  },
  {
    provider: 'opencode-zen',
    model: 'muse-spark-1.2-contributor-free',
    protocol: 'openai-responses',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    reasoningParameter: 'reasoning-object',
    contextTokens: 1_048_576,
    outputTokens: 131_072,
  },
  {
    provider: 'opencode-zen',
    model: 'nemotron-3-ultra-free',
    protocol: 'openai-chat',
    toolCall: 'supported',
    reasoning: true,
    reasoningEfforts: ['default'],
    reasoningParameter: 'openai-effort',
    interleavedField: 'reasoning_content',
    contextTokens: 1_000_000,
    outputTokens: 128_000,
  },
]

export function reviewedModelsDevCapability(provider: string, model: string): ReviewedModelsDevCapability | null {
  if (provider !== 'opencode-zen') return null
  const id = model.replace(/^models\//u, '')
  return REVIEWED_CAPABILITIES.find(item => item.model === id) ?? null
}

export function reviewedModelsDevMetadata(capability: ReviewedModelsDevCapability): Record<string, unknown> {
  return {
    reasoning: capability.reasoning,
    reasoning_options: [{ type: 'effort', values: [...capability.reasoningEfforts].filter(value => value !== 'default') }],
    reasoningParameter: capability.reasoningParameter,
    tool_call: capability.toolCall === 'supported',
    ...(capability.interleavedField ? { interleaved: { field: capability.interleavedField } } : {}),
  }
}
