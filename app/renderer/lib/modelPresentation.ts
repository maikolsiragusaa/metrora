import type { DurableModelPresentationRow } from './model-projection-types'

/**
 * A model house is the vendor identity of the model family (OpenAI, Z.ai,
 * Anthropic, ...). It is intentionally separate from the delivery provider
 * and from the Metrora client/source that recorded the usage.
 */
export type ModelHouseId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'zai'
  | 'deepseek'
  | 'qwen'
  | 'moonshot'
  | 'mistral'
  | 'xai'
  | 'meta'
  | 'cohere'
  | 'microsoft'
  | 'minimax'
  | 'ai21'
  | 'unresolved'

const MODEL_HOUSE_LABELS: Record<ModelHouseId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  zai: 'Z.ai',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
  mistral: 'Mistral',
  xai: 'xAI',
  meta: 'Meta',
  cohere: 'Cohere',
  microsoft: 'Microsoft',
  minimax: 'MiniMax',
  ai21: 'AI21',
  unresolved: 'Other model houses',
}

const MODEL_HOUSE_ALIASES: Record<string, ModelHouseId> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  zai: 'zai',
  'z.ai': 'zai',
  'z-ai': 'zai',
  'zai-org': 'zai',
  deepseek: 'deepseek',
  'deepseek-ai': 'deepseek',
  qwen: 'qwen',
  moonshot: 'moonshot',
  moonshotai: 'moonshot',
  'moonshot-ai': 'moonshot',
  mistral: 'mistral',
  'mistral-ai': 'mistral',
  xai: 'xai',
  'x.ai': 'xai',
  'x-ai': 'xai',
  grok: 'xai',
  meta: 'meta',
  'meta-ai': 'meta',
  cohere: 'cohere',
  microsoft: 'microsoft',
  minimax: 'minimax',
  'minimax-ai': 'minimax',
  ai21: 'ai21',
  'ai21-labs': 'ai21',
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[._\s]+/g, '-')
}

/** Accept only the known canonical model-house ids emitted by the core. */
export function normalizeModelHouseId(value: string | undefined): ModelHouseId | undefined {
  if (!value) return undefined
  return MODEL_HOUSE_ALIASES[normalized(value)]
}

/** Conservative fallback for older payloads that predate `brandId`. */
export function modelHouseIdFromName(value: string): ModelHouseId | undefined {
  const model = normalized(value)
  if (!model) return undefined
  if (/(?:^|[-/:])(?:gpt|codex)(?:[-/:]|$)/.test(model) || /(?:^|[-/:])o[134](?:[-/:]|$)/.test(model)) return 'openai'
  if (/(?:^|[-/:])claude(?:[-/:]|$)/.test(model)) return 'anthropic'
  if (/(?:^|[-/:])(?:gemini|gemma)(?:[-/:]|$)/.test(model)) return 'google'
  if (/(?:^|[-/:])(?:glm|zai)(?:[-/:]|$)/.test(model)) return 'zai'
  if (/(?:^|[-/:])deepseek(?:[-/:]|$)/.test(model)) return 'deepseek'
  if (/(?:^|[-/:])qwen(?:[-/:]|\d|$)/.test(model)) return 'qwen'
  if (/(?:^|[-/:])(?:kimi|moonshot)(?:[-/:]|\d|$)/.test(model)) return 'moonshot'
  if (/(?:^|[-/:])(?:mistral|ministral|pixtral)(?:[-/:]|\d|$)/.test(model)) return 'mistral'
  if (/(?:^|[-/:])(?:grok|xai)(?:[-/:]|\d|$)/.test(model)) return 'xai'
  if (/(?:^|[-/:])(?:llama|meta)(?:[-/:]|\d|$)/.test(model)) return 'meta'
  if (/(?:^|[-/:])(?:command|aya|cohere)(?:[-/:]|\d|$)/.test(model)) return 'cohere'
  if (/(?:^|[-/:])(?:phi|microsoft)(?:[-/:]|\d|$)/.test(model)) return 'microsoft'
  if (/(?:^|[-/:])minimax(?:[-/:]|\d|$)/.test(model)) return 'minimax'
  if (/(?:^|[-/:])(?:jamba|ai21)(?:[-/:]|\d|$)/.test(model)) return 'ai21'
  return undefined
}

/** Resolve the model house without ever treating a delivery route as proof of ownership. */
export function modelHouseValues(row: Pick<DurableModelPresentationRow, 'brandId' | 'name' | 'rawModels'>): ModelHouseId[] {
  const explicit = normalizeModelHouseId(row.brandId)
  if (explicit) return [explicit]
  const inferred = [...new Set([row.name, ...row.rawModels].map(modelHouseIdFromName).filter((value): value is ModelHouseId => value !== undefined))]
  return inferred.length > 0 ? inferred : ['unresolved']
}

export function modelHouseLabel(value: ModelHouseId): string {
  return MODEL_HOUSE_LABELS[value]
}

/** ProviderLogo keys for model-house branding; unknown houses use its initial fallback. */
export function modelHouseLogoKey(value: ModelHouseId): string {
  if (value === 'openai') return 'codex'
  if (value === 'anthropic') return 'claude'
  if (value === 'google') return 'gemini'
  if (value === 'moonshot') return 'kimi'
  if (value === 'mistral') return 'mistral-vibe'
  if (value === 'xai') return 'grok'
  return value
}
