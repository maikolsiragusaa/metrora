import { sanitizeAdvisorModelOutput, sanitizeAdvisorNarrative } from '../advisor/privacy'

type SwarmSynthesisSource = {
  answer: string
  evidenceSummary: string
}

const NUMERIC_LITERAL_PATTERN = /(?<![\p{L}\p{N}])(?:\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/gu
const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|hundred|thousand|million|billion|first|second|third|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|cento|mille|milione|milioni|primo|secondo|terzo)\b/giu

function numberKeys(token: string): string[] {
  const values = new Set<string>([token])
  const candidates = [
    token.replace(/,/gu, ''),
    token.includes(',') ? token.replace(/\./gu, '').replace(',', '.') : token,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) values.add(String(value))
  }
  return [...values]
}

function numericKeys(value: string): string[] {
  const keys: string[] = []
  NUMERIC_LITERAL_PATTERN.lastIndex = 0
  for (const match of value.matchAll(NUMERIC_LITERAL_PATTERN)) keys.push(...numberKeys(match[0]))
  NUMERIC_LITERAL_PATTERN.lastIndex = 0
  return keys
}

function numberWords(value: string): string[] {
  const words: string[] = []
  NUMBER_WORD_PATTERN.lastIndex = 0
  for (const match of value.matchAll(NUMBER_WORD_PATTERN)) words.push(match[0].normalize('NFKC').toLocaleLowerCase())
  NUMBER_WORD_PATTERN.lastIndex = 0
  return words
}

/**
 * The worker answer is already rendered from verified Advisor claim atoms.
 * Swarm synthesis may combine those reports, but must not introduce a new
 * numeric value. Qualitative prose remains allowed when it passes the normal
 * narrative boundary.
 */
export function sanitizeSwarmSynthesisAnswer(value: string, sources: readonly SwarmSynthesisSource[], maxBytes = 8 * 1024): string {
  const safe = sanitizeAdvisorModelOutput(value, maxBytes)
  if (!safe) return ''

  const sourceText = sources.map(source => source.answer + '\n' + source.evidenceSummary).join('\n')
  const allowedNumbers = new Set(numericKeys(sourceText))
  const candidateNumbers = numericKeys(safe)
  if (candidateNumbers.some(key => !allowedNumbers.has(key))) return ''

  const allowedWords = new Set(numberWords(sourceText))
  const candidateWords = numberWords(safe)
  if (candidateWords.some(word => !allowedWords.has(word))) return ''

  // Remove numeric tokens only for the qualitative safety check. This keeps
  // causal, disclosure, secret, path, and hidden-reasoning rules active while
  // allowing a numeric sentence whose values were already in worker reports.
  const qualitative = safe
    .replace(NUMERIC_LITERAL_PATTERN, ' ')
    .replace(NUMBER_WORD_PATTERN, ' ')
  NUMERIC_LITERAL_PATTERN.lastIndex = 0
  NUMBER_WORD_PATTERN.lastIndex = 0
  if (!sanitizeAdvisorNarrative(qualitative)) return ''
  return safe
}
