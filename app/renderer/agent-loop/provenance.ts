import { buildAdvisorVerifiedClaimAtoms } from '../advisor/claim-atoms'
import { containsAdvisorForbiddenOutputClass, containsAdvisorSensitiveText, sanitizeAdvisorDisplayText } from '../advisor/privacy'
import type { AdvisorEvidence } from '../advisor/types'

export type MetroraClaimProvenance =
  | 'canonical-metrora-fact'
  | 'user-provided-fact'
  | 'deterministic-derivation'
  | 'model-interpretation'
  | 'unsupported-factual-claim'

export type MetroraProvenanceDiagnostic =
  | 'unsupported_numeric_claim'
  | 'unsupported_subject_claim'
  | 'unsupported_rank_claim'
  | 'unsupported_causality'
  | 'privacy_violation'
  | 'ungrounded_narrative'

export type MetroraProvenanceResult = {
  text: string
  accepted: boolean
  usedCanonicalFact: boolean
  usedUserFact: boolean
  usedDerivation: boolean
  usedInterpretation: boolean
  removedClauses: number
  diagnostics: readonly MetroraProvenanceDiagnostic[]
}

type NumberSource = 'canonical' | 'user' | 'derived'
type AuthorizedNumber = { value: number; source: NumberSource; unit: string | null }

function numberKey(value: number): string {
  return Number(value.toFixed(6)).toString()
}

function parseNumberToken(token: string): number | null {
  const suffix = /[kKmMbB]$/u.test(token) ? token.slice(-1).toLowerCase() : ''
  const raw = suffix ? token.slice(0, -1) : token
  let normalized = raw
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    normalized = raw.replaceAll(thousands, '').replace(decimal, '.')
  } else if (comma >= 0) {
    normalized = /,\d{3}(?:,\d{3})*$/u.test(raw) ? raw.replaceAll(',', '') : raw.replace(',', '.')
  } else if (dot >= 0) {
    normalized = /\.\d{3}(?:\.\d{3})*$/u.test(raw) ? raw.replaceAll('.', '') : raw
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1
  return value * multiplier
}

function numberTokens(value: string): number[] {
  return Array.from(value.matchAll(/\d+(?:[.,]\d+)*(?:[kKmMbB])?/gu)).flatMap(match => {
    const index = match.index ?? -1
    const token = match[0]
    const before = index > 0 ? value[index - 1] : ''
    const after = value[index + token.length] ?? ''
    // Version/model identifiers such as GPT-5.6 are not numeric claims.
    if (/[\p{L}_-]/u.test(before) || /[\p{L}_]/u.test(after) && !/[kKmMbB]$/u.test(token)) return []
    const parsed = parseNumberToken(token)
    return parsed === null ? [] : [parsed]
  })
}

function evidenceWords(evidenceItems: readonly AdvisorEvidence[]): Set<string> {
  const text = evidenceItems.flatMap(evidence => [
    evidence.question,
    evidence.coverage.label,
    evidence.coverage.detail,
    ...evidence.refs.flatMap(ref => [ref.id, ref.label]),
    evidence.spend ? 'spend usage cost total calls sessions model models projects providers concentration' : '',
    evidence.modelEfficiency ? 'model models efficiency cost calls pricing concentration' : '',
    evidence.quota ? 'quota capacity remaining reset credits providers' : '',
    evidence.bench ? 'bench benchmark score status result test' : '',
  ]).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  return new Set(text.match(/[\p{L}\p{N}]{3,}/gu) ?? [])
}

function authorizedNumbers(question: string, evidenceItems: readonly AdvisorEvidence[]): AuthorizedNumber[] {
  const values: AuthorizedNumber[] = []
  for (const evidence of evidenceItems) {
    for (const atom of buildAdvisorVerifiedClaimAtoms(evidence)) {
      if (typeof atom.value === 'number' && Number.isFinite(atom.value)) values.push({ value: atom.value, source: 'canonical', unit: atom.unit })
    }
  }
  const user = numberTokens(question)
  for (const value of user) values.push({ value, source: 'user', unit: null })
  const base = Array.from(new Map(values.map(item => [numberKey(item.value) + '\u0000' + (item.unit ?? ''), item])).values())
  for (const left of base) {
    for (const right of base) {
      if (left.value === right.value || left.unit && right.unit && left.unit !== right.unit) continue
      const difference = Math.abs(left.value - right.value)
      const unit = left.unit ?? right.unit
      if (Number.isFinite(difference) && difference <= 1_000_000_000_000) values.push({ value: difference, source: 'derived', unit })
    }
  }
  return values
}

function subjectNames(evidenceItems: readonly AdvisorEvidence[]): string[] {
  return [...new Set(evidenceItems.flatMap(evidence => buildAdvisorVerifiedClaimAtoms(evidence).flatMap(atom => atom.subject ? [atom.subject] : [])))]
}

function thresholdContext(value: string): boolean {
  return /\b(?:threshold|limit|budget|criterion|criteria|soglia|limite|budget|oltre|supera|superato|superata|exceed|exceeds|above|more\s+than|less\s+than|differenza|difference|delta)\b/iu.test(value)
}

function numericContext(value: string): 'currency' | 'calls' | 'tokens' | 'percent' | 'sessions' | 'generic' {
  if (/(?:[$€£]|\busd\b|\bdollars?\b|\bdollari\b|\beuros?\b|\bcost\w*\b|\bspend\w*\b|\bspes\w*\b|\bamount\b)/iu.test(value)) return 'currency'
  if (/\b(?:calls?|chiamat\w*)\b/iu.test(value)) return 'calls'
  if (/\b(?:tokens?|gettoni)\b/iu.test(value)) return 'tokens'
  if (/%|\b(?:percent\w*|quota|remaining|riman\w*)\b/iu.test(value)) return 'percent'
  if (/\b(?:sessions?|sessioni)\b/iu.test(value)) return 'sessions'
  return 'generic'
}

function numberUnitAllowed(item: AuthorizedNumber, context: string): boolean {
  if (!item.unit) return true
  const kind = numericContext(context)
  if (kind === 'generic') return true
  if (kind === 'currency') return item.unit === 'USD'
  if (kind === 'calls') return item.unit === 'calls'
  if (kind === 'tokens') return item.unit === 'tokens'
  if (kind === 'sessions') return item.unit === 'sessions'
  return item.unit === '%' || item.unit === 'USD'
}

function sentenceParts(value: string): string[] {
  return value.split(/\r?\n+/u).flatMap(line => line.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"'])/u)).flatMap(sentence => sentence.split(/\s+(?:but|however|ma|però|tuttavia)\s+/iu)).flatMap(sentence => sentence.split(/;\s*/u)).map(sentence => sentence.trim()).filter(Boolean)
}

function causalClaim(value: string): boolean {
  return /\b(?:caused|causes|cause|due\s+to|because\s+of|responsible\s+for|driver\s+of|ha\s+causato|hanno\s+causato|a\s+causa\s+di|causa\s+principale|motivo\s+(?:è|e)|ragione\s+(?:è|e))\b/iu.test(value)
}

function rankClaim(value: string): boolean {
  return /\b(?:top|main|primary|leading|largest|highest|biggest|dominant|most\s+(?:expensive|costly)|rank(?:ed|ing)?|contributor|driver|principale|maggiore|più\s+(?:costoso|costosa)|classifica|ordinamento)\b/iu.test(value)
}

function trendClaim(value: string): boolean {
  return /\b(?:rose|risen|increased|increasing|decreased|decreasing|fell|grew|growth|declined|in salita|in calo|aumentat\w*|diminuit\w*|cresciut\w*|calat\w*)\b/iu.test(value)
}

function subjectClaim(value: string, known: readonly string[]): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  const knownNormalized = known.map(item => item.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase())
  const labeled = Array.from(value.matchAll(/\b(?:model|models|modello|modelli|project|projects|progetto|progetti|session|sessions|sessione|sessioni|provider|providers|fornitore|fornitori)\s+([\p{L}\p{N}._:/-]+)/giu)).map(match => match[1]!.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase())
  return labeled.some(candidate => !knownNormalized.some(name => name === candidate || name.includes(candidate) || candidate.includes(name)) && !/^(?:concentration|concentrazione|cost|spend|usage|utilizzo|efficiency|efficienza|context|contesto|activity|attivita|data|dati|total|totale|driver|drivers|breakdown|source|value|row)$/u.test(candidate)) || (rankClaim(value) && known.length === 0) || (causalClaim(value) && known.length === 0 && /\b(?:model|project|session|provider|modello|progetto|sessione|fornitore)\b/iu.test(normalized))
}

function interpretationClaim(value: string): boolean {
  return /\b(?:i\s+(?:consider|regard|think)|i['’]?d\s+(?:inspect|review|look)|i\s+would|we\s+should|recommend|suggest|meaningful|significant|material|worth\s+(?:checking|inspecting|investigating)|observed\s+pattern|closer\s+look|pattern\s+deserves|值得|significativ\w*|importante|rilevante|vale\s+la\s+pena|controllerei|ispezionerei|consiglio)\b/iu.test(value)
}

function topicAnchor(value: string, words: Set<string> = new Set()): boolean {
  const tokens = value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  return tokens.some(token => words.has(token))
}

function classifyClause(clause: string, _question: string, evidenceItems: readonly AdvisorEvidence[], auth: readonly AuthorizedNumber[], words: Set<string>, subjects: readonly string[]): { accepted: boolean; kinds: MetroraClaimProvenance[]; diagnostic?: MetroraProvenanceDiagnostic } {
  const values = numberTokens(clause)
  for (const value of values) {
    const matches = auth.filter(item => numberKey(item.value) === numberKey(value) && numberUnitAllowed(item, clause))
    const userMatch = matches.find(item => item.source === 'user')
    const derivedMatch = matches.find(item => item.source === 'derived')
    const canonicalMatch = matches.find(item => item.source === 'canonical')
    if (!canonicalMatch && !userMatch && !derivedMatch) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'unsupported_numeric_claim' }
    if (userMatch && !thresholdContext(clause) && !topicAnchor(clause, words)) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'unsupported_numeric_claim' }
  }
  if (containsAdvisorSensitiveText(clause) || containsAdvisorForbiddenOutputClass(clause)) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'privacy_violation' }
  if (causalClaim(clause)) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'unsupported_causality' }
  if (trendClaim(clause) && !evidenceItems.some(item => item.spend?.trend)) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'ungrounded_narrative' }
  if (subjectClaim(clause, subjects)) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'unsupported_subject_claim' }
  if (rankClaim(clause) && !subjects.some(subject => clause.toLocaleLowerCase().includes(subject.toLocaleLowerCase()))) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'unsupported_rank_claim' }
  const supportedNumber = values.some(value => auth.some(item => (item.source === 'canonical' || item.source === 'derived') && numberKey(item.value) === numberKey(value)))
  const hasEvidence = values.length > 0 || topicAnchor(clause, words) || (interpretationClaim(clause) && evidenceItems.some(item => item.refs.length > 0))
  if (!hasEvidence || (!topicAnchor(clause) && !interpretationClaim(clause) && !supportedNumber && !thresholdContext(clause))) return { accepted: false, kinds: ['unsupported-factual-claim'], diagnostic: 'ungrounded_narrative' }
  const kinds: MetroraClaimProvenance[] = []
  if (values.some(value => auth.some(item => item.source === 'canonical' && numberKey(item.value) === numberKey(value)))) kinds.push('canonical-metrora-fact')
  if (values.some(value => auth.some(item => item.source === 'user' && numberKey(item.value) === numberKey(value)))) kinds.push('user-provided-fact')
  if (values.some(value => auth.some(item => item.source === 'derived' && numberKey(item.value) === numberKey(value)))) kinds.push('deterministic-derivation')
  if (interpretationClaim(clause) || !values.length) kinds.push('model-interpretation')
  return { accepted: true, kinds }
}

export function classifyMetroraProvenance(value: string, question: string, evidenceItems: readonly AdvisorEvidence[]): MetroraProvenanceResult {
  const raw = value.trim()
  if (!raw) return { text: '', accepted: false, usedCanonicalFact: false, usedUserFact: false, usedDerivation: false, usedInterpretation: false, removedClauses: 0, diagnostics: ['ungrounded_narrative'] }
  if (containsAdvisorSensitiveText(raw) || containsAdvisorForbiddenOutputClass(raw)) return { text: '', accepted: false, usedCanonicalFact: false, usedUserFact: false, usedDerivation: false, usedInterpretation: false, removedClauses: 1, diagnostics: ['privacy_violation'] }
  const safe = sanitizeAdvisorDisplayText(raw, Number.MAX_SAFE_INTEGER)
  const auth = authorizedNumbers(question, evidenceItems)
  const words = evidenceWords(evidenceItems)
  const subjects = subjectNames(evidenceItems)
  const accepted: string[] = []
  const diagnostics: MetroraProvenanceDiagnostic[] = []
  let usedCanonicalFact = false
  let usedUserFact = false
  let usedDerivation = false
  let usedInterpretation = false
  for (const clause of sentenceParts(safe)) {
    const result = classifyClause(clause, question, evidenceItems, auth, words, subjects)
    if (!result.accepted) {
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      continue
    }
    accepted.push(clause)
    usedCanonicalFact ||= result.kinds.includes('canonical-metrora-fact')
    usedUserFact ||= result.kinds.includes('user-provided-fact')
    usedDerivation ||= result.kinds.includes('deterministic-derivation')
    usedInterpretation ||= result.kinds.includes('model-interpretation')
  }
  const text = accepted.join(' ').trim()
  return {
    text,
    accepted: Boolean(text),
    usedCanonicalFact,
    usedUserFact,
    usedDerivation,
    usedInterpretation,
    removedClauses: Math.max(0, sentenceParts(safe).length - accepted.length),
    diagnostics: [...new Set(diagnostics)],
  }
}
