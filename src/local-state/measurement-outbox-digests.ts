import { createHash } from 'node:crypto'

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('outbox canonical JSON accepts only finite safe integers')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  throw new Error('outbox canonical JSON cannot encode this value')
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function eventDigest(event: unknown): string {
  return sha256(canonicalJson(event))
}

export function semanticEventDigest(event: unknown): string {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('measurement event is not an object')
  }
  const value = event as Record<string, unknown>
  const data = value.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('measurement event data is not an object')
  }
  const dataValue = data as Record<string, unknown>
  const collector = dataValue.collector
  if (collector === null || typeof collector !== 'object' || Array.isArray(collector)) {
    throw new Error('measurement event collector is not an object')
  }
  const collectorValue = collector as Record<string, unknown>
  const {
    id: _eventId,
    data: _data,
    ...eventWithoutRotatingIdAndData
  } = value
  const {
    collector: _collector,
    ...dataWithoutCollector
  } = dataValue
  const {
    adapterVersion: _adapterVersion,
    ...collectorWithoutReleaseVersion
  } = collectorValue

  // The endpoint HMAC key and the Metrora release may rotate while the source
  // measurement remains identical. Both public event ID and adapterVersion are
  // therefore excluded from the private receipt's semantic collision check.
  // Evidence profile, source kind/fingerprint, token/cost facts, scope,
  // provider/model identity, disclosure and every other public field remain
  // strictly bound.
  return sha256(canonicalJson({
    ...eventWithoutRotatingIdAndData,
    data: {
      ...dataWithoutCollector,
      collector: collectorWithoutReleaseVersion,
    },
  }))
}
