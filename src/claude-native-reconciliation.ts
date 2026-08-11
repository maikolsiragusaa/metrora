import type { CachedCall } from './session-cache.js'

/**
 * A Claude JSONL message id is a native accounting identity, not a file-local
 * key. A parent transcript and a sidechain/mirror can therefore contain two
 * snapshots of one API response. This comparator deliberately uses only
 * evidence carried by the native snapshot:
 *
 *   1. later native emission timestamp;
 *   2. a native terminal marker when timestamps tie;
 *   3. a stable path/ordinal tie-break only when the accounting tuple is
 *      already identical (or when an ambiguity is explicitly recorded).
 *
 * It never takes a maximum per field, adds duplicate snapshots, or lets file
 * discovery order decide the accounting winner.
 */
export type ClaudeNativeCallCandidate = {
  filePath: string
  call: CachedCall
  ordinal: number
}

export type ClaudeNativeIdentityAmbiguity = {
  identity: string
  candidates: ClaudeNativeCallCandidate[]
}

export type ClaudeNativeReconciliation = {
  winners: Map<string, ClaudeNativeCallCandidate>
  ambiguities: ClaudeNativeIdentityAmbiguity[]
}

export function getClaudeNativeIdentity(call: Pick<CachedCall, 'provider' | 'deduplicationKey' | 'nativeMessageId'>): string | undefined {
  if (call.provider !== 'claude') return undefined
  if (call.nativeMessageId) return call.nativeMessageId
  // Support a one-run projection of a pre-migration cache. Advisor calls use a
  // derived `:advisor:` key and are deliberately excluded from this fallback.
  if (call.deduplicationKey.startsWith('claude:') || call.deduplicationKey.includes(':advisor:')) return undefined
  return call.deduplicationKey || undefined
}

function nativeAccountingTuple(call: CachedCall): string {
  return JSON.stringify({
    model: call.model,
    modelProvider: call.modelProvider ?? null,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    cacheCreationInputTokens: call.usage.cacheCreationInputTokens,
    cacheReadInputTokens: call.usage.cacheReadInputTokens,
    cachedInputTokens: call.usage.cachedInputTokens,
    reasoningTokens: call.usage.reasoningTokens,
    webSearchRequests: call.usage.webSearchRequests,
    cacheCreationOneHourTokens: call.usage.cacheCreationOneHourTokens,
  })
}

function nativeEmissionMs(call: CachedCall): number | undefined {
  const raw = call.nativeEmissionTimestamp ?? call.timestamp
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : undefined
}

function nativeStableKey(candidate: ClaudeNativeCallCandidate): string {
  const path = candidate.filePath.replace(/\\/g, '/').toLowerCase()
  return `${path}\u0000${String(candidate.ordinal).padStart(12, '0')}\u0000${nativeAccountingTuple(candidate.call)}`
}

/** Positive when `a` has stronger native chronology/finality evidence. */
function compareNativeEvidence(a: ClaudeNativeCallCandidate, b: ClaudeNativeCallCandidate): number {
  const aMs = nativeEmissionMs(a.call)
  const bMs = nativeEmissionMs(b.call)
  if (aMs !== undefined && bMs !== undefined && aMs !== bMs) return aMs > bMs ? 1 : -1
  if (aMs !== undefined && bMs === undefined) return 1
  if (aMs === undefined && bMs !== undefined) return -1
  const aTerminal = a.call.nativeSnapshotTerminal === true
  const bTerminal = b.call.nativeSnapshotTerminal === true
  if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
  return 0
}

export function reconcileClaudeNativeCalls(
  files: ReadonlyArray<{ filePath: string; calls: readonly CachedCall[] }>,
): ClaudeNativeReconciliation {
  const groups = new Map<string, ClaudeNativeCallCandidate[]>()
  for (const file of files) {
    let ordinal = 0
    for (const call of file.calls) {
      const identity = getClaudeNativeIdentity(call)
      if (!identity) continue
      const group = groups.get(identity) ?? []
      group.push({ filePath: file.filePath, call, ordinal: ordinal++ })
      groups.set(identity, group)
    }
  }

  const winners = new Map<string, ClaudeNativeCallCandidate>()
  const ambiguities: ClaudeNativeIdentityAmbiguity[] = []
  for (const [identity, candidates] of groups) {
    const ranked = [...candidates].sort((a, b) => {
      const evidence = compareNativeEvidence(b, a)
      return evidence !== 0 ? evidence : nativeStableKey(a).localeCompare(nativeStableKey(b))
    })
    const winner = ranked[0]
    if (!winner) continue
    const equallyAuthoritative = candidates.filter(candidate => compareNativeEvidence(candidate, winner) === 0)
    const tuples = new Set(equallyAuthoritative.map(candidate => nativeAccountingTuple(candidate.call)))
    if (tuples.size > 1) ambiguities.push({ identity, candidates: equallyAuthoritative })
    winners.set(identity, winner)
  }
  return { winners, ambiguities }
}
