import type {
  MetroraToolCoverage,
  MetroraToolEvidence,
  MetroraToolEvidenceRef,
  MetroraToolJsonObject,
  MetroraToolJsonValue,
  MetroraToolScope,
} from './types.js'

export const METRORA_TOOL_CONTENT_MINIMAL_TEXT_MAX_LENGTH = 160
export const METRORA_TOOL_MODEL_NARRATIVE_MAX_BYTES = 8 * 1024

const REDACTION = '[redacted]'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g
const PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|(?:^|[\s([{])\\\\[^\s"'<>|]+|(?:^|[\s([{])(?:~[\\/]|\/(?:Users|users|home|private|var|tmp|mnt|opt|root|srv|workspace|workspaces)(?:\/|$))[^\s"'<>|,.;!?)]*|\b(?:file|local|vscode-file):\/\/[^\s"'<>|]+|(?:^|[\s([{])(?:\.\.?[\\/])[^\s"'<>|,.;!?)]*)/giu
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu
const KEY_PREFIX_PATTERN = /\b(?:sk|rk|pk|gh[pousr]|xox[baprs]-)[-_A-Za-z0-9]{12,}\b/giu
const RAW_CONTENT_PATTERN = /(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)|(?:prompt|response|source)[_ -]?(?:text|content|snippet|marker)|source[_ -]?(?:code|snippet|content))(?![\p{L}\p{N}])/giu
const SAFE_SOURCES = new Set(['overview', 'history', 'models', 'quota', 'bench'])
const SAFE_PROVIDERS = new Set(['all', 'claude', 'codex', 'copilot', 'kimi', 'antigravity'])
const SAFE_ID = /^(?:evidence-\d+|spend|quota|spend-(?:claude|codex)|overview\.(?:current|history\.daily|models|projects|sessions|modelAccounting)|models\.report|quota\.(?:claude|codex|copilot|kimi|antigravity)|bench\.(?:latest|history|comparison))$/u

function resetPatterns(): void {
  PATH_PATTERN.lastIndex = 0
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  BEARER_PATTERN.lastIndex = 0
  KEY_PREFIX_PATTERN.lastIndex = 0
  RAW_CONTENT_PATTERN.lastIndex = 0
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

function looksLikeCredential(value: string): boolean {
  if (value.length < 24 || /\s/u.test(value) || !/^[\p{L}\p{N}+/_=-]+$/u.test(value)) return false
  const classes = Number(/[\p{Ll}]/u.test(value)) + Number(/[\p{Lu}]/u.test(value)) + Number(/[\p{N}]/u.test(value)) + Number(/[+/_=-]/u.test(value))
  return classes >= 1 && entropy(value) >= 3.6
}

export function containsMetroraToolSensitiveText(value: string): boolean {
  if (!value) return false
  const matched = PATH_PATTERN.test(value) || SECRET_ASSIGNMENT_PATTERN.test(value) || BEARER_PATTERN.test(value) || KEY_PREFIX_PATTERN.test(value) || RAW_CONTENT_PATTERN.test(value)
  resetPatterns()
  return matched || value.split(/\s+/u).some(looksLikeCredential)
}

function replaceSensitiveSegments(value: string): string {
  let result = value
  result = result.replace(PATH_PATTERN, REDACTION)
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, REDACTION)
  result = result.replace(BEARER_PATTERN, REDACTION)
  result = result.replace(KEY_PREFIX_PATTERN, REDACTION)
  result = result.replace(RAW_CONTENT_PATTERN, REDACTION)
  result = result.split(/(\s+)/u).map(token => looksLikeCredential(token) ? REDACTION : token).join('')
  resetPatterns()
  return result
}

export function sanitizeMetroraToolText(value: string, maxLength = METRORA_TOOL_CONTENT_MINIMAL_TEXT_MAX_LENGTH): string {
  const normalized = value.replace(CONTROL_CHARACTERS, ' ').trim()
  if (!normalized) return REDACTION
  const safe = replaceSensitiveSegments(normalized).replace(/\s{2,}/gu, ' ').trim()
  if (!safe) return REDACTION
  if (safe.length <= maxLength) return safe
  return safe.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…'
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeValue(value: unknown, key = ''): MetroraToolJsonValue {
  if (value === null || typeof value === 'boolean') return value
  if (finite(value)) return value
  if (typeof value === 'string') return sanitizeMetroraToolText(value)
  if (Array.isArray(value)) return value.slice(0, 64).map(item => safeValue(item, key))
  if (!value || typeof value !== 'object') return null
  const output: MetroraToolJsonObject = {}
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
    const normalizedKey = childKey.replace(/[^a-z0-9]/giu, '').toLowerCase()
    const numericToken = /^(?:inputtokens|outputtokens|totaltokens|cachereadtokens|cachewritetokens|reasoningtokens|additivereasoningtokens|prompttokens|generationtokens)$/u.test(normalizedKey)
    if (!numericToken && /(?:password|secret|credential|path|rawprompt|rawresponse|rawsource|prompt|response|snippet|sourcecode|windowid|accountid|internalid)/u.test(normalizedKey)) continue
    if (/(?:token)/u.test(normalizedKey) && !numericToken) continue
    output[childKey] = safeValue(child, key + childKey)
  }
  return output
}

export function contentMinimalMetroraToolScope(scope: MetroraToolScope): MetroraToolScope {
  return {
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: SAFE_PROVIDERS.has(scope.provider) ? scope.provider : '[provider]',
    projectId: scope.projectId === 'all' ? 'all' : '[scoped-project]',
    projectName: sanitizeMetroraToolText(scope.projectName),
    model: scope.model === null ? null : sanitizeMetroraToolText(scope.model),
  }
}

export function contentMinimalMetroraToolCoverage(coverage: MetroraToolCoverage): MetroraToolCoverage {
  return {
    level: coverage.level,
    label: sanitizeMetroraToolText(coverage.label),
    detail: sanitizeMetroraToolText(coverage.detail),
    ...(coverage.state ? { state: coverage.state } : {}),
  }
}

export function contentMinimalMetroraToolRefs(refs: readonly MetroraToolEvidenceRef[]): MetroraToolEvidenceRef[] {
  return refs.slice(0, 24).flatMap((ref, index) => {
    if (!SAFE_SOURCES.has(ref.source)) return []
    return [{
      id: SAFE_ID.test(ref.id) ? ref.id : 'evidence-' + (index + 1),
      label: sanitizeMetroraToolText(ref.label),
      source: ref.source,
    }]
  })
}

function minimalList(values: readonly string[]): string[] {
  return values.slice(0, 16).map(value => sanitizeMetroraToolText(value))
}

export function contentMinimalMetroraToolEvidence(evidence: MetroraToolEvidence): MetroraToolJsonObject {
  const output: MetroraToolJsonObject = {
    intent: evidence.intent,
    scope: contentMinimalMetroraToolScope(evidence.scope) as unknown as MetroraToolJsonObject,
    refs: contentMinimalMetroraToolRefs(evidence.refs) as unknown as MetroraToolJsonValue,
    coverage: contentMinimalMetroraToolCoverage(evidence.coverage) as unknown as MetroraToolJsonObject,
    assumptions: minimalList(evidence.assumptions),
    unknown: minimalList(evidence.unknown),
    nextInvestigations: minimalList(evidence.nextInvestigations),
  }
  if (evidence.domainCoverage) {
    output.domainCoverage = evidence.domainCoverage.slice(0, 20).map(domain => ({
      domain: domain.domain,
      state: domain.state,
      detail: sanitizeMetroraToolText(domain.detail),
      evidenceRefs: contentMinimalMetroraToolRefs(domain.evidenceRefs),
    })) as unknown as MetroraToolJsonValue
  }
  if (evidence.spend) output.spend = safeValue(evidence.spend)
  if (evidence.modelEfficiency) output.modelEfficiency = safeValue(evidence.modelEfficiency)
  if (evidence.quota) output.quota = safeValue(evidence.quota)
  if (evidence.bench) output.bench = safeValue(evidence.bench)
  return output
}
