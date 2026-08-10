import { createHash, createPublicKey, verify } from 'node:crypto'

import { canonicalizeRfc8785 } from '../vendor/rfc8785-canonicalize.js'
import {
  LEGACY_MEASUREMENT_BATCH_KIND,
  LEGACY_OUTBOX_EVENT_SOURCE_PREFIX,
  LEGACY_SEMANTIC_CONVENTIONS_KEY,
  LEGACY_SIGNED_BATCH_KIND,
  LEGACY_SOFTWARE_VERSION_FIELD,
  LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  LEGACY_USAGE_MEASUREMENT_EVENT_TYPE,
} from './legacy-identity-compatibility.js'
import {
  normalizeLegacyMeasurementEventV1,
  objectValue,
} from './legacy-outbox-compatibility.js'

export type LegacySignedBatchVerificationOptions = {
  endpointId: string
  workspaceId?: string
  expectedFile: string
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hasLegacySignedBatchMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const signed = value as Record<string, unknown>
  const batch = signed.batch
  if (signed.kind === LEGACY_SIGNED_BATCH_KIND) return true
  if (batch === null || typeof batch !== 'object' || Array.isArray(batch)) return false
  const batchValue = batch as Record<string, unknown>
  const producer = batchValue.producer
  const semantic = batchValue.semanticConventions
  return batchValue.kind === LEGACY_MEASUREMENT_BATCH_KIND
    || (producer !== null && typeof producer === 'object' && LEGACY_SOFTWARE_VERSION_FIELD in producer)
    || (semantic !== null && typeof semantic === 'object' && LEGACY_SEMANTIC_CONVENTIONS_KEY in semantic)
    || (Array.isArray(batchValue.events) && batchValue.events.some(event => {
      if (event === null || typeof event !== 'object' || Array.isArray(event)) return false
      const eventValue = event as Record<string, unknown>
      return eventValue.type === LEGACY_USAGE_MEASUREMENT_EVENT_TYPE
        || eventValue.dataschema === LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI
    }))
}

function normalizeLegacySignedBatch(value: unknown): unknown {
  const signed = objectValue(value, 'legacy signed batch shape is invalid')
  if (signed.kind !== LEGACY_SIGNED_BATCH_KIND) {
    throw new Error('legacy signed batch namespace is not the exact historical form')
  }
  const batch = objectValue(signed.batch, 'legacy signed batch payload is invalid')
  if (batch.kind !== LEGACY_MEASUREMENT_BATCH_KIND) {
    throw new Error('legacy measurement batch namespace is not the exact historical form')
  }
  const producer = objectValue(batch.producer, 'legacy signed batch producer is invalid')
  const semantic = objectValue(batch.semanticConventions, 'legacy signed batch conventions are invalid')
  if (!(LEGACY_SOFTWARE_VERSION_FIELD in producer) || 'metroraVersion' in producer) {
    throw new Error('legacy signed batch producer version field is not the exact historical form')
  }
  if (!(LEGACY_SEMANTIC_CONVENTIONS_KEY in semantic) || 'metrora' in semantic) {
    throw new Error('legacy signed batch convention key is not the exact historical form')
  }
  const { [LEGACY_SOFTWARE_VERSION_FIELD]: legacyVersion, ...producerWithoutLegacyVersion } = producer
  const { [LEGACY_SEMANTIC_CONVENTIONS_KEY]: legacySemantic, ...semanticWithoutLegacyKey } = semantic
  return {
    ...signed,
    kind: 'metrora.local-signed-measurement-batch',
    batch: {
      ...batch,
      kind: 'metrora.measurement-batch',
      producer: { ...producerWithoutLegacyVersion, metroraVersion: legacyVersion },
      semanticConventions: { ...semanticWithoutLegacyKey, metrora: legacySemantic },
      events: Array.isArray(batch.events)
        ? batch.events.map(normalizeLegacyMeasurementEventV1)
        : batch.events,
    },
  }
}

function verifyRawSignature(signature: Record<string, unknown>, payload: string): boolean {
  if (
    signature.algorithm !== 'ed25519'
    || typeof signature.publicKeySpkiBase64 !== 'string'
    || typeof signature.publicKeyFingerprintSha256 !== 'string'
    || typeof signature.signatureBase64 !== 'string'
  ) return false
  const publicKeyBytes = Buffer.from(signature.publicKeySpkiBase64, 'base64')
  if (publicKeyBytes.length === 0 || sha256(publicKeyBytes) !== signature.publicKeyFingerprintSha256) return false
  try {
    const publicKey = createPublicKey({ key: publicKeyBytes, type: 'spki', format: 'der' })
    return verify(
      null,
      Buffer.from(payload, 'utf-8'),
      publicKey,
      Buffer.from(signature.signatureBase64, 'base64'),
    )
  } catch {
    return false
  }
}

function assertLegacySignedBatchEnvelope(
  raw: Record<string, unknown>,
  options: LegacySignedBatchVerificationOptions,
): { batch: Record<string, unknown>; range: Record<string, unknown>; signature: Record<string, unknown> } {
  if (raw.kind !== LEGACY_SIGNED_BATCH_KIND || raw.version !== 1 || raw.canonicalization !== 'RFC8785') {
    throw new Error('legacy signed batch envelope is not the exact historical form')
  }
  const range = objectValue(raw.range, 'legacy signed batch range is invalid')
  const firstSequence = range.firstSequence
  const lastSequence = range.lastSequence
  const eventCount = range.eventCount
  if (
    typeof firstSequence !== 'number' || !Number.isSafeInteger(firstSequence) || firstSequence < 1
    || typeof lastSequence !== 'number' || !Number.isSafeInteger(lastSequence) || lastSequence < 1
    || typeof eventCount !== 'number' || !Number.isSafeInteger(eventCount) || eventCount < 1
    || firstSequence > lastSequence
  ) throw new Error('legacy signed batch range is invalid')
  for (const field of ['batchSha256', 'signedPayloadSha256'] as const) {
    if (typeof raw[field] !== 'string' || !/^[a-f0-9]{64}$/.test(raw[field])) {
      throw new Error('legacy signed batch digest field is invalid')
    }
  }
  const batch = objectValue(raw.batch, 'legacy signed batch payload is invalid')
  if (batch.kind !== LEGACY_MEASUREMENT_BATCH_KIND || batch.version !== 1) {
    throw new Error('legacy measurement batch namespace is not the exact historical form')
  }
  const producer = objectValue(batch.producer, 'legacy signed batch producer is invalid')
  if (
    typeof producer.endpointId !== 'string'
    || typeof producer[LEGACY_SOFTWARE_VERSION_FIELD] !== 'string'
    || typeof producer.adapterSetSha256 !== 'string'
  ) throw new Error('legacy signed batch producer is invalid')
  const semantic = objectValue(batch.semanticConventions, 'legacy signed batch conventions are invalid')
  if (
    typeof semantic.cloudEvents !== 'string'
    || !(LEGACY_SEMANTIC_CONVENTIONS_KEY in semantic)
    || semantic[LEGACY_SEMANTIC_CONVENTIONS_KEY] !== '1'
  ) throw new Error('legacy signed batch conventions are invalid')
  const events = batch.events
  if (!Array.isArray(events) || events.length !== eventCount) {
    throw new Error('legacy signed batch event count is invalid')
  }
  if (producer.endpointId !== options.endpointId) throw new Error('signed batch belongs to another endpoint')
  for (const event of events) {
    const eventValue = objectValue(event, 'legacy signed batch event is invalid')
    const data = objectValue(eventValue.data, 'legacy signed batch event data is invalid')
    if (
      typeof eventValue.id !== 'string'
      || eventValue.source !== `${LEGACY_OUTBOX_EVENT_SOURCE_PREFIX}${String(data.endpointId)}`
      || eventValue.type !== LEGACY_USAGE_MEASUREMENT_EVENT_TYPE
      || eventValue.dataschema !== LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI
      || data.endpointId !== options.endpointId
      || (options.workspaceId !== undefined && data.workspaceId !== options.workspaceId)
    ) throw new Error('legacy signed batch contains an event outside its binding')
  }
  const signature = objectValue(raw.signature, 'legacy signed batch signature is invalid')
  if (typeof signature.identityGeneration !== 'number' || signature.identityGeneration < 1) {
    throw new Error('legacy signed batch signature is invalid')
  }
  return { batch, range, signature }
}

export function verifyLegacySignedBatch(
  value: unknown,
  options: LegacySignedBatchVerificationOptions,
): unknown {
  const raw = objectValue(value, 'legacy signed batch shape is invalid')
  const { batch: rawBatch, range, signature } = assertLegacySignedBatchEnvelope(raw, options)
  const rawBatchDigest = sha256(canonicalizeRfc8785(rawBatch))
  if (raw.batchSha256 !== rawBatchDigest) {
    throw new Error('legacy signed batch digest does not match its historical RFC 8785 payload')
  }
  const signedPayload = canonicalizeRfc8785({
    canonicalization: raw.canonicalization,
    range,
    batchSha256: raw.batchSha256,
    batch: rawBatch,
  })
  if (raw.signedPayloadSha256 !== sha256(signedPayload)) {
    throw new Error('legacy signed payload digest is invalid')
  }
  if (!verifyRawSignature(signature, signedPayload)) {
    throw new Error('legacy signed batch signature is invalid')
  }
  const expectedFile = `${String(range.firstSequence).padStart(16, '0')}-${String(range.lastSequence).padStart(16, '0')}-${raw.batchSha256}.json`
  if (expectedFile !== options.expectedFile) {
    throw new Error('signed batch filename does not match its payload')
  }
  return normalizeLegacySignedBatch(raw)
}
