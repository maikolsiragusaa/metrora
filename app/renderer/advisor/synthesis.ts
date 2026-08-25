import { containsAdvisorSensitiveText, sanitizeAdvisorDisplayText } from './privacy'
import { buildAdvisorVerifiedClaimAtoms, verifyAdvisorVerifiedClaimAtom } from './claim-atoms'
import type { AdvisorClaimSelectionV1, AdvisorEvidence, AdvisorPresentationIntent, AdvisorPresentationRequestV1, AdvisorSynthesisBlockV1, AdvisorSynthesisDraftV1, AdvisorVerifiedClaimAtomV1 } from './types'

const PRESENTATION_KINDS: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
const MAX_DRAFT_BYTES = 16 * 1024
const MAX_TEXT_BYTES = 2 * 1024
const CLAIM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/u
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/u

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || bytes(value) > MAX_TEXT_BYTES || containsAdvisorSensitiveText(value)) return null
  const safe = sanitizeAdvisorDisplayText(value, 1_500)
  return safe === '[redacted]' ? null : safe
}

function stringList(value: unknown, limit = 12): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) return null
  const result = value.map(item => boundedText(item))
  return result.every((item): item is string => Boolean(item)) ? result : null
}

function parseJsonText(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  try { return JSON.parse(trimmed) as unknown } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { return JSON.parse(trimmed.slice(start, end + 1)) as unknown } catch { return null }
  }
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function parseBlock(value: unknown): AdvisorSynthesisBlockV1 | null {
  // Factual text is deliberately not part of the synthesis contract. A
  // legacy {text, claimIds} block is rejected rather than silently trusting
  // prose that the typed-atom renderer cannot account for.
  if (!isRecord(value) || !onlyKeys(value, ['claimIds', 'emphasis'])) return null
  const claimIds = Array.isArray(value.claimIds)
    && value.claimIds.length <= 24
    && value.claimIds.every(item => typeof item === 'string' && CLAIM_ID_PATTERN.test(item))
    ? [...value.claimIds]
    : null
  if (!claimIds) return null
  const emphasis = value.emphasis === undefined ? undefined : value.emphasis === 'primary' || value.emphasis === 'supporting' || value.emphasis === 'detail' ? value.emphasis : null
  if (emphasis === null) return null
  return { claimIds, ...(emphasis ? { emphasis } : {}) }
}

function blockList(value: unknown, limit: number): AdvisorSynthesisBlockV1[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) return null
  const blocks = value.map(parseBlock)
  return blocks.every((item): item is AdvisorSynthesisBlockV1 => Boolean(item)) ? blocks : null
}

function parseClaimSelection(value: unknown): AdvisorClaimSelectionV1 | null {
  if (!isRecord(value) || !onlyKeys(value, ['contractVersion', 'schemaVersion', 'id'])) return null
  if (value.contractVersion !== undefined && value.contractVersion !== 'advisor-claim-selection-v1') return null
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) return null
  if (typeof value.id !== 'string' || !CLAIM_ID_PATTERN.test(value.id)) return null
  return { contractVersion: 'advisor-claim-selection-v1', schemaVersion: 1, id: value.id }
}

function parsePresentationRequest(value: unknown): AdvisorPresentationRequestV1 | null {
  if (!isRecord(value) || !PRESENTATION_KINDS.includes(value.kind as AdvisorPresentationIntent)) return null
  const title = value.title === undefined ? undefined : boundedText(value.title)
  if (value.title !== undefined && !title) return null
  const evidenceRefs = value.evidenceRefs === undefined
    ? undefined
    : Array.isArray(value.evidenceRefs) && value.evidenceRefs.length <= 8 && value.evidenceRefs.every(ref => typeof ref === 'string' && EVIDENCE_REF_PATTERN.test(ref))
      ? [...value.evidenceRefs]
      : null
  if (evidenceRefs === null) return null
  return { kind: value.kind as AdvisorPresentationIntent, ...(title ? { title } : {}), ...(evidenceRefs ? { evidenceRefs } : {}) }
}

export function parseAdvisorSynthesisDraft(value: unknown): AdvisorSynthesisDraftV1 | null {
  const parsed = typeof value === 'string' ? (bytes(value) > MAX_DRAFT_BYTES ? null : parseJsonText(value)) : value
  if (!isRecord(parsed)) return null
  if (parsed.contractVersion !== 'advisor-synthesis-draft-v1' || parsed.schemaVersion !== 1) return null
  const conclusion = parseBlock(parsed.conclusion)
  const why = blockList(parsed.why, 6)
  const details = blockList(parsed.details, 12)
  const rawClaims = Array.isArray(parsed.claims) && parsed.claims.length <= 24 ? parsed.claims : null
  const rawRequests = Array.isArray(parsed.presentationRequests) && parsed.presentationRequests.length <= 8 ? parsed.presentationRequests : []
  if (!conclusion || !why || !details || !rawClaims) return null
  const claims = rawClaims.map(parseClaimSelection)
  const presentationRequests = rawRequests.map(parsePresentationRequest)
  if (claims.some(claim => claim === null) || presentationRequests.some(request => request === null)) return null
  const expertDetail = stringList(parsed.expertDetail, 8)
  if (parsed.expertDetail !== undefined && !expertDetail) return null
  return {
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion,
    why,
    details,
    claims: claims as AdvisorClaimSelectionV1[],
    presentationRequests: presentationRequests as AdvisorPresentationRequestV1[],
    ...(expertDetail?.length ? { expertDetail } : {}),
  }
}

function verifyBlock(block: AdvisorSynthesisBlockV1, selected: Set<string>, available: Map<string, AdvisorVerifiedClaimAtomV1>): string | null {
  if (Object.prototype.hasOwnProperty.call(block as object, 'text')) return 'Synthesis blocks cannot contain model-authored factual text.'
  if (!block.claimIds.length) return 'A material synthesis block has no selected claim atoms.'
  const unique = new Set(block.claimIds)
  if (unique.size !== block.claimIds.length) return 'A synthesis block repeated a claim atom.'
  for (const claimId of block.claimIds) {
    if (!selected.has(claimId)) return 'A synthesis block references an unselected claim atom.'
    if (!available.has(claimId)) return 'A synthesis block references an unknown claim atom.'
  }
  return null
}

export type AdvisorSynthesisVerification = { valid: boolean; claims: AdvisorVerifiedClaimAtomV1[]; reason: string | null }

export function verifyAdvisorSynthesis(draft: AdvisorSynthesisDraftV1, evidence: AdvisorEvidence): AdvisorSynthesisVerification {
  const available = new Map(buildAdvisorVerifiedClaimAtoms(evidence).map(atom => [atom.id, atom]))
  const selectedIds = draft.claims.map(selection => selection.id)
  const selected = new Set<string>()
  let reason: string | null = null
  for (const id of selectedIds) {
    if (selected.has(id)) reason = reason ?? 'Claim atom IDs must be unique.'
    selected.add(id)
    const atom = available.get(id)
    if (!atom) reason = reason ?? 'The synthesis selected an unavailable claim atom.'
    else if (!verifyAdvisorVerifiedClaimAtom(atom, evidence)) reason = reason ?? 'A selected claim atom failed explicit semantic verification.'
  }
  const selectedAtoms = selectedIds.flatMap(id => {
    const atom = available.get(id)
    return atom && verifyAdvisorVerifiedClaimAtom(atom, evidence) ? [atom] : []
  })
  const blockErrors = [draft.conclusion, ...draft.why, ...draft.details]
    .map(block => verifyBlock(block, selected, available))
    .filter((item): item is string => Boolean(item))
  const valid = !reason && blockErrors.length === 0 && draft.conclusion.claimIds.length > 0 && selectedAtoms.length > 0
  return {
    valid,
    claims: selectedAtoms,
    reason: valid ? null : reason ?? blockErrors[0] ?? 'The synthesis did not contain a verified claim-atom graph.',
  }
}
