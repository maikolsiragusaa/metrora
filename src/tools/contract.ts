import {
  contentMinimalMetroraToolCoverage,
  contentMinimalMetroraToolEvidence,
  contentMinimalMetroraToolRefs,
  contentMinimalMetroraToolScope,
  containsMetroraToolSensitiveText,
  sanitizeMetroraToolText,
} from './privacy.js'
import type {
  MetroraToolArgumentName,
  MetroraToolAuthority,
  MetroraToolContract,
  MetroraToolDefinition,
  MetroraToolEvidence,
  MetroraToolEvidenceSemantics,
  MetroraToolFreshness,
  MetroraToolJsonObject,
  MetroraToolPeriod,
  MetroraToolPeriodFilter,
  MetroraToolScope,
  MetroraToolName,
  MetroraToolResultEnvelope,
} from './types.js'

// This is the stable wire identifier already used by the Advisor foundation.
// The public product name can move to Harness without breaking old transports.
export const METRORA_TOOL_CONTRACT_VERSION = 'advisor-tool-v1' as const
export const METRORA_TOOL_SCHEMA_VERSION = 1 as const
export const METRORA_TOOL_ARGUMENT_MAX_BYTES = 8 * 1024
export const METRORA_TOOL_OUTPUT_MAX_BYTES = 32 * 1024
export const METRORA_TOOL_MODEL_FILTER_MAX_LENGTH = 256

const PERIOD_VALUES = ['today', 'week', '30days', 'month', 'all', 'lifetime'] as const
const TOOL_PERIOD_VALUES = ['today', 'yesterday', 'week', '30days', 'month', 'all', 'lifetime'] as const
const PROVIDER_FILTER_VALUES = ['all', 'claude', 'codex'] as const
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

export type MetroraToolValidationCode =
  | 'unknown-tool'
  | 'invalid-arguments'
  | 'additional-argument'
  | 'invalid-argument-type'
  | 'invalid-argument-value'
  | 'argument-too-large'
  | 'invalid-scope'
  | 'authority-unavailable'
  | 'output-too-large'
  | 'invalid-output'

export class MetroraToolContractError extends Error {
  readonly code: MetroraToolValidationCode

  constructor(code: MetroraToolValidationCode, message: string) {
    super(message)
    this.name = 'MetroraToolContractError'
    this.code = code
  }
}

function definition(name: MetroraToolName, description: string, properties: Record<string, unknown> = {}): MetroraToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required: [], additionalProperties: false },
    },
  }
}

const definitions: readonly MetroraToolDefinition[] = Object.freeze([
  definition('get_spend_snapshot', 'Read Metrora measured spend, daily trend, model and Project drivers, and coverage for the selected scope.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' },
  }),
  definition('get_model_efficiency', 'Read canonical Metrora model rows and observed cost per call. Do not infer quality or comparable work.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope.' },
  }),
  definition('get_quota_snapshot', 'Read provider-reported quota windows, reset timestamps, freshness, and credits. Never estimate quota from Metrora spend.', {
    provider: { type: 'string', enum: [...PROVIDER_FILTER_VALUES], description: 'Optional factual supported-provider filter.' },
  }),
  definition('get_overview_snapshot', 'Read the current canonical Metrora overview for the selected period, Project, provider, and model context.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' },
  }),
  definition('get_project_drivers', 'Read descriptive Project spend drivers from the canonical Metrora overview. Do not infer causality.', {
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' },
  }),
  definition('get_session_highlights', 'Read content-minimal highest-cost session summaries from the canonical Metrora overview. No raw session content is exposed.', {
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' },
  }),
  definition('get_coverage_report', 'Read Metrora evidence coverage, assumptions, and unknowns for the selected scope.', {
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' },
  }),
  definition('get_bench_evidence', 'Read bounded canonical Bench history and compatible comparisons for the selected scope. Never start a Bench run.', {
    period: { type: 'string', enum: [...TOOL_PERIOD_VALUES], description: 'Optional bounded period refinement; it may only narrow the selected scope.' },
  }),
])

const allowedFilters: Readonly<Record<MetroraToolName, readonly MetroraToolArgumentName[]>> = Object.freeze({
  get_spend_snapshot: ['model', 'period'],
  get_model_efficiency: ['model', 'period'],
  get_quota_snapshot: ['provider'],
  get_overview_snapshot: ['model', 'period'],
  get_project_drivers: ['period'],
  get_session_highlights: ['period'],
  get_coverage_report: ['period'],
  get_bench_evidence: ['period'],
})

export const METRORA_TOOL_CONTRACT: MetroraToolContract = Object.freeze({
  contractVersion: METRORA_TOOL_CONTRACT_VERSION,
  schemaVersion: METRORA_TOOL_SCHEMA_VERSION,
  tools: definitions,
  scope: Object.freeze({
    immutable: true,
    dimensions: Object.freeze(['period', 'range', 'provider', 'projectId', 'projectName', 'model']),
    allowedFilters,
  }),
  output: Object.freeze({ maxBytes: METRORA_TOOL_OUTPUT_MAX_BYTES, privacy: 'content-minimal', jsonSafe: true }),
})
export const METRORA_TOOL_DEFINITIONS = definitions

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function jsonSafe(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return null
  if (seen.has(value)) throw new MetroraToolContractError('invalid-output', 'Metrora tool output must not contain cycles.')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => jsonSafe(item, seen))
    if (!isPlainObject(value)) return null
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) result[key] = jsonSafe(value[key], seen)
    return result
  } finally {
    seen.delete(value)
  }
}

export function boundedMetroraToolJson(value: unknown, maxBytes = METRORA_TOOL_OUTPUT_MAX_BYTES): string {
  const serialized = JSON.stringify(jsonSafe(value, new Set()))
  if (typeof serialized !== 'string') throw new MetroraToolContractError('invalid-output', 'Metrora tool output is not JSON-safe.')
  if (byteLength(serialized) > maxBytes) throw new MetroraToolContractError('output-too-large', 'Metrora tool output exceeded its safety limit.')
  return serialized
}

export function parseMetroraToolArguments(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (byteLength(value) > METRORA_TOOL_ARGUMENT_MAX_BYTES) throw new MetroraToolContractError('argument-too-large', 'Metrora tool arguments exceeded their safety limit.')
    try { parsed = JSON.parse(value) } catch { throw new MetroraToolContractError('invalid-arguments', 'Metrora tool arguments were not valid JSON.') }
  }
  if (!isPlainObject(parsed)) throw new MetroraToolContractError('invalid-arguments', 'Metrora tool arguments must be a JSON object.')
  return JSON.parse(boundedMetroraToolJson(parsed, METRORA_TOOL_ARGUMENT_MAX_BYTES)) as Record<string, unknown>
}

function modelFilter(value: unknown): string {
  if (typeof value !== 'string') throw new MetroraToolContractError('invalid-argument-type', 'Metrora model filter must be a string.')
  const normalized = value.trim()
  if (!normalized || normalized.length > METRORA_TOOL_MODEL_FILTER_MAX_LENGTH || CONTROL_CHARACTERS.test(normalized)) {
    throw new MetroraToolContractError('invalid-argument-value', 'Metrora model filter is malformed or too large.')
  }
  return normalized
}
function providerFilter(value: unknown): string {
  if (typeof value !== 'string') throw new MetroraToolContractError('invalid-argument-type', 'Metrora provider filter must be a string.')
  if (!(PROVIDER_FILTER_VALUES as readonly string[]).includes(value)) throw new MetroraToolContractError('invalid-argument-value', 'Metrora provider filter is not supported by the factual quota contract.')
  return value
}
function periodFilter(value: unknown): MetroraToolPeriodFilter {
  if (typeof value !== 'string') throw new MetroraToolContractError('invalid-argument-type', 'Metrora period filter must be a string.')
  if (!(TOOL_PERIOD_VALUES as readonly string[]).includes(value)) throw new MetroraToolContractError('invalid-argument-value', 'Metrora period filter is not supported by the bounded scope contract.')
  return value as MetroraToolPeriodFilter
}

export function isMetroraToolName(value: unknown): value is MetroraToolName {
  return typeof value === 'string' && definitions.some(item => item.function.name === value)
}
export function assertMetroraToolName(value: unknown): MetroraToolName {
  if (!isMetroraToolName(value)) throw new MetroraToolContractError('unknown-tool', 'Unknown Metrora tool: ' + String(value))
  return value
}
export function validateMetroraToolArguments(name: unknown, value: unknown): MetroraToolJsonObject {
  const tool = assertMetroraToolName(name)
  const args = parseMetroraToolArguments(value)
  const allowed = allowedFilters[tool]
  for (const key of Object.keys(args)) {
    if (!(allowed as readonly string[]).includes(key)) throw new MetroraToolContractError('additional-argument', 'Additional Metrora tool argument is not allowed: ' + key)
  }
  const normalized: MetroraToolJsonObject = {}
  if (Object.prototype.hasOwnProperty.call(args, 'model')) normalized.model = modelFilter(args.model)
  if (Object.prototype.hasOwnProperty.call(args, 'provider')) normalized.provider = providerFilter(args.provider)
  if (Object.prototype.hasOwnProperty.call(args, 'period')) normalized.period = periodFilter(args.period)
  return normalized
}
export function normalizeMetroraToolCall(name: unknown, value: unknown): { name: MetroraToolName; arguments: MetroraToolJsonObject } {
  const tool = assertMetroraToolName(name)
  return { name: tool, arguments: validateMetroraToolArguments(tool, value) }
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function scopeText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > METRORA_TOOL_MODEL_FILTER_MAX_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new MetroraToolContractError('invalid-scope', 'Metrora invocation ' + label + ' is invalid.')
  }
  return value.trim()
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}
export function snapshotMetroraToolScope(scope: MetroraToolScope): MetroraToolScope {
  if (!scope || typeof scope !== 'object' || !(PERIOD_VALUES as readonly string[]).includes(scope.period)) {
    throw new MetroraToolContractError('invalid-scope', 'Metrora invocation period is invalid.')
  }
  const range = scope.range
    ? (() => {
        if (!validDate(scope.range.from) || !validDate(scope.range.to) || scope.range.from > scope.range.to) throw new MetroraToolContractError('invalid-scope', 'Metrora invocation date range is invalid.')
        return { from: scope.range.from, to: scope.range.to }
      })()
    : null
  return deepFreeze({
    period: scope.period,
    range,
    provider: scopeText(scope.provider, 'provider'),
    projectId: scopeText(scope.projectId, 'Project'),
    projectName: scopeText(scope.projectName, 'Project name'),
    model: scope.model === null ? null : modelFilter(scope.model),
  })
}

export function sameMetroraToolScope(left: MetroraToolScope, right: MetroraToolScope): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}

export function nextMetroraToolScope(scope: MetroraToolScope, name: MetroraToolName, args: MetroraToolJsonObject): MetroraToolScope {
  const next = { ...scope, range: scope.range ? { ...scope.range } : null }
  if (typeof args.period === 'string') {
    if (args.period === 'yesterday') {
      if (scope.period === 'today' && !scope.range) throw new MetroraToolContractError('invalid-scope', 'A Metrora tool request cannot widen today to yesterday.')
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - 1)
      const value = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
      if (scope.range && (value < scope.range.from || value > scope.range.to)) throw new MetroraToolContractError('invalid-scope', 'The requested relative period is outside the selected scope.')
      next.period = 'today'
      next.range = { from: value, to: value }
    } else {
      const periodOrder: Record<MetroraToolPeriod, number> = { today: 0, week: 1, '30days': 2, month: 3, all: 4, lifetime: 5 }
      const requested = args.period as MetroraToolPeriod
      if ((scope.range && requested !== scope.period) || periodOrder[requested] > periodOrder[scope.period]) throw new MetroraToolContractError('invalid-scope', 'A Metrora tool request cannot widen the selected Metrora scope.')
      next.period = requested
      if (requested !== scope.period) next.range = null
    }
  }
  if (name === 'get_spend_snapshot' || name === 'get_model_efficiency' || name === 'get_overview_snapshot') {
    if (Object.prototype.hasOwnProperty.call(args, 'model')) {
      const requested = String(args.model)
      if (scope.model !== null && requested !== scope.model) throw new MetroraToolContractError('invalid-scope', 'A Metrora tool request cannot change the selected model scope.')
      next.model = requested
    }
  }
  if (name === 'get_quota_snapshot' && Object.prototype.hasOwnProperty.call(args, 'provider')) {
    const requested = String(args.provider)
    if (scope.provider !== 'all' && requested !== scope.provider) throw new MetroraToolContractError('invalid-scope', 'A Metrora quota request cannot change the selected provider scope.')
    next.provider = requested
  }
  return snapshotMetroraToolScope(next)
}

function authorityForTool(name: MetroraToolName, evidence: MetroraToolEvidence): MetroraToolAuthority {
  if (name === 'get_quota_snapshot') return evidence.quota && evidence.spend ? 'mixed' : 'provider-reported'
  return evidence.refs.some(ref => ref.source !== 'quota') ? 'metrora-canonical' : 'unknown'
}
function freshnessForTool(name: MetroraToolName, evidence: MetroraToolEvidence): MetroraToolFreshness {
  if (name !== 'get_quota_snapshot') return evidence.coverage.level === 'unavailable' ? 'unavailable' : 'unknown'
  const providers = evidence.quota?.providers ?? []
  const factual = providers.filter(provider => provider.windows.length > 0 || provider.planLabel !== null || provider.creditsUSD !== null)
  if (!factual.length) return 'unavailable'
  const fresh = factual.filter(provider => provider.freshness === 'fresh').length
  const stale = factual.filter(provider => provider.freshness === 'stale').length
  if (fresh === factual.length) return 'fresh'
  if (stale === factual.length) return 'stale'
  return 'mixed'
}
function semanticsForTool(name: MetroraToolName, evidence: MetroraToolEvidence): MetroraToolEvidenceSemantics[] {
  if (evidence.coverage.level === 'unavailable') return [{ source: 'unknown', authority: 'unknown', status: 'unknown' }]
  if (name === 'get_quota_snapshot') return [
    { source: 'quota', authority: 'provider-reported', status: 'observed' },
    ...(evidence.quota?.measuredSpendUSD !== null && evidence.quota?.measuredSpendUSD !== undefined ? [{ source: 'overview' as const, authority: 'metrora-canonical' as const, status: 'observed' as const }] : []),
  ]
  if (name === 'get_bench_evidence') return [{ source: 'bench', authority: 'metrora-canonical', status: 'observed' }]
  return [
    { source: 'overview', authority: 'metrora-canonical', status: 'observed' },
    ...(evidence.spend?.trend ? [{ source: 'history' as const, authority: 'metrora-canonical' as const, status: 'derived' as const }] : []),
    ...(evidence.modelEfficiency?.rows.some(row => row.costPerCallUSD !== null) ? [{ source: 'models' as const, authority: 'metrora-canonical' as const, status: 'derived' as const }] : []),
  ]
}

export function assertStrictBoundedMetroraToolContent(value: unknown): string {
  if (typeof value !== 'string') throw new MetroraToolContractError('invalid-output', 'Metrora tool content must be a string.')
  if (byteLength(value) > METRORA_TOOL_OUTPUT_MAX_BYTES) throw new MetroraToolContractError('output-too-large', 'Metrora tool content exceeded its safety limit.')
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new MetroraToolContractError('invalid-output', 'Metrora tool content must be valid JSON.') }
  if (!isPlainObject(parsed)) throw new MetroraToolContractError('invalid-output', 'Metrora tool content must be a JSON object.')
  const serialized = boundedMetroraToolJson(parsed)
  if (containsUnsafeMetroraToolContent(parsed)) throw new MetroraToolContractError('invalid-output', 'Metrora tool content failed the privacy boundary.')
  if (containsMetroraToolSensitiveText(serialized)) throw new MetroraToolContractError('invalid-output', 'Metrora tool content failed the privacy boundary.')
  return serialized
}

function containsUnsafeMetroraToolContent(value: unknown, key = ''): boolean {
  const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  const safeNumericToken = /^(?:inputtokens|outputtokens|totaltokens|cachereadtokens|cachewritetokens|reasoningtokens|additivereasoningtokens)$/u.test(normalizedKey)
  if (/(?:password|secret|credential|path|rawprompt|rawresponse|rawsource|prompt|response|snippet|sourcecode|windowid|accountid|sessionid|internalid)/u.test(normalizedKey)) return true
  if (/(?:token)/u.test(normalizedKey) && !safeNumericToken) return true
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return false
  if (typeof value === 'string') return containsMetroraToolSensitiveText(value)
  if (Array.isArray(value)) return value.some(item => containsUnsafeMetroraToolContent(item, key))
  if (!isPlainObject(value)) return true
  for (const [childKey, child] of Object.entries(value)) {
    const normalizedChildKey = childKey.replace(/[^a-z0-9]/giu, '').toLowerCase()
    if (normalizedChildKey === 'source' && (typeof child !== 'string' || !new Set(['overview', 'history', 'models', 'quota', 'bench']).has(child))) return true
    if (normalizedChildKey === 'provider' && (typeof child !== 'string' || !new Set(['all', 'claude', 'codex', '[provider]']).has(child))) return true
    if (normalizedChildKey === 'id' && (typeof child !== 'string' || !/^(?:[A-Za-z0-9._:-]{1,160}|evidence-\d+)$/u.test(child))) return true
    if (normalizedChildKey === 'projectid' && (typeof child !== 'string' || (child !== 'all' && child !== '[scoped-project]'))) return true
    if (containsUnsafeMetroraToolContent(child, childKey)) return true
  }
  return false
}

export function createMetroraToolResultEnvelope(name: MetroraToolName, scope: MetroraToolScope, args: MetroraToolJsonObject, evidence: MetroraToolEvidence, output: MetroraToolJsonObject): MetroraToolResultEnvelope {
  const safeScope = snapshotMetroraToolScope(contentMinimalMetroraToolScope(scope))
  void output
  const safeArguments: MetroraToolJsonObject = {}
  if (typeof args.model === 'string') safeArguments.model = sanitizeMetroraToolText(args.model)
  if (args.provider === 'all' || args.provider === 'claude' || args.provider === 'codex') safeArguments.provider = args.provider
  if (typeof args.period === 'string') safeArguments.period = args.period
  const safeCoverage = contentMinimalMetroraToolCoverage(evidence.coverage)
  const safeOutput = JSON.parse(boundedMetroraToolJson(contentMinimalMetroraToolEvidence(evidence))) as MetroraToolJsonObject
  const envelope: MetroraToolResultEnvelope = {
    contractVersion: METRORA_TOOL_CONTRACT_VERSION,
    schemaVersion: METRORA_TOOL_SCHEMA_VERSION,
    tool: name,
    scope: safeScope,
    arguments: safeArguments,
    authority: authorityForTool(name, evidence),
    freshness: freshnessForTool(name, evidence),
    coverage: safeCoverage,
    semantics: semanticsForTool(name, evidence),
    evidenceRefs: contentMinimalMetroraToolRefs(evidence.refs),
    unavailable: safeCoverage.level === 'unavailable',
    privacy: 'content-minimal',
    output: safeOutput,
  }
  boundedMetroraToolJson(envelope)
  return envelope
}

// Intentional compatibility alias for code that still imports the old symbol
// through an adapter. The canonical implementation remains this module.
export const assertBoundedMetroraToolContent = assertStrictBoundedMetroraToolContent
