import { createHash, randomBytes } from 'node:crypto'

import type { ProviderName } from './types'

/** Process-local identity evidence used only to gate factual retention. */
export type IdentityObservation =
  | { state: 'known'; key: string }
  | { state: 'unknown' }

// A per-process salt keeps the comparison value non-linkable across app runs.
// The value is intentionally never persisted, logged, or exposed to consumers.
const PROCESS_SALT = randomBytes(32)

export function unknownIdentity(): IdentityObservation {
  return { state: 'unknown' }
}

export function knownIdentity(provider: ProviderName, ...parts: readonly string[]): IdentityObservation {
  if (parts.length === 0 || parts.some(part => !part.trim())) return unknownIdentity()

  const hash = createHash('sha256')
    .update('metrora-quota-identity-v1\0')
    .update(PROCESS_SALT)
    .update(`\0${provider}\0`)
  for (const part of parts) hash.update(`${part.length}:`).update(part)
  return { state: 'known', key: hash.digest('base64url') }
}

export function sameIdentity(left: IdentityObservation, right: IdentityObservation): boolean {
  return left.state === 'known' && right.state === 'known' && left.key === right.key
}
