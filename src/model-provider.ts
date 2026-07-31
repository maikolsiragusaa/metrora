const MODEL_PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MODEL_PROVIDER_ID_MAX_LENGTH = 80

/**
 * Normalize only a provider identifier that the source recorded explicitly.
 *
 * This helper deliberately does not inspect collector names or model labels.
 * Invalid, empty, or non-string values become undefined so a malformed source
 * cannot create a provider claim.
 */
export function normalizeExplicitModelProvider(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.length > MODEL_PROVIDER_ID_MAX_LENGTH) return undefined
  return MODEL_PROVIDER_ID_PATTERN.test(normalized) ? normalized : undefined
}
