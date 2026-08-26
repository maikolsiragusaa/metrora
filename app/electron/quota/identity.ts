import { createHash, randomBytes } from 'node:crypto'

import type { ProviderName } from './types'

/** Process-local identity evidence kept inside the quota service boundary. */
export type IdentityObservation =
  | { state: 'known'; key: string; capability: 'retention' | 'continuity' }
  | { state: 'unknown' }

// A per-process salt keeps the comparison value non-linkable across app runs.
// The value is intentionally never persisted, logged, or exposed to consumers.
const PROCESS_SALT = randomBytes(32)

export function unknownIdentity(): IdentityObservation {
  return { state: 'unknown' }
}

export function knownIdentity(provider: ProviderName, ...parts: readonly string[]): IdentityObservation {
  return makeIdentity('retention', provider, parts)
}

export function knownContinuityIdentity(provider: ProviderName, ...parts: readonly string[]): IdentityObservation {
  return makeIdentity('continuity', provider, parts)
}

function makeIdentity(capability: 'retention' | 'continuity', provider: ProviderName, parts: readonly string[]): IdentityObservation {
  if (parts.length === 0 || parts.some(part => !part.trim())) return unknownIdentity()

  const hash = createHash('sha256')
    .update('metrora-quota-identity-v1\0')
    .update(PROCESS_SALT)
    .update(`\0${provider}\0`)
  for (const part of parts) hash.update(`${part.length}:`).update(part)
  return { state: 'known', key: hash.digest('base64url'), capability }
}

export function isRetentionSafe(identity: IdentityObservation): boolean {
  return identity.state === 'known' && identity.capability === 'retention'
}

export function sameIdentity(left: IdentityObservation, right: IdentityObservation): boolean {
  return left.state === 'known'
    && right.state === 'known'
    && left.capability === right.capability
    && left.key === right.key
}
