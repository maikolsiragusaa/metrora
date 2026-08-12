import type { SessionSummary } from './types.js'

type EvidenceEnvelope = {
  refs: string[]
  minMs: number
  maxMs: number
}

export type CwdEvidenceIndex = Map<string, Map<string, EvidenceEnvelope>>

export function normalizedWorkingDirectory(path: string | undefined): string | null {
  if (!path?.trim()) return null
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function turnTimestampMs(turn: SessionSummary['turns'][number]): number {
  return Date.parse(turn.assistantCalls[0]?.timestamp || turn.timestamp)
}

function evidenceTimestamps(session: SessionSummary, refs: readonly string[]): number[] {
  if (refs.length !== 1) return []

  // Launcher and native sidechain linkage already proved the PR association,
  // but do not carry an exact transcript turn ref on the linked session.
  if (session.prAttributionSource === 'launcher-prompt' || !session.prLinks?.length) {
    const atMs = Date.parse(session.firstTimestamp)
    return Number.isFinite(atMs) ? [atMs] : []
  }

  const key = refs[0]!
  const observed: number[] = []
  for (const turn of session.turns) {
    if (turn.prRefs?.length !== 1 || turn.prRefs[0] !== key) continue
    const atMs = turnTimestampMs(turn)
    if (Number.isFinite(atMs)) observed.push(atMs)
  }
  return observed
}

export function buildCwdEvidenceIndex(
  evidence: Iterable<readonly [SessionSummary, readonly string[]]>,
): CwdEvidenceIndex {
  const byCwd: CwdEvidenceIndex = new Map()
  for (const [session, refsInput] of evidence) {
    const cwd = normalizedWorkingDirectory(session.workingDirectory)
    const refs = [...new Set(refsInput)].sort()
    if (!cwd || refs.length !== 1) continue
    const timestamps = evidenceTimestamps(session, refs)
    if (timestamps.length === 0) continue
    const key = refs.join('\0')
    const envelopes = byCwd.get(cwd) ?? new Map<string, EvidenceEnvelope>()
    const existing = envelopes.get(key)
    const minMs = Math.min(...timestamps)
    const maxMs = Math.max(...timestamps)
    if (existing) {
      existing.minMs = Math.min(existing.minMs, minMs)
      existing.maxMs = Math.max(existing.maxMs, maxMs)
    } else {
      envelopes.set(key, { refs, minMs, maxMs })
    }
    byCwd.set(cwd, envelopes)
  }
  return byCwd
}

export function timeBoundCwdRefs(
  session: SessionSummary,
  evidence: CwdEvidenceIndex,
): string[] | null {
  const cwd = normalizedWorkingDirectory(session.workingDirectory)
  if (!cwd) return null
  const firstMs = Date.parse(session.firstTimestamp)
  const lastMs = Date.parse(session.lastTimestamp)
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs) || lastMs < firstMs) return null

  const matches = [...(evidence.get(cwd)?.values() ?? [])]
    .filter(envelope => firstMs >= envelope.minMs && lastMs <= envelope.maxMs)
  return matches.length === 1 ? matches[0]!.refs : null
}
