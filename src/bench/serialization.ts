import { createHash } from 'node:crypto'

/**
 * Small canonical JSON encoder for the JSON-safe values used by BenchRunV1.
 * Object keys are sorted; array order remains meaningful.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('BenchRunV1 cannot hash a non-finite number')
    return JSON.stringify(value)
  }
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error(`BenchRunV1 cannot hash value of type ${typeof value}`)
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function sha256Json(value: unknown): string {
  return sha256Text(canonicalJson(value))
}
