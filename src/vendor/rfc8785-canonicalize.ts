/**
 * RFC 8785 JSON Canonicalization Scheme implementation.
 *
 * Adapted from `erdtman/canonicalize` (`lib/canonicalize.js`), licensed under
 * Apache-2.0. Metrora modifications: TypeScript types, named export, explicit
 * unsupported-primitive rejection, and project formatting.
 *
 * Upstream: https://github.com/erdtman/canonicalize
 */

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index === value.length - 1) return true
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

export function canonicalizeRfc8785(value: unknown, seen = new Set<object>()): string {
  if (typeof value === 'number' && Number.isNaN(value)) throw new Error('NaN is not allowed by RFC 8785')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Infinity is not allowed by RFC 8785')
  if (typeof value === 'string' && hasLoneSurrogate(value)) {
    throw new Error('lone surrogate is not allowed by RFC 8785')
  }

  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('value is not JSON serializable')
    return serialized
  }

  const object = value as Record<string, unknown> & { toJSON?: () => unknown }
  if (typeof object.toJSON === 'function') {
    if (seen.has(object)) throw new Error('circular reference detected')
    seen.add(object)
    try {
      return canonicalizeRfc8785(object.toJSON(), seen)
    } finally {
      seen.delete(object)
    }
  }

  if (seen.has(object)) throw new Error('circular reference detected')
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      const values = object.map(item => {
        const normalized = item === undefined || typeof item === 'symbol' ? null : item
        return canonicalizeRfc8785(normalized, seen)
      })
      return `[${values.join(',')}]`
    }

    const parts: string[] = []
    for (const key of Object.keys(object).sort()) {
      const item = object[key]
      if (item === undefined || typeof item === 'symbol') continue
      parts.push(`${canonicalizeRfc8785(key)}:${canonicalizeRfc8785(item, seen)}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(object)
  }
}
