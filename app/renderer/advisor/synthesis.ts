import { contentMinimalEvidence, containsAdvisorSensitiveText, sanitizeAdvisorDisplayText } from './privacy'
import type { AdvisorClaimClass, AdvisorClaimV1, AdvisorEvidence, AdvisorJsonValue, AdvisorPresentationIntent, AdvisorPresentationRequestV1, AdvisorSynthesisBlockV1, AdvisorSynthesisDraftV1 } from './types'

const CLAIM_CLASSES: readonly AdvisorClaimClass[] = ['numeric', 'date', 'period', 'provider', 'model', 'project', 'trend', 'status', 'qualitative', 'causal', 'forecast', 'recommendation']
const PRESENTATION_KINDS: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
const MAX_DRAFT_BYTES = 16 * 1024
const MAX_TEXT_BYTES = 2 * 1024
const CLAIM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/u
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/u
const EVIDENCE_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,160}$/u

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown, depth = 0): value is AdvisorJsonValue {
  if (depth > 4) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 32 && value.every(item => isJsonValue(item, depth + 1))
  return isRecord(value) && Object.keys(value).length <= 32 && Object.values(value).every(item => isJsonValue(item, depth + 1))
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

function parseBlock(value: unknown): AdvisorSynthesisBlockV1 | null {
  // Legacy string drafts are parsed for diagnostics, but their empty claimIds
  // intentionally make material prose fail verification. This prevents an old
  // producer from bypassing the public claim-completeness contract.
  if (typeof value === 'string') {
    const text = boundedText(value)
    return text ? { text, claimIds: [] } : null
  }
  if (!isRecord(value)) return null
  const text = boundedText(value.text)
  const claimIds = Array.isArray(value.claimIds)
    && value.claimIds.length <= 24
    && value.claimIds.every(item => typeof item === 'string' && CLAIM_ID_PATTERN.test(item))
    ? [...value.claimIds]
    : null
  if (!text || !claimIds) return null
  return { text, claimIds }
}

function blockList(value: unknown, limit: number): AdvisorSynthesisBlockV1[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) return null
  const blocks = value.map(parseBlock)
  return blocks.every((item): item is AdvisorSynthesisBlockV1 => Boolean(item)) ? blocks : null
}

function parseClaim(value: unknown, index: number): AdvisorClaimV1 | null {
  if (!isRecord(value)) return null
  const text = boundedText(value.text)
  const claimClass = value.class
  const id = typeof value.id === 'string' && CLAIM_ID_PATTERN.test(value.id) ? value.id : 'claim-' + (index + 1)
  const refs = Array.isArray(value.evidenceRefs) && value.evidenceRefs.length <= 8 && value.evidenceRefs.every(ref => typeof ref === 'string' && EVIDENCE_REF_PATTERN.test(ref)) ? [...value.evidenceRefs] : null
  const paths = Array.isArray(value.evidencePaths) && value.evidencePaths.length <= 8 && value.evidencePaths.every(path => typeof path === 'string' && EVIDENCE_PATH_PATTERN.test(path)) ? [...value.evidencePaths] : null
  if (!text || !CLAIM_CLASSES.includes(claimClass as AdvisorClaimClass) || !refs || !paths || !isJsonValue(value.value)) return null
  return {
    contractVersion: 'advisor-claim-v1',
    schemaVersion: 1,
    id,
    class: claimClass as AdvisorClaimClass,
    text,
    value: value.value,
    evidenceRefs: refs,
    evidencePaths: paths,
    status: 'unsupported',
  }
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
  const conclusion = parseBlock(parsed.conclusion)
  const why = blockList(parsed.why, 6)
  const details = blockList(parsed.details, 12)
  const rawClaims = Array.isArray(parsed.claims) && parsed.claims.length <= 24 ? parsed.claims : null
  const rawRequests = Array.isArray(parsed.presentationRequests) && parsed.presentationRequests.length <= 8 ? parsed.presentationRequests : []
  if (!conclusion || !why || !details || !rawClaims) return null
  const claims = rawClaims.map((claim, index) => parseClaim(claim, index))
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
    claims: claims as AdvisorClaimV1[],
    presentationRequests: presentationRequests as AdvisorPresentationRequestV1[],
    ...(expertDetail?.length ? { expertDetail } : {}),
  }
}

function getPath(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const key of path.split('.')) {
    if (Array.isArray(cursor)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(key)) return undefined
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index >= cursor.length) return undefined
      cursor = cursor[index]
      continue
    }
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

function equalFact(actual: unknown, expected: AdvisorJsonValue): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-9
  if (typeof actual === 'string' && typeof expected === 'string') return actual === expected || actual.toLowerCase() === expected.toLowerCase()
  return actual === expected
}

// Every non-unsupported claim class is material. In particular qualitative is
// not an evidence-free escape hatch: it must resolve to a verified fact path.
function materialClaim(claim: AdvisorClaimV1): boolean {
  return claim.class !== 'causal' && claim.class !== 'forecast' && claim.class !== 'recommendation'
}

function exactReference(ref: string, evidence: AdvisorEvidence): boolean {
  return evidence.refs.some(item => item.id === ref)
}

function verifyBlock(block: AdvisorSynthesisBlockV1, claims: Map<string, AdvisorClaimV1>): string | null {
  if (!block.claimIds.length) return 'User-visible synthesis prose has no claim references.'
  const unique = new Set(block.claimIds)
  if (unique.size !== block.claimIds.length) return 'A synthesis block repeated a claim reference.'
  for (const claimId of block.claimIds) {
    const claim = claims.get(claimId)
    if (!claim) return 'A synthesis block references an unknown claim ID.'
    if (claim.status !== 'verified') return 'A synthesis block references a claim that did not verify.'
  }
  return null
}

export type AdvisorSynthesisVerification = { valid: boolean; claims: AdvisorClaimV1[]; reason: string | null }

export function verifyAdvisorSynthesis(draft: AdvisorSynthesisDraftV1, evidence: AdvisorEvidence): AdvisorSynthesisVerification {
  const modelEvidence = contentMinimalEvidence(evidence, { preserveEvidenceIds: true })
  let rejected = 0
  const ids = new Set<string>()
  const claims = draft.claims.map(claim => {
    let status: AdvisorClaimV1['status'] = 'verified'
    let reason: string | undefined
    if (ids.has(claim.id)) {
      status = 'rejected'
      reason = 'Claim IDs must be unique.'
    }
    ids.add(claim.id)
    if (claim.class === 'causal' || claim.class === 'forecast' || claim.class === 'recommendation') {
      status = 'unsupported'
      reason = 'This claim class is not factual authority in Advisor V1.'
    } else if (materialClaim(claim) && (!claim.evidenceRefs.length || claim.evidenceRefs.some(ref => !exactReference(ref, evidence)))) {
      status = 'rejected'
      reason = 'Material claim does not reference exact Metrora evidence item IDs.'
    } else if (materialClaim(claim) && (!claim.evidencePaths.length || !claim.evidencePaths.some(path => equalFact(getPath(modelEvidence, path), claim.value)))) {
      status = 'rejected'
      reason = 'Claim value does not match a cited Metrora evidence path.'
    } else if (containsAdvisorSensitiveText(claim.text)) {
      status = 'rejected'
      reason = 'Claim contains content outside the Advisor privacy boundary.'
    }
    if (status !== 'verified') rejected += 1
    return { ...claim, status, ...(reason ? { reason } : {}) }
  })
  const claimMap = new Map(claims.map(claim => [claim.id, claim]))
  const blockErrors = [draft.conclusion, ...draft.why, ...draft.details].map(block => verifyBlock(block, claimMap)).filter((reason): reason is string => Boolean(reason))
  const valid = rejected === 0 && blockErrors.length === 0 && claims.some(claim => claim.status === 'verified')
  return {
    valid,
    claims,
    reason: valid ? null : blockErrors[0] ?? (rejected ? 'One or more model-authored claims failed deterministic verification.' : 'The synthesis did not contain a verified claim graph.'),
  }
}
