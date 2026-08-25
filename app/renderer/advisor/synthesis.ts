import { contentMinimalEvidence, containsAdvisorSensitiveText, sanitizeAdvisorDisplayText } from './privacy'
import type { AdvisorClaimClass, AdvisorClaimV1, AdvisorEvidence, AdvisorJsonValue, AdvisorPresentationIntent, AdvisorPresentationRequestV1, AdvisorSynthesisDraftV1 } from './types'

const CLAIM_CLASSES: readonly AdvisorClaimClass[] = ['numeric', 'date', 'period', 'provider', 'model', 'project', 'trend', 'status', 'qualitative', 'causal', 'forecast', 'recommendation']
const PRESENTATION_KINDS: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
const MAX_DRAFT_BYTES = 16 * 1024
const MAX_TEXT_BYTES = 2 * 1024

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown, depth = 0): value is AdvisorJsonValue {
  if (depth > 4 || value === null || typeof value === 'string' || typeof value === 'boolean') return value === null || typeof value === 'string' || typeof value === 'boolean'
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 32 && value.every(item => isJsonValue(item, depth + 1))
  return isRecord(value) && Object.keys(value).length <= 32 && Object.values(value).every(item => isJsonValue(item, depth + 1))
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || bytes(value) > MAX_TEXT_BYTES) return null
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

function parseClaim(value: unknown, index: number): AdvisorClaimV1 | null {
  if (!isRecord(value)) return null
  const text = boundedText(value.text)
  const claimClass = value.class
  const id = typeof value.id === 'string' && /^[A-Za-z0-9._:-]{1,80}$/u.test(value.id) ? value.id : 'claim-' + (index + 1)
  const refs = Array.isArray(value.evidenceRefs) && value.evidenceRefs.length <= 8 && value.evidenceRefs.every(ref => typeof ref === 'string' && /^[A-Za-z0-9._:-]{1,120}$/u.test(ref)) ? value.evidenceRefs : null
  const paths = Array.isArray(value.evidencePaths) && value.evidencePaths.length <= 8 && value.evidencePaths.every(path => typeof path === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,160}$/u.test(path)) ? value.evidencePaths : null
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
    : Array.isArray(value.evidenceRefs) && value.evidenceRefs.length <= 8 && value.evidenceRefs.every(ref => typeof ref === 'string' && /^[A-Za-z0-9._:-]{1,120}$/u.test(ref))
      ? value.evidenceRefs
      : null
  if (evidenceRefs === null) return null
  return { kind: value.kind as AdvisorPresentationIntent, ...(title ? { title } : {}), ...(evidenceRefs ? { evidenceRefs } : {}) }
}

export function parseAdvisorSynthesisDraft(value: unknown): AdvisorSynthesisDraftV1 | null {
  const parsed = typeof value === 'string' ? (bytes(value) > MAX_DRAFT_BYTES ? null : parseJsonText(value)) : value
  if (!isRecord(parsed)) return null
  const conclusion = boundedText(parsed.conclusion)
  const why = stringList(parsed.why, 6)
  const details = stringList(parsed.details, 12)
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

function materialClaim(claim: AdvisorClaimV1): boolean {
  return claim.class !== 'qualitative' || /\d|zero|one|two|three|four|five|six|seven|eight|nine|today|yesterday|week|month|provider|model|project|quota|reset|spend|cost|calls?/iu.test(claim.text)
}

function normalizedReference(ref: string, evidence: AdvisorEvidence): string | null {
  if (evidence.refs.some(item => item.id === ref)) return ref
  const ordinal = /^evidence-(\d+)$/u.exec(ref)?.[1]
  if (!ordinal) return null
  const item = evidence.refs[Number(ordinal) - 1]
  return item?.id ?? null
}

export type AdvisorSynthesisVerification = { valid: boolean; claims: AdvisorClaimV1[]; reason: string | null }

export function verifyAdvisorSynthesis(draft: AdvisorSynthesisDraftV1, evidence: AdvisorEvidence): AdvisorSynthesisVerification {
  const modelEvidence = contentMinimalEvidence(evidence)
  let rejected = 0
  const claims = draft.claims.map(claim => {
    const refs = claim.evidenceRefs.map(ref => normalizedReference(ref, evidence)).filter((ref): ref is string => Boolean(ref))
    let status: AdvisorClaimV1['status'] = 'verified'
    let reason: string | undefined
    if (claim.class === 'causal' || claim.class === 'forecast' || claim.class === 'recommendation') {
      status = 'unsupported'
      reason = 'This claim class is not factual authority in Advisor V1.'
    } else if (materialClaim(claim) && (!refs.length || refs.length !== claim.evidenceRefs.length)) {
      status = 'rejected'
      reason = 'Material claim does not reference a valid Metrora evidence item.'
    } else if (claim.evidencePaths.length && !claim.evidencePaths.some(path => equalFact(getPath(modelEvidence, path), claim.value))) {
      status = 'rejected'
      reason = 'Claim value does not match the cited Metrora evidence path.'
    } else if (materialClaim(claim) && !claim.evidencePaths.length) {
      status = 'rejected'
      reason = 'Material claim is missing a deterministic evidence path.'
    } else if (containsAdvisorSensitiveText(claim.text)) {
      status = 'rejected'
      reason = 'Claim contains content outside the Advisor privacy boundary.'
    }
    if (status !== 'verified') rejected += 1
    return { ...claim, evidenceRefs: refs, status, ...(reason ? { reason } : {}) }
  })
  const usable = claims.filter(claim => claim.status === 'verified')
  const hasMaterialClaim = claims.some(materialClaim)
  return {
    valid: rejected === 0 && (!hasMaterialClaim || usable.length > 0),
    claims,
    reason: rejected ? 'One or more model-authored claims failed deterministic verification.' : null,
  }
}
