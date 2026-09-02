import { containsAdvisorInternalDisclosure, redactAdvisorInternalDisclosure } from './privacy-disclosure'

/**
 * Text crossing the model boundary uses the same conservative redaction rules
 * as the evidence projection, but keeps its own output-policy helpers here.
 */
export const ADVISOR_MODEL_NARRATIVE_MAX_BYTES = 8 * 1024
export const ADVISOR_ANSWER_TEXT_MAX_BYTES = 8 * 1024
export const ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH = 160
export const ADVISOR_REDACTION = '[redacted]'

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

// Only roots that are materially indicative of local filesystem provenance
// are classified here. Names such as "project/alpha" remain valid display
// names; a generic slash is not enough to make a project name sensitive.
const PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|(?:^|[\s([{])\\\\[^\s"'<>|]+|(?:^|[\s([{])(?:~[\\/]|\/(?:Users|users|home|private|var|tmp|mnt|opt|root|srv|workspace|workspaces)(?:\/|$))[^\s"'<>|,.;!?)]*|\b(?:file|local|vscode-file):\/\/[^\s"'<>|]+|(?:^|[\s([{])(?:\.\.?[\\/])[^\s"'<>|,.;!?)]*)/giu
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu
const KEY_PREFIX_PATTERN = /\b(?:sk|rk|pk|gh[pousr]|xox[baprs]-)[-_A-Za-z0-9]{12,}\b/giu
const RAW_CONTENT_MARKER_PATTERN = /(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|(?:prompt|response|source)[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|source[_ -]?(?:code|snippet|content|snippets?)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*)(?![\p{L}\p{N}])/giu
// This catches known internal-output classes without censoring benign
// explanations such as "what is a JSON schema?".
const FORBIDDEN_OUTPUT_CLASS_PATTERN = /\b(?:system\s+prompt|hidden\s+prompt|developer\s+message|implementation\s+prompt|guard\s+(?:contract|plan|object)|raw\s+(?:schema|provider\s+(?:response|payload)|evidence\s+blob|tool\s+payload)|private\s+(?:chain[- ]of[- ]thought|scratchpad)|chain[- ]of[- ]thought|internal\s+scratchpad)\b|<\/?(?:system|developer|thinking|analysis|scratchpad)(?:\s|>)/iu
const UNSUPPORTED_CAUSAL_PATTERN = /\b(?:caused|causes|due\s+to|because\s+of|reason\s+(?:is|was)|driver\s+of|a\s+causa\s+di|causat[oaie]\s+da(?:l(?:la|le|li|lo)?|gli|i|un[ao]?|una)?\b|causa\s+principale|(?:il|la)\s+(?:motivo|ragione)\s+(?:è|e))\b/iu
const CONTRIBUTION_LANGUAGE_PATTERN = /\b(?:(?:main|primary|top)\s+)?(?:driver|drivers|contributor|contributors|contribution|contributions|ranking|ranked|contributore|contributori|contributo|contributi|classifica|classificazione|ordinamento)\b/iu
const NUMERIC_CHARACTER_PATTERN = /\p{N}/u
const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|first|second|third|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|primo|secondo|terzo)\b/iu

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function entropy(value: string): number {
  if (!value) return 0
  const counts = new Map<string, number>()
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1)
  let result = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    result -= probability * Math.log2(probability)
  }
  return result
}

function looksLikeHighEntropyCredential(value: string): boolean {
  if (value.length < 20 || /\s/u.test(value)) return false
  if (!/^[\p{L}\p{N}+/_=-]+$/u.test(value)) return false
  const classes = Number(/[\p{Ll}]/u.test(value)) + Number(/[\p{Lu}]/u.test(value)) + Number(/[\p{N}]/u.test(value)) + Number(/[+/_=-]/u.test(value))
  return value.length >= 24 && classes >= 1 && entropy(value) >= 3.6
}

function containsAdvisorNumericClaim(value: string): boolean {
  return NUMERIC_CHARACTER_PATTERN.test(value) || NUMBER_WORD_PATTERN.test(value)
}

function resetPatterns(): void {
  PATH_PATTERN.lastIndex = 0
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  BEARER_PATTERN.lastIndex = 0
  KEY_PREFIX_PATTERN.lastIndex = 0
  RAW_CONTENT_MARKER_PATTERN.lastIndex = 0
}

function replaceSensitiveSegments(value: string): string {
  let result = value
  result = result.replace(PATH_PATTERN, ADVISOR_REDACTION)
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, ADVISOR_REDACTION)
  result = result.replace(BEARER_PATTERN, ADVISOR_REDACTION)
  result = result.replace(KEY_PREFIX_PATTERN, ADVISOR_REDACTION)
  result = result.replace(RAW_CONTENT_MARKER_PATTERN, ADVISOR_REDACTION)
  result = result.split(/(\s+)/u).map(token => looksLikeHighEntropyCredential(token) ? ADVISOR_REDACTION : token).join('')
  resetPatterns()
  return result
}

export function containsAdvisorSensitiveText(value: string): boolean {
  if (!value) return false
  const matched = PATH_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value) || BEARER_PATTERN.test(value) || KEY_PREFIX_PATTERN.test(value) || RAW_CONTENT_MARKER_PATTERN.test(value)
  resetPatterns()
  return matched || value.split(/\s+/u).some(looksLikeHighEntropyCredential)
}

export function containsAdvisorForbiddenOutputClass(value: string): boolean {
  if (!value) return false
  const matched = FORBIDDEN_OUTPUT_CLASS_PATTERN.test(value)
  FORBIDDEN_OUTPUT_CLASS_PATTERN.lastIndex = 0
  return matched || containsAdvisorInternalDisclosure(value)
}

export function containsAdvisorContributionLanguage(value: string): boolean {
  if (!value) return false
  CONTRIBUTION_LANGUAGE_PATTERN.lastIndex = 0
  return CONTRIBUTION_LANGUAGE_PATTERN.test(value)
}

/** Redacts sensitive spans while retaining safe factual text and digits. */
export function sanitizeAdvisorDisplayText(value: string, maxLength = ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized) return ADVISOR_REDACTION
  const redacted = redactAdvisorInternalDisclosure(replaceSensitiveSegments(normalized).replace(FORBIDDEN_OUTPUT_CLASS_PATTERN, ADVISOR_REDACTION)).replace(/\s{2,}/gu, ' ').trim()
  FORBIDDEN_OUTPUT_CLASS_PATTERN.lastIndex = 0
  if (!redacted) return ADVISOR_REDACTION
  if (redacted.length <= maxLength) return redacted
  return redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…'
}

/**
 * Model prose has a stricter policy than human-facing deterministic facts:
 * any numeric claim or sensitive class invalidates the whole narrative.
 */
export function sanitizeAdvisorNarrative(value: string, maxBytes = ADVISOR_MODEL_NARRATIVE_MAX_BYTES): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized || containsAdvisorNumericClaim(normalized) || containsAdvisorSensitiveText(normalized) || containsAdvisorForbiddenOutputClass(normalized) || UNSUPPORTED_CAUSAL_PATTERN.test(normalized)) {
    UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
    return ''
  }
  UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
  const safe = sanitizeAdvisorDisplayText(normalized, Number.MAX_SAFE_INTEGER)
  if (safe === ADVISOR_REDACTION || containsAdvisorSensitiveText(safe) || containsAdvisorNumericClaim(safe) || containsAdvisorForbiddenOutputClass(safe) || UNSUPPORTED_CAUSAL_PATTERN.test(safe)) {
    UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
    return ''
  }
  UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
  if (byteLength(safe) <= maxBytes) return safe
  return ''
}

/**
 * Sanitizer for a plain-language closeout whose numeric claims have already
 * been checked against canonical evidence. Numeric text is allowed here so a
 * same-turn model answer can naturally interpret the verified measurement;
 * sensitive, forbidden, and causal output remains rejected.
 */
export function sanitizeAdvisorGroundedNarrative(value: string, maxBytes = ADVISOR_MODEL_NARRATIVE_MAX_BYTES): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized || containsAdvisorSensitiveText(normalized) || containsAdvisorForbiddenOutputClass(normalized) || UNSUPPORTED_CAUSAL_PATTERN.test(normalized)) {
    UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
    return ''
  }
  UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
  const safe = sanitizeAdvisorDisplayText(normalized, Number.MAX_SAFE_INTEGER)
  if (safe === ADVISOR_REDACTION || containsAdvisorSensitiveText(safe) || containsAdvisorForbiddenOutputClass(safe) || UNSUPPORTED_CAUSAL_PATTERN.test(safe)) {
    UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
    return ''
  }
  UNSUPPORTED_CAUSAL_PATTERN.lastIndex = 0
  return byteLength(safe) <= maxBytes ? safe : ''
}

/** Final boundary for model-authored plain text and provider error text. */
export function sanitizeAdvisorModelOutput(value: string, maxLength = ADVISOR_ANSWER_TEXT_MAX_BYTES): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized || containsAdvisorForbiddenOutputClass(normalized)) return ''
  const safe = sanitizeAdvisorDisplayText(normalized, maxLength)
  return safe === ADVISOR_REDACTION || containsAdvisorForbiddenOutputClass(safe) ? '' : boundedAdvisorText(safe, maxLength)
}

export function boundedAdvisorText(value: string, maxBytes = ADVISOR_ANSWER_TEXT_MAX_BYTES): string {
  if (byteLength(value) <= maxBytes) return value
  let end = value.length
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1
  return value.slice(0, end)
}
