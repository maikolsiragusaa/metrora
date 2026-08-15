/**
 * Canonical model-vendor identities used only for presentation branding.
 *
 * These ids are deliberately separate from modelProvider/providerId, which
 * describe the factual delivery route or provenance. A route such as
 * amazon-bedrock can deliver an Anthropic model, while a collector such as
 * codex is not itself a model vendor.
 */
export const MODEL_BRAND_IDS = ['openai', 'anthropic', 'google', 'zai'] as const
export type ModelBrandId = typeof MODEL_BRAND_IDS[number]

const MODEL_BRAND_ID_SET = new Set<string>(MODEL_BRAND_IDS)

const OWNER_TO_BRAND: Record<string, ModelBrandId> = {
  anthropic: 'anthropic',
  google: 'google',
  openai: 'openai',
  zai: 'zai',
  'z.ai': 'zai',
  'zai-org': 'zai',
}

/** Accept only the bounded canonical ids emitted by the Desktop core. */
export function normalizeModelBrandId(value: unknown): ModelBrandId | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_BRAND_ID_SET.has(normalized) ? normalized as ModelBrandId : undefined
}

function brandFromCanonicalIdentity(value: string): ModelBrandId | undefined {
  const canonical = value.trim().toLowerCase()
  if (!canonical) return undefined

  // These prefixes are the reviewed model-vendor identities already used by
  // Metrora's canonical pricing/display identity. They are intentionally
  // narrower than a generic display-name search.
  if (/^(?:openai[.-])?(?:gpt|o[1-4])(?:-|$)/.test(canonical)) return 'openai'
  if (/^(?:anthropic[.-])?claude(?:-|$)/.test(canonical)) return 'anthropic'
  if (/^(?:google[.-])?gemini(?:-|$)/.test(canonical)) return 'google'
  if (/^(?:zai(?:-org)?[.-])?glm(?:-|$)/.test(canonical)) return 'zai'
  return undefined
}

export type ModelBrandEvidence = {
  /** Canonical pricing/model identity, never a display label. */
  canonicalIdentity?: string
  /** Factual owner authority, when a producer has preserved it. */
  modelOwner?: string
}

/**
 * Resolve a model-vendor brand from Desktop-owned evidence only.
 *
 * `modelOwner` is stronger than the canonical id when present. In its
 * absence, the canonical identity is checked against the small reviewed
 * family allow-list. Provider/route ids are intentionally not accepted as a
 * fallback: a route alone does not prove which model vendor was used.
 */
export function resolveModelBrandId(evidence: ModelBrandEvidence): ModelBrandId | undefined {
  const owner = evidence.modelOwner?.trim().toLowerCase()
  if (owner && OWNER_TO_BRAND[owner]) return OWNER_TO_BRAND[owner]
  return evidence.canonicalIdentity ? brandFromCanonicalIdentity(evidence.canonicalIdentity) : undefined
}
