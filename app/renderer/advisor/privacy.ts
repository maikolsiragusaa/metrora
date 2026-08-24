import type {
  AdvisorAnswer,
  AdvisorCoverage,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorJsonObject,
  AdvisorScope,
} from './types'

/**
 * The privacy boundary is intentionally conservative. It is used for values
 * that may cross into a model/tool payload, not for canonical evidence kept
 * inside Metrora. A redaction is explicit; it never invents a replacement.
 */
export const ADVISOR_MODEL_NARRATIVE_MAX_BYTES = 8 * 1024
export const ADVISOR_ANSWER_TEXT_MAX_BYTES = 8 * 1024
export const ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH = 160

const REDACTION = '[redacted]'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

// Only roots that are materially indicative of local filesystem provenance
// are classified here. Names such as "project/alpha" remain valid display
// names; a generic slash is not enough to make a project name sensitive.
const PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|(?:^|[\s([{])\\\\[^\s"'<>|]+|(?:^|[\s([{])(?:~[\\/]|\/(?:Users|users|home|private|var|tmp|mnt|opt|root|srv|workspace|workspaces)(?:\/|$))[^\s"'<>|,.;!?)]*|\b(?:file|local|vscode-file):\/\/[^\s"'<>|]+|(?:^|[\s([{])(?:\.\.?[\\/])[^\s"'<>|,.;!?)]*)/giu
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu
const KEY_PREFIX_PATTERN = /\b(?:sk|rk|pk|gh[pousr]|xox[baprs]-)[-_A-Za-z0-9]{12,}\b/giu
const RAW_CONTENT_MARKER_PATTERN = /(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|(?:prompt|response|source)[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*|source[_ -]?(?:code|snippet|content|snippets?)(?:[_ -]?(?:marker|text|content|snippet|should[_ -]?not[_ -]?leak))*)(?![\p{L}\p{N}])/giu
const NUMERIC_CHARACTER_PATTERN = /\p{N}/u
const NUMBER_WORD_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|first|second|third|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|primo|secondo|terzo)\b/iu
const CONTENT_MINIMAL_EVIDENCE_SOURCES = ['overview', 'history', 'models', 'quota'] as const
const CONTENT_MINIMAL_PROVIDER_NAMES = ['all', 'claude', 'codex'] as const
const SAFE_ANSWER_EVIDENCE_ID_PATTERN = /^(?:spend|quota|spend-(?:claude|codex)|overview\.(?:current|history\.daily|models|projects|sessions|modelAccounting)|models\.report|quota\.(?:claude|codex))$/u

function contentMinimalSource(value: unknown): typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_EVIDENCE_SOURCES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] : null
}
function contentMinimalProvider(value: unknown): typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_PROVIDER_NAMES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] : null
}
function contentMinimalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

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
  result = result.replace(PATH_PATTERN, REDACTION)
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, REDACTION)
  result = result.replace(BEARER_PATTERN, REDACTION)
  result = result.replace(KEY_PREFIX_PATTERN, REDACTION)
  result = result.replace(RAW_CONTENT_MARKER_PATTERN, REDACTION)
  result = result.split(/(\s+)/u).map(token => looksLikeHighEntropyCredential(token) ? REDACTION : token).join('')
  resetPatterns()
  return result
}

export function containsAdvisorSensitiveText(value: string): boolean {
  if (!value) return false
  const matched = PATH_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value) || BEARER_PATTERN.test(value) || KEY_PREFIX_PATTERN.test(value) || RAW_CONTENT_MARKER_PATTERN.test(value)
  resetPatterns()
  return matched || value.split(/\s+/u).some(looksLikeHighEntropyCredential)
}

/** Redacts sensitive spans while retaining safe factual text and digits. */
export function sanitizeAdvisorDisplayText(value: string, maxLength = ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized) return REDACTION
  const redacted = replaceSensitiveSegments(normalized).replace(/\s{2,}/gu, ' ').trim()
  if (!redacted) return REDACTION
  if (redacted.length <= maxLength) return redacted
  return redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…'
}

/**
 * Model prose has a stricter policy than human-facing deterministic facts:
 * any numeric claim or sensitive class invalidates the whole narrative.
 */
export function sanitizeAdvisorNarrative(value: string, maxBytes = ADVISOR_MODEL_NARRATIVE_MAX_BYTES): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized || containsAdvisorNumericClaim(normalized) || containsAdvisorSensitiveText(normalized)) return ''
  const safe = sanitizeAdvisorDisplayText(normalized, Number.MAX_SAFE_INTEGER)
  if (safe === REDACTION || containsAdvisorSensitiveText(safe) || containsAdvisorNumericClaim(safe)) return ''
  if (byteLength(safe) <= maxBytes) return safe
  return ''
}

export function boundedAdvisorText(value: string, maxBytes = ADVISOR_ANSWER_TEXT_MAX_BYTES): string {
  if (byteLength(value) <= maxBytes) return value
  let end = value.length
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) end -= 1
  return value.slice(0, end)
}

export function contentMinimalScope(scope: AdvisorScope): AdvisorScope {
  return {
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: contentMinimalProvider(scope.provider) ?? '[provider]',
    // Raw internal Project/account identities are not model-facing evidence.
    projectId: scope.projectId === 'all' ? 'all' : '[scoped-project]',
    projectName: sanitizeAdvisorDisplayText(scope.projectName),
    model: scope.model === null ? null : sanitizeAdvisorDisplayText(scope.model),
  }
}

export function contentMinimalCoverage(coverage: AdvisorCoverage): AdvisorCoverage {
  return {
    level: coverage.level,
    label: sanitizeAdvisorDisplayText(coverage.label),
    detail: sanitizeAdvisorDisplayText(coverage.detail),
  }
}

export function contentMinimalEvidenceRefs(refs: AdvisorEvidenceRef[]): AdvisorEvidenceRef[] {
  return refs.flatMap((ref, index) => {
    const source = contentMinimalSource(ref.source)
    if (!source) return []
    return [{
      // Evidence IDs are internal correlation keys. A stable local ordinal is
      // sufficient for the model and avoids exposing provider/account IDs.
      id: 'evidence-' + (index + 1),
      label: sanitizeAdvisorDisplayText(ref.label),
      source,
    }]
  })
}

export function sanitizeAdvisorAnswer(answer: AdvisorAnswer): AdvisorAnswer {
  const coverage = contentMinimalCoverage(answer.coverage)
  const safeText = (value: string) => boundedAdvisorText(sanitizeAdvisorDisplayText(value, Number.MAX_SAFE_INTEGER))
  return {
    ...answer,
    conclusion: safeText(answer.conclusion),
    scopeLabel: safeText(answer.scopeLabel),
    periodLabel: safeText(answer.periodLabel),
    evidence: answer.evidence.flatMap((ref, index) => {
      const source = contentMinimalSource(ref.source)
      if (!source) return []
      const candidate = sanitizeAdvisorDisplayText(ref.id, 64)
      const id = SAFE_ANSWER_EVIDENCE_ID_PATTERN.test(candidate) ? candidate : 'evidence-' + (index + 1)
      return [{ id, label: sanitizeAdvisorDisplayText(ref.label), source }]
    }),
    coverage,
    assumptions: answer.assumptions.map(safeText),
    unknown: answer.unknown.map(safeText),
    nextInvestigations: answer.nextInvestigations.map(safeText),
    details: answer.details.map(safeText),
  }
}

/** Explicitly allowlisted model-facing evidence projection. */
export function contentMinimalEvidence(evidence: AdvisorEvidence): AdvisorJsonObject {
  const spend = evidence.spend
    ? {
        measuredCostUSD: evidence.spend.measuredCostUSD,
        calls: evidence.spend.calls,
        sessions: evidence.spend.sessions,
        pricingCoverage: evidence.spend.pricingCoverage,
        models: evidence.spend.models.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        projects: evidence.spend.projects.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        sessionsByCost: evidence.spend.sessionsByCost.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        trend: evidence.spend.trend
          ? {
              direction: evidence.spend.trend.direction,
              latestCostUSD: evidence.spend.trend.latestCostUSD,
              comparisonCostUSD: evidence.spend.trend.comparisonCostUSD,
              deltaUSD: evidence.spend.trend.deltaUSD,
              deltaPercent: evidence.spend.trend.deltaPercent,
              latestDate: evidence.spend.trend.latestDate,
              comparisonLabel: sanitizeAdvisorDisplayText(evidence.spend.trend.comparisonLabel),
            }
          : null,
      }
    : null
  const modelEfficiency = evidence.modelEfficiency
    ? {
        selectedModel: evidence.modelEfficiency.selectedModel === null ? null : sanitizeAdvisorDisplayText(evidence.modelEfficiency.selectedModel),
        comparableWorkWarning: evidence.modelEfficiency.comparableWorkWarning,
        rows: evidence.modelEfficiency.rows.map(row => ({
          model: sanitizeAdvisorDisplayText(row.model),
          provider: contentMinimalProvider(row.provider) ?? '[provider]',
          calls: row.calls,
          costUSD: row.costUSD,
          outputTokens: row.outputTokens,
          costPerCallUSD: row.costPerCallUSD,
          pricingState: row.pricingState,
        })),
      }
    : null
  const quota = evidence.quota
    ? {
        measuredSpendUSD: evidence.quota.measuredSpendUSD,
        measuredCalls: evidence.quota.measuredCalls,
        providers: evidence.quota.providers.filter(provider => contentMinimalProvider(provider.provider) !== null).map(provider => ({
          provider: contentMinimalProvider(provider.provider)!,
          planLabel: provider.planLabel === null ? null : sanitizeAdvisorDisplayText(provider.planLabel),
          availability: provider.availability,
          connection: provider.connection,
          freshness: provider.freshness,
          observedAt: contentMinimalTimestamp(provider.observedAt),
          windows: provider.windows.map(window => ({
            label: sanitizeAdvisorDisplayText(window.label),
            usedPercent: window.usedPercent,
            remainingPercent: window.remainingPercent,
            resetsAt: contentMinimalTimestamp(window.resetsAt),
          })),
          creditsUSD: provider.creditsUSD,
        })),
      }
    : null
  return {
    intent: evidence.intent,
    scope: contentMinimalScope(evidence.scope),
    coverage: contentMinimalCoverage(evidence.coverage),
    refs: contentMinimalEvidenceRefs(evidence.refs),
    spend,
    modelEfficiency,
    quota,
    assumptions: evidence.assumptions.map(value => sanitizeAdvisorDisplayText(value)),
    unknown: evidence.unknown.map(value => sanitizeAdvisorDisplayText(value)),
    nextInvestigations: evidence.nextInvestigations.map(value => sanitizeAdvisorDisplayText(value)),
  }
}
