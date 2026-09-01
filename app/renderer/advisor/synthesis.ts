import { containsAdvisorContributionLanguage, containsAdvisorForbiddenOutputClass, containsAdvisorSensitiveText, sanitizeAdvisorDisplayText, sanitizeAdvisorNarrative } from './privacy'
import { buildAdvisorVerifiedClaimAtoms, verifyAdvisorVerifiedClaimAtom } from './claim-atoms'
import type { AdvisorClaimSelectionV1, AdvisorEvidence, AdvisorPresentationIntent, AdvisorPresentationRequestV1, AdvisorSynthesisBlockV1, AdvisorSynthesisDraftV1, AdvisorSynthesisNarrativeV1, AdvisorVerifiedClaimAtomV1 } from './types'

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
  if (typeof value !== 'string' || !value.trim() || bytes(value) > MAX_TEXT_BYTES || containsAdvisorSensitiveText(value) || containsAdvisorForbiddenOutputClass(value)) return null
  const safe = sanitizeAdvisorDisplayText(value, 1_500)
  return safe === '[redacted]' ? null : safe
}

function stringList(value: unknown, limit = 12): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limit) return null
  const result = value.map(item => boundedText(item))
  return result.every((item): item is string => Boolean(item)) ? result : null
}

function narrativeText(value: unknown): string | null {
  if (typeof value !== 'string' || bytes(value) > MAX_TEXT_BYTES) return null
  const safe = sanitizeAdvisorNarrative(value)
  return safe || null
}

function parseNarrative(value: unknown): AdvisorSynthesisNarrativeV1 | null {
  if (!isRecord(value) || !onlyKeys(value, ['interpretation', 'recommendation', 'caveats'])) return null
  const interpretation = value.interpretation === undefined ? undefined : narrativeText(value.interpretation)
  const recommendation = value.recommendation === undefined ? undefined : narrativeText(value.recommendation)
  const caveats = stringList(value.caveats, 6)
  if (value.interpretation !== undefined && !interpretation) return null
  if (value.recommendation !== undefined && !recommendation) return null
  if (value.caveats !== undefined && !caveats) return null
  if (!interpretation && !recommendation && !caveats?.length) return null
  return {
    ...(interpretation ? { interpretation } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(caveats?.length ? { caveats } : {}),
  }
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
  const narrative = parsed.narrative === undefined ? undefined : parseNarrative(parsed.narrative)
  if (parsed.narrative !== undefined && !narrative) return null
  return {
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion,
    why,
    details,
    claims: claims as AdvisorClaimSelectionV1[],
    presentationRequests: presentationRequests as AdvisorPresentationRequestV1[],
    ...(expertDetail?.length ? { expertDetail } : {}),
    ...(narrative ? { narrative } : {}),
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

export type AdvisorSynthesisVerification = {
  valid: boolean
  claims: AdvisorVerifiedClaimAtomV1[]
  reason: string | null
  /** Safe model prose after evidence/subject/rank grounding. */
  narrative?: AdvisorSynthesisNarrativeV1
}

function isCanonicalContributionAtom(atom: AdvisorVerifiedClaimAtomV1): boolean {
  return (atom.claimKind === 'model_measured_cost' && /^spend\.models\.\d+\.costUSD$/u.test(atom.evidencePath))
    || (atom.claimKind === 'project_measured_cost' && /^spend\.projects\.\d+\.costUSD$/u.test(atom.evidencePath))
    || (atom.claimKind === 'session_measured_cost' && /^spend\.sessionsByCost\.\d+\.costUSD$/u.test(atom.evidencePath))
}

function normalizedPhrase(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
}

function phraseIn(value: string, phrase: string): boolean {
  const haystack = ' ' + normalizedPhrase(value).replace(/[^\p{L}\p{N}._/-]+/gu, ' ') + ' '
  const needle = ' ' + normalizedPhrase(phrase).replace(/[^\p{L}\p{N}._/-]+/gu, ' ') + ' '
  return Boolean(needle.trim()) && haystack.includes(needle)
}

const CONTRIBUTION_ENTITY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'based', 'breakdown', 'by', 'contribution', 'contributions',
  'contributor', 'contributors', 'cost', 'driver', 'drivers', 'evidence', 'from', 'in', 'is', 'main',
  'available', 'clear', 'measured', 'most', 'of', 'obvious', 'on', 'observed', 'primary', 'ranking', 'represented',
  'sessions', 'shown', 'spend', 'the', 'this', 'to', 'top', 'visible', 'was', 'were', 'with',
])
const CONTRIBUTION_ENTITY_LABELS = new Set(['model', 'project', 'provider', 'service', 'session'])
const CONTRIBUTION_PLACEHOLDER_PATTERN = /^(?:(?:the|a|an|this|that)\s+)?(?:selected|current|requested)\s+(?:model|project|session|service|provider)$/u
const CONTRIBUTION_COPULA_PATTERN = /\b([\p{L}\p{N}][\p{L}\p{N}._/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._/-]*){0,3})\s+(?:is|was|are|were|appears?|seems?|looks?|e|era|erano|sono|sembra|appare)\s+(?:to\s+be\s+|di\s+essere\s+)?(?:(?:the|a|an|observed|measured|main|primary|top|leading|largest|highest|first|most|number|one|il|la|i|le|un|una|osservato|osservata|principale|principali|maggiore|maggiori|primo|prima|in|testa)\s+){0,7}(?:driver|drivers|contributor|contributors|contribution|contributions|contributore|contributori|contributo|contributi|ranked|ranking|classifica|classificazione|ordinamento)\b/giu
const CONTRIBUTION_COMPLEMENT_PATTERN = /\b(?:driver|drivers|contributor|contributors|contribution|contributions|contributore|contributori|contributo|contributi)\s+(?:is|was|are|were|e|era|erano|sono|è|sembra|appare)\s+(?:(?:the|a|an|il|la|i|le|un|una|selected|current|requested|osservato|osservata|principale|principali)\s+){0,4}([\p{L}\p{N}][\p{L}\p{N}._/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._/-]*){0,2})\b/giu
const CONTRIBUTION_LABEL_PATTERN = /\b(?:project|model|session|service|provider)\s+[\p{L}\p{N}][\p{L}\p{N}._/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._/-]*){0,3}/giu

function contributionSubjectCandidate(value: string): string | null {
  const words = normalizedPhrase(value).split(/\s+/u)
    .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
  while (words.length && CONTRIBUTION_ENTITY_STOP_WORDS.has(words[0]!)) words.shift()
  while (words.length && CONTRIBUTION_ENTITY_STOP_WORDS.has(words[words.length - 1]!)) {
    if (words.length === 2 && CONTRIBUTION_ENTITY_LABELS.has(words[0]!) && words[1]!.length === 1) break
    words.pop()
  }
  if (!words.length) return null
  const candidate = words.join(' ')
  if (words.length === 1 && CONTRIBUTION_ENTITY_LABELS.has(words[0]!)) return null
  return CONTRIBUTION_PLACEHOLDER_PATTERN.test(candidate) ? null : candidate
}

function contributionSubjectCandidates(value: string): string[] {
  const candidates: string[] = []
  for (const match of value.matchAll(CONTRIBUTION_COPULA_PATTERN)) {
    const candidate = contributionSubjectCandidate(match[1] ?? '')
    if (candidate) candidates.push(candidate)
  }
  for (const match of value.matchAll(CONTRIBUTION_COMPLEMENT_PATTERN)) {
    const candidate = contributionSubjectCandidate(match[1] ?? '')
    if (candidate) candidates.push(candidate)
  }
  for (const match of value.matchAll(CONTRIBUTION_LABEL_PATTERN)) {
    const candidate = contributionSubjectCandidate(match[0] ?? '')
    if (candidate) candidates.push(candidate)
  }
  return Array.from(new Set(candidates.map(normalizedPhrase)))
}

function canonicalContributionAtoms(evidence: AdvisorEvidence): AdvisorVerifiedClaimAtomV1[] {
  return buildAdvisorVerifiedClaimAtoms(evidence).filter(isCanonicalContributionAtom).filter(atom => verifyAdvisorVerifiedClaimAtom(atom, evidence))
}

function contributionGroup(atom: AdvisorVerifiedClaimAtomV1): string | null {
  const match = atom.evidencePath.match(/^spend\.(models|projects|sessionsByCost)\.\d+\.costUSD$/u)
  return match?.[1] ?? null
}

function isStrongContributionLanguage(value: string): boolean {
  return /\b(?:main|primary|top|leading|highest|largest|biggest|first|number\s+one|most\s+(?:expensive|costly)|ranking|ranked|rank|classifica|classificato|classificazione|ordinamento|ordine|principale|maggiore|primo|prima|in\s+testa|piu\s+(?:costoso|costosa|costosi|costose))\b/u.test(normalizedPhrase(value))
}

function rowIsStrictlyTop(atom: AdvisorVerifiedClaimAtomV1, allAtoms: AdvisorVerifiedClaimAtomV1[]): boolean {
  const group = contributionGroup(atom)
  if (!group || typeof atom.value !== 'number') return false
  const peers = allAtoms.filter(candidate => contributionGroup(candidate) === group && typeof candidate.value === 'number')
  if (peers.length < 2) return false
  const maximum = Math.max(...peers.map(candidate => candidate.value as number))
  return atom.value === maximum && peers.filter(candidate => candidate.value === maximum).length === 1
}

function contributionCategoriesSupported(value: string, atoms: AdvisorVerifiedClaimAtomV1[]): boolean {
  const normalized = normalizedPhrase(value)
  return [
    [/\bmodels?\b/u, 'models'],
    [/\bprojects?\b/u, 'projects'],
    [/\bsessions?\b/u, 'sessionsByCost'],
  ].every(([pattern, group]) => !(pattern as RegExp).test(normalized) || atoms.some(atom => contributionGroup(atom) === group))
}

function subjectRelevantCanonicalAtoms(value: string, evidence: AdvisorEvidence, atoms: AdvisorVerifiedClaimAtomV1[]): AdvisorVerifiedClaimAtomV1[] | null {
  if (!contributionCategoriesSupported(value, atoms)) return null
  const candidates = contributionSubjectCandidates(value)
  const subjects = atoms.flatMap(atom => atom.subject ? [normalizedPhrase(atom.subject)] : [])
  const namedSubjects = subjects.filter(subject => phraseIn(value, subject))
  const unknownCandidate = candidates.some(candidate => !subjects.some(subject => phraseIn(candidate, subject) || phraseIn(subject, candidate)))
  if (unknownCandidate || (candidates.length && !namedSubjects.length)) return null
  if (namedSubjects.length) return atoms.filter(atom => atom.subject && namedSubjects.includes(normalizedPhrase(atom.subject)))
  const selectedModel = evidence.scope.model ?? evidence.modelEfficiency?.selectedModel ?? null
  if (/\b(?:selected\s+model|modello\s+selezionato)\b/u.test(normalizedPhrase(value)) && selectedModel) {
    return atoms.filter(atom => atom.subject && normalizedPhrase(atom.subject) === normalizedPhrase(selectedModel))
  }
  return atoms
}

function selectedModelPlaceholderSupported(value: string, evidence: AdvisorEvidence, atoms: AdvisorVerifiedClaimAtomV1[]): boolean {
  if (!/\b(?:selected\s+model|modello\s+selezionato)\b/u.test(normalizedPhrase(value))) return true
  const selectedModel = evidence.scope.model ?? evidence.modelEfficiency?.selectedModel ?? null
  return Boolean(selectedModel && atoms.some(atom => atom.subject && normalizedPhrase(atom.subject) === normalizedPhrase(selectedModel)))
}

function contributionNarrativeSupported(value: string, evidence: AdvisorEvidence, relevantAtoms: AdvisorVerifiedClaimAtomV1[]): boolean {
  const safe = sanitizeAdvisorNarrative(value)
  if (!safe || !containsAdvisorContributionLanguage(safe)) return Boolean(safe)
  if (!relevantAtoms.length || !selectedModelPlaceholderSupported(safe, evidence, relevantAtoms)) return false
  const subjectAtoms = subjectRelevantCanonicalAtoms(safe, evidence, relevantAtoms)
  if (!subjectAtoms?.length) return false
  return !isStrongContributionLanguage(safe) || subjectAtoms.some(atom => rowIsStrictlyTop(atom, canonicalContributionAtoms(evidence)))
}

function groundedNarrative(narrative: AdvisorSynthesisNarrativeV1 | undefined, evidence: AdvisorEvidence, selectedAtoms: AdvisorVerifiedClaimAtomV1[]): AdvisorSynthesisNarrativeV1 | undefined {
  if (!narrative) return undefined
  const contributionAtoms = selectedAtoms.filter(isCanonicalContributionAtom)
  const interpretation = narrative.interpretation && contributionNarrativeSupported(narrative.interpretation, evidence, contributionAtoms) ? narrative.interpretation : undefined
  const recommendation = narrative.recommendation && contributionNarrativeSupported(narrative.recommendation, evidence, contributionAtoms) ? narrative.recommendation : undefined
  const caveats = (narrative.caveats ?? []).filter(value => contributionNarrativeSupported(value, evidence, contributionAtoms))
  if (!interpretation && !recommendation && !caveats.length) return undefined
  return { ...(interpretation ? { interpretation } : {}), ...(recommendation ? { recommendation } : {}), ...(caveats.length ? { caveats } : {}) }
}

export function isAdvisorNaturalNarrativeSupported(value: string, evidence: AdvisorEvidence): boolean {
  const safe = sanitizeAdvisorNarrative(value)
  if (!safe) return false
  if (!containsAdvisorContributionLanguage(safe)) return true
  return contributionNarrativeSupported(safe, evidence, canonicalContributionAtoms(evidence))
}

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
  const verificationError = reason ?? blockErrors[0]
  const valid = !verificationError && draft.conclusion.claimIds.length > 0 && selectedAtoms.length > 0
  const narrative = valid ? groundedNarrative(draft.narrative, evidence, selectedAtoms) : undefined
  return {
    valid,
    claims: selectedAtoms,
    reason: valid ? null : verificationError ?? 'The synthesis did not contain a verified claim-atom graph.',
    ...(narrative ? { narrative } : {}),
  }
}
