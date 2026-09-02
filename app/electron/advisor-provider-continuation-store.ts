import { randomUUID } from 'node:crypto'

import type { AdvisorHostedContinuationReference } from './advisor-provider-contract'
import {
  MAX_HOSTED_CONTINUATION_PAYLOAD_BYTES,
  normalizeHostedContinuationReference,
  normalizeHostedContinuationPayload,
  type AdvisorHostedContinuationPayload,
} from './advisor-provider-continuation'

/** One active Harness tool turn is the only supported lifetime for this store. */
export const MAX_LIVE_HOSTED_CONTINUATIONS = 8
export const MAX_HOSTED_CONTINUATION_STORE_BYTES = 256 * 1024
export const HOSTED_CONTINUATION_TTL_MS = 60_000

export type HostedContinuationIdentity = Pick<AdvisorHostedContinuationReference, 'provider' | 'model' | 'protocol' | 'adapter'>

type HostedContinuationStoreEntry = {
  reference: AdvisorHostedContinuationReference
  payload: AdvisorHostedContinuationPayload
  bytes: number
  expiresAt: number
  inUse: boolean
}

export type HostedContinuationStore = {
  /** Normalize and retain a main-process payload, returning only its reference. */
  put: (payload: unknown) => AdvisorHostedContinuationReference | null
  /** Acquire a matching entry for one provider attempt. */
  acquire: (reference: AdvisorHostedContinuationReference, expected: HostedContinuationIdentity) => AdvisorHostedContinuationPayload | null
  /** Keep an acquired entry available after a retryable provider failure. */
  release: (reference: AdvisorHostedContinuationReference) => void
  /** Remove an entry after cancellation, terminal completion, or cleanup. */
  retire: (reference: AdvisorHostedContinuationReference, expected?: HostedContinuationIdentity) => void
  /** Atomically replace an acquired entry after a successful provider step. */
  replace: (previous: AdvisorHostedContinuationReference | undefined, payload: unknown) => AdvisorHostedContinuationReference | null
  /** Clear all in-memory provider-native state. */
  clear: () => void
  /** Stop the expiry timer and clear all in-memory provider-native state. */
  dispose: () => void
  /** Non-sensitive bounded diagnostics for tests and lifecycle checks. */
  stats: () => { entries: number; bytes: number }
}

function sameIdentity(left: HostedContinuationIdentity, right: HostedContinuationIdentity): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.protocol === right.protocol
    && left.adapter === right.adapter
}

function preparePayload(value: unknown): { payload: AdvisorHostedContinuationPayload; bytes: number } | null {
  const payload = normalizeHostedContinuationPayload(value)
  if (!payload) return null
  try {
    const encoded = JSON.stringify(payload)
    if (!encoded) return null
    const bytes = new TextEncoder().encode(encoded).byteLength
    if (bytes > MAX_HOSTED_CONTINUATION_PAYLOAD_BYTES) return null
    // The normalized subset is JSON-only. Clone it so the store owns the
    // short-lived payload and callers cannot mutate the stored object.
    const cloned = JSON.parse(encoded) as AdvisorHostedContinuationPayload
    return { payload: cloned, bytes }
  } catch {
    return null
  }
}

export function createHostedContinuationStore(options: {
  maxEntries?: number
  maxBytes?: number
  ttlMs?: number
  now?: () => number
  idFactory?: () => string
} = {}): HostedContinuationStore {
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries! > 0 ? options.maxEntries! : MAX_LIVE_HOSTED_CONTINUATIONS
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes! > 0 ? options.maxBytes! : MAX_HOSTED_CONTINUATION_STORE_BYTES
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs! > 0 ? options.ttlMs! : HOSTED_CONTINUATION_TTL_MS
  const now = options.now ?? Date.now
  const idFactory = options.idFactory ?? randomUUID
  const entries = new Map<string, HostedContinuationStoreEntry>()
  let totalBytes = 0
  let disposed = false

  const remove = (id: string): void => {
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id)
    totalBytes = Math.max(0, totalBytes - entry.bytes)
  }
  const prune = (): void => {
    const timestamp = now()
    for (const [id, entry] of entries) {
      // A provider attempt owns its entry until it settles. This prevents a
      // TTL cleanup from making a transient failed attempt unretryable.
      if (!entry.inUse && entry.expiresAt <= timestamp) remove(id)
    }
  }
  const nextReference = (payload: AdvisorHostedContinuationPayload): AdvisorHostedContinuationReference | null => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = idFactory()
      const reference = normalizeHostedContinuationReference({
        id,
        provider: payload.provider,
        model: payload.model,
        protocol: payload.protocol,
        adapter: payload.adapter,
      })
      if (!reference || entries.has(reference.id)) continue
      return Object.freeze(reference)
    }
    return null
  }
  const insertPrepared = (prepared: { payload: AdvisorHostedContinuationPayload; bytes: number }, reference: AdvisorHostedContinuationReference): AdvisorHostedContinuationReference => {
    entries.set(reference.id, {
      reference,
      payload: prepared.payload,
      bytes: prepared.bytes,
      expiresAt: now() + ttlMs,
      inUse: false,
    })
    totalBytes += prepared.bytes
    return reference
  }
  const putPrepared = (prepared: { payload: AdvisorHostedContinuationPayload; bytes: number }): AdvisorHostedContinuationReference | null => {
    if (disposed) return null
    prune()
    if (entries.size >= maxEntries || totalBytes + prepared.bytes > maxBytes) return null
    const reference = nextReference(prepared.payload)
    if (!reference) return null
    return insertPrepared(prepared, reference)
  }
  const timer = setInterval(prune, Math.max(10, Math.min(ttlMs, 5_000)))
  const unref = (timer as unknown as { unref?: () => void }).unref
  unref?.call(timer)
  const clear = (): void => {
    entries.clear()
    totalBytes = 0
  }

  return {
    put: value => {
      const prepared = preparePayload(value)
      return prepared ? putPrepared(prepared) : null
    },
    acquire: (reference, expected) => {
      if (disposed) return null
      const normalizedReference = normalizeHostedContinuationReference(reference)
      if (!normalizedReference) return null
      prune()
      const entry = entries.get(normalizedReference.id)
      if (!entry || entry.inUse || !sameIdentity(normalizedReference, expected) || !sameIdentity(entry.reference, normalizedReference) || entry.expiresAt <= now()) return null
      entry.inUse = true
      return entry.payload
    },
    release: reference => {
      if (disposed) return
      const normalizedReference = normalizeHostedContinuationReference(reference)
      if (!normalizedReference) return
      const entry = entries.get(normalizedReference.id)
      if (!entry) return
      if (entry.expiresAt <= now()) remove(normalizedReference.id)
      else entry.inUse = false
    },
    retire: (reference, expected) => {
      if (disposed) return
      const normalizedReference = normalizeHostedContinuationReference(reference)
      if (!normalizedReference) return
      const entry = entries.get(normalizedReference.id)
      if (!entry) return
      if (sameIdentity(normalizedReference, entry.reference) && (!expected || sameIdentity(entry.reference, expected))) remove(normalizedReference.id)
    },
    replace: (previous, value) => {
      if (disposed) return null
      const prepared = preparePayload(value)
      if (!prepared) return null
      prune()
      const previousReference = previous ? normalizeHostedContinuationReference(previous) : undefined
      if (previous && !previousReference) return null
      const previousEntry = previousReference ? entries.get(previousReference.id) : undefined
      if (previousReference && (!previousEntry || !previousEntry.inUse || !sameIdentity(previousEntry.reference, previousReference))) return null
      const retainedEntries = entries.size - (previousEntry ? 1 : 0)
      const retainedBytes = totalBytes - (previousEntry?.bytes ?? 0)
      if (retainedEntries >= maxEntries || retainedBytes + prepared.bytes > maxBytes) return null
      if (previousEntry) {
        // Generate the replacement before retiring the acquired entry. This
        // keeps a retryable old reference intact if ID allocation fails.
        const reference = nextReference(prepared.payload)
        if (!reference) return null
        remove(previousEntry.reference.id)
        return insertPrepared(prepared, reference)
      }
      return putPrepared(prepared)
    },
    clear,
    dispose: () => {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      clear()
    },
    stats: () => {
      prune()
      return { entries: entries.size, bytes: totalBytes }
    },
  }
}
