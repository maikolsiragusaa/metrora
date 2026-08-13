import { createHash } from 'node:crypto'

export function canonicalAnalyticsGenerationIdSha256V1(input: {
  sessionPayloadSha256: string
  dailyPayloadSha256: string
  sourceManifestSha256: string
}): string {
  return createHash('sha256')
    .update('metrora-analytics-refresh-generation-v1\0')
    .update(input.sessionPayloadSha256)
    .update('\0')
    .update(input.dailyPayloadSha256)
    .update('\0')
    .update(input.sourceManifestSha256)
    .digest('hex')
}

/**
 * Path-free fingerprint for one canonical source record.
 *
 * The durable local endpoint id keeps otherwise identical source records on
 * different endpoints from colliding. The private deduplication key never
 * leaves this trusted boundary.
 */
export function canonicalSourceRecordFingerprintSha256V1(input: {
  endpointId: string
  provider: string
  privateDeduplicationKey: string
}): string {
  if (input.privateDeduplicationKey.length === 0) {
    throw new Error('canonical source record has an empty private deduplication key')
  }
  return createHash('sha256')
    .update('metrora-canonical-source-record-v1\0')
    .update(input.endpointId)
    .update('\0')
    .update(input.provider)
    .update('\0')
    .update(input.privateDeduplicationKey)
    .digest('hex')
}
