import { createHash } from 'node:crypto'

/**
 * Local analytics history namespace. This is deliberately not a Workspace
 * endpoint identity: canonical history publication belongs to the analytics
 * lifecycle and must remain available before a Workspace exists.
 */
export const CANONICAL_ANALYTICS_HISTORY_SCOPE_ID_V1 = 'ep_metrora-analytics-history-v1' as const

/**
 * Path-free fingerprint for one canonical source record.
 *
 * The scope id keeps otherwise identical local records from different
 * analytics namespaces from colliding. The private deduplication key never
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
