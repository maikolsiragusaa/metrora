export function sanitizeProject(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-')
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

export function finiteTimestamp(value: unknown): string | undefined {
  const timestamp = nonEmptyString(value)
  if (!timestamp) return undefined
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined
}
