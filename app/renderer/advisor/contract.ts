import type {
  AdvisorCoverage,
  AdvisorEvidence,
  AdvisorEvidenceSemantics,
  AdvisorJsonObject,
  AdvisorScope,
  AdvisorToolArgumentName,
  AdvisorToolAuthority,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolFreshness,
  AdvisorToolName,
  AdvisorToolResultEnvelope,
} from './types'
import { ADVISOR_TOOL_CONTRACT_VERSION, ADVISOR_TOOL_SCHEMA_VERSION } from './types'
import { containsAdvisorSensitiveText, contentMinimalCoverage, contentMinimalEvidence, contentMinimalEvidenceRefs, contentMinimalScope, sanitizeAdvisorDisplayText } from './privacy'

/** Maximum untrusted argument content accepted from a model/runtime call. */
export const ADVISOR_TOOL_ARGUMENT_MAX_BYTES = 8 * 1024
/** Maximum serialized content returned to a model/runtime from one tool call. */
export const ADVISOR_TOOL_OUTPUT_MAX_BYTES = 32 * 1024
/** Exact model filters are identifiers, not arbitrary free-form scope objects. */
export const ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH = 256

const PERIOD_VALUES = ['today', 'week', '30days', 'month', 'all', 'lifetime'] as const
const PROVIDER_FILTER_VALUES = ['all', 'claude', 'codex'] as const
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export type AdvisorToolValidationCode =
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

export class AdvisorToolContractError extends Error {
  readonly code: AdvisorToolValidationCode

  constructor(code: AdvisorToolValidationCode, message: string) {
    super(message)
    this.name = 'AdvisorToolContractError'
    this.code = code
  }
}

function definition(
  name: AdvisorToolName,
  description: string,
  properties: Record<string, unknown> = {},
): AdvisorToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required: [],
        additionalProperties: false,
      },
    },
  }
}

const definitions: readonly AdvisorToolDefinition[] = Object.freeze([
  definition('get_spend_snapshot', 'Read Metrora measured spend, daily trend, model and Project drivers, and coverage for the selected scope.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
  }),
  definition('get_model_efficiency', 'Read canonical Metrora model rows and observed cost per call. Do not infer quality or comparable work.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
  }),
  definition('get_quota_snapshot', 'Read provider-reported quota windows, reset timestamps, freshness, and credits. Never estimate quota from Metrora spend.', {
    provider: { type: 'string', enum: [...PROVIDER_FILTER_VALUES], description: 'Optional factual supported-provider filter.' },
  }),
  definition('get_overview_snapshot', 'Read the current canonical Metrora overview for the selected period, Project, provider, and model context.', {
    model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' },
  }),
  definition('get_project_drivers', 'Read descriptive Project spend drivers from the canonical Metrora overview. Do not infer causality.'),
  definition('get_session_highlights', 'Read content-minimal highest-cost session summaries from the canonical Metrora overview. No raw session content is exposed.'),
  definition('get_coverage_report', 'Read Metrora evidence coverage, assumptions, and unknowns for the selected scope.'),
])

const allowedFilters: Readonly<Record<AdvisorToolName, readonly AdvisorToolArgumentName[]>> = Object.freeze({
  get_spend_snapshot: ['model'],
  get_model_efficiency: ['model'],
  get_quota_snapshot: ['provider'],
  get_overview_snapshot: ['model'],
  get_project_drivers: [],
  get_session_highlights: [],
  get_coverage_report: [],
})

export const ADVISOR_TOOL_CONTRACT: AdvisorToolContract = Object.freeze({
  contractVersion: ADVISOR_TOOL_CONTRACT_VERSION,
  schemaVersion: ADVISOR_TOOL_SCHEMA_VERSION,
  tools: definitions,
  scope: Object.freeze({
    immutable: true,
    dimensions: Object.freeze(['period', 'range', 'provider', 'projectId', 'projectName', 'model']),
    allowedFilters,
  }),
  output: Object.freeze({ maxBytes: ADVISOR_TOOL_OUTPUT_MAX_BYTES, privacy: 'content-minimal', jsonSafe: true }),
})

export const ADVISOR_TOOL_DEFINITIONS = definitions

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function jsonSafe(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return null
  if (seen.has(value)) throw new AdvisorToolContractError('invalid-output', 'Advisor tool output must not contain cycles.')
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

/** Serializes an allowlisted result deterministically and enforces the wire bound. */
export function boundedAdvisorJson(value: unknown, maxBytes = ADVISOR_TOOL_OUTPUT_MAX_BYTES): string {
  const safe = jsonSafe(value, new Set())
  const serialized = JSON.stringify(safe)
  if (typeof serialized !== 'string') throw new AdvisorToolContractError('invalid-output', 'Advisor tool output is not JSON-safe.')
  if (byteLength(serialized) > maxBytes) throw new AdvisorToolContractError('output-too-large', 'Advisor tool output exceeded its safety limit.')
  return serialized
}

export function parseAdvisorToolArguments(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (byteLength(value) > ADVISOR_TOOL_ARGUMENT_MAX_BYTES) throw new AdvisorToolContractError('argument-too-large', 'Advisor tool arguments exceeded their safety limit.')
    try { parsed = JSON.parse(value) } catch { throw new AdvisorToolContractError('invalid-arguments', 'Advisor tool arguments were not valid JSON.') }
  }
  if (!isPlainObject(parsed)) throw new AdvisorToolContractError('invalid-arguments', 'Advisor tool arguments must be a JSON object.')
  const serialized = boundedAdvisorJson(parsed, ADVISOR_TOOL_ARGUMENT_MAX_BYTES)
  return JSON.parse(serialized) as Record<string, unknown>
}

function modelFilter(value: unknown): string {
  if (typeof value !== 'string') throw new AdvisorToolContractError('invalid-argument-type', 'Advisor model filter must be a string.')
  const normalized = value.trim()
  if (!normalized) throw new AdvisorToolContractError('invalid-argument-value', 'Advisor model filter must not be empty.')
  if (normalized.length > ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH || CONTROL_CHARACTERS.test(normalized)) {
    throw new AdvisorToolContractError('invalid-argument-value', 'Advisor model filter is malformed or too large.')
  }
  return normalized
}

function providerFilter(value: unknown): string {
  if (typeof value !== 'string') throw new AdvisorToolContractError('invalid-argument-type', 'Advisor provider filter must be a string.')
  if (!(PROVIDER_FILTER_VALUES as readonly string[]).includes(value)) throw new AdvisorToolContractError('invalid-argument-value', 'Advisor provider filter is not supported by the factual quota contract.')
  return value
}

export function isAdvisorToolName(value: unknown): value is AdvisorToolName {
  return typeof value === 'string' && definitions.some(item => item.function.name === value)
}

export function assertAdvisorToolName(value: unknown): AdvisorToolName {
  if (!isAdvisorToolName(value)) throw new AdvisorToolContractError('unknown-tool', 'Unknown Advisor tool: ' + String(value))
  return value
}

export function validateAdvisorToolArguments(name: unknown, value: unknown): AdvisorJsonObject {
  const tool = assertAdvisorToolName(name)
  const args = parseAdvisorToolArguments(value)
  const allowed = allowedFilters[tool]
  for (const key of Object.keys(args)) {
    if (!(allowed as readonly string[]).includes(key)) throw new AdvisorToolContractError('additional-argument', 'Additional Advisor tool argument is not allowed: ' + key)
  }
  const normalized: AdvisorJsonObject = {}
  if (Object.prototype.hasOwnProperty.call(args, 'model')) normalized.model = modelFilter(args.model)
  if (Object.prototype.hasOwnProperty.call(args, 'provider')) normalized.provider = providerFilter(args.provider)
  return normalized
}

export function normalizeAdvisorToolCall(name: unknown, value: unknown): { name: AdvisorToolName; arguments: AdvisorJsonObject } {
  const tool = assertAdvisorToolName(name)
  return { name: tool, arguments: validateAdvisorToolArguments(tool, value) }
}

/**
 * Compatibility boundary for runtimes that have not yet received the full
 * Metrora contract envelope. Strict callers should pass `toolContract` and
 * use `normalizeAdvisorToolCall`; the looser path still rejects malformed
 * JSON, unknown identities, wrong primitive types, and arbitrary objects.
 */
export function normalizeAdvisorRuntimeToolCall(name: unknown, value: unknown, suppliedDefinitions: readonly AdvisorToolDefinition[] = []): { name: AdvisorToolName; arguments: AdvisorJsonObject } {
  const tool = assertAdvisorToolName(name)
  const definition = suppliedDefinitions.find(item => item.function.name === tool)
  const parameters = definition?.function.parameters
  if (parameters?.additionalProperties === false) return normalizeAdvisorToolCall(tool, value)
  const args = parseAdvisorToolArguments(value)
  const normalized: AdvisorJsonObject = {}
  for (const key of Object.keys(args)) {
    if (key === 'model') normalized.model = modelFilter(args.model)
    else if (key === 'provider') normalized.provider = providerFilter(args.provider)
    else throw new AdvisorToolContractError('additional-argument', 'Additional Advisor tool argument is not allowed: ' + key)
  }
  return { name: tool, arguments: normalized }
}

export function assertBoundedAdvisorToolContent(value: unknown): string {
  return assertStrictBoundedAdvisorToolContent(value)
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function scopeText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > ADVISOR_TOOL_MODEL_FILTER_MAX_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new AdvisorToolContractError('invalid-scope', 'Advisor invocation ' + label + ' is invalid.')
  }
  return value.trim()
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

/** Captures the Metrora-owned scope before a runtime can see or reuse it. */
export function snapshotAdvisorScope(scope: AdvisorScope): AdvisorScope {
  if (!scope || typeof scope !== 'object' || !(PERIOD_VALUES as readonly string[]).includes(scope.period)) {
    throw new AdvisorToolContractError('invalid-scope', 'Advisor invocation period is invalid.')
  }
  const range = scope.range
    ? (() => {
        if (!validDate(scope.range.from) || !validDate(scope.range.to) || scope.range.from > scope.range.to) throw new AdvisorToolContractError('invalid-scope', 'Advisor invocation date range is invalid.')
        return { from: scope.range.from, to: scope.range.to }
      })()
    : null
  const copy: AdvisorScope = {
    period: scope.period,
    range,
    provider: scopeText(scope.provider, 'provider'),
    projectId: scopeText(scope.projectId, 'Project'),
    projectName: scopeText(scope.projectName, 'Project name'),
    model: scope.model === null ? null : modelFilter(scope.model),
  }
  return deepFreeze(copy)
}

function authorityForTool(name: AdvisorToolName, evidence: AdvisorEvidence): AdvisorToolAuthority {
  if (name === 'get_quota_snapshot') return evidence.quota && evidence.spend ? 'mixed' : 'provider-reported'
  return evidence.refs.some(ref => ref.source === 'overview' || ref.source === 'history' || ref.source === 'models') ? 'metrora-canonical' : 'unknown'
}

function freshnessForTool(name: AdvisorToolName, evidence: AdvisorEvidence): AdvisorToolFreshness {
  if (name !== 'get_quota_snapshot') return evidence.coverage.level === 'unavailable' ? 'unavailable' : 'unknown'
  const providers = evidence.quota?.providers ?? []
  if (!providers.length) return 'unavailable'
  const factual = providers.filter(provider => provider.windows.length > 0 || provider.planLabel !== null || provider.creditsUSD !== null)
  if (!factual.length) return 'unavailable'
  const fresh = factual.filter(provider => provider.freshness === 'fresh').length
  const stale = factual.filter(provider => provider.freshness === 'stale').length
  if (fresh === factual.length) return 'fresh'
  if (stale === factual.length) return 'stale'
  return 'mixed'
}

function semanticsForTool(name: AdvisorToolName, evidence: AdvisorEvidence): AdvisorEvidenceSemantics[] {
  if (evidence.coverage.level === 'unavailable') return [{ source: 'unknown', authority: 'unknown', status: 'unknown' }]
  const semantics: AdvisorEvidenceSemantics[] = []
  if (name === 'get_quota_snapshot') {
    semantics.push({ source: 'quota', authority: 'provider-reported', status: 'observed' })
    if (evidence.quota?.measuredSpendUSD !== null && evidence.quota?.measuredSpendUSD !== undefined) semantics.push({ source: 'overview', authority: 'metrora-canonical', status: 'observed' })
  } else {
    semantics.push({ source: 'overview', authority: 'metrora-canonical', status: 'observed' })
    if (evidence.spend?.trend) semantics.push({ source: 'history', authority: 'metrora-canonical', status: 'derived' })
    if (evidence.modelEfficiency?.rows.some(row => row.costPerCallUSD !== null)) semantics.push({ source: 'models', authority: 'metrora-canonical', status: 'derived' })
  }
  return semantics
}

export function createAdvisorToolResultEnvelope(
  name: AdvisorToolName,
  scope: AdvisorScope,
  args: AdvisorJsonObject,
  evidence: AdvisorEvidence,
  output: AdvisorJsonObject,
): AdvisorToolResultEnvelope {
  return createContentMinimalAdvisorToolResultEnvelope(name, scope, args, evidence, output)
}
const CONTENT_MINIMAL_SOURCE_VALUES = new Set(['overview', 'history', 'models', 'quota', 'bench'])
const CONTENT_MINIMAL_PROVIDER_VALUES = new Set(['all', 'claude', 'codex', '[provider]'])

function containsUnsafeAdvisorToolContent(value: unknown, key = ''): boolean {
  const normalizedKey = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  if (/(?:token|password|secret|credential|path|rawprompt|rawresponse|rawsource|prompt|response|snippet|sourcecode|windowid|accountid|sessionid|internalid)/u.test(normalizedKey)) return true
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return false
  if (typeof value === 'string') return containsAdvisorSensitiveText(value)
  if (Array.isArray(value)) return value.some(item => containsUnsafeAdvisorToolContent(item, key))
  if (!isPlainObject(value)) return true
  for (const [childKey, child] of Object.entries(value)) {
    const normalizedChildKey = childKey.replace(/[^a-z0-9]/giu, '').toLowerCase()
    if (normalizedChildKey === 'source' && (typeof child !== 'string' || !CONTENT_MINIMAL_SOURCE_VALUES.has(child))) return true
    if (normalizedChildKey === 'provider' && (typeof child !== 'string' || !CONTENT_MINIMAL_PROVIDER_VALUES.has(child))) return true
    if (normalizedChildKey === 'id' && (typeof child !== 'string' || !/^evidence-\d+$/u.test(child))) return true
    if (normalizedChildKey === 'projectid' && (typeof child !== 'string' || (child !== 'all' && child !== '[scoped-project]'))) return true
    if (containsUnsafeAdvisorToolContent(child, childKey)) return true
  }
  return false
}/** Strict model-facing tool content parser. */
export function assertStrictBoundedAdvisorToolContent(value: unknown): string {
  if (typeof value !== 'string') throw new AdvisorToolContractError('invalid-output', 'Advisor tool content must be a string.')
  if (byteLength(value) > ADVISOR_TOOL_OUTPUT_MAX_BYTES) throw new AdvisorToolContractError('output-too-large', 'Advisor tool content exceeded its safety limit.')
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new AdvisorToolContractError('invalid-output', 'Advisor tool content must be valid JSON.') }
  if (!isPlainObject(parsed)) throw new AdvisorToolContractError('invalid-output', 'Advisor tool content must be a JSON object.')
  const serialized = boundedAdvisorJson(parsed, ADVISOR_TOOL_OUTPUT_MAX_BYTES)
  if (containsUnsafeAdvisorToolContent(parsed)) throw new AdvisorToolContractError('invalid-output', 'Advisor tool content failed the privacy boundary.')
  if (containsAdvisorSensitiveText(serialized)) throw new AdvisorToolContractError('invalid-output', 'Advisor tool content failed the privacy boundary.')
  return serialized
}

/** Result envelope boundary: only content-minimal scope/evidence crosses to a model. */
export function createContentMinimalAdvisorToolResultEnvelope(
  name: AdvisorToolName,
  scope: AdvisorScope,
  args: AdvisorJsonObject,
  evidence: AdvisorEvidence,
  output: AdvisorJsonObject,
): AdvisorToolResultEnvelope {
  const safeScope = snapshotAdvisorScope(contentMinimalScope(scope))
  void output
  const safeArguments: AdvisorJsonObject = {}
  if (typeof args.model === 'string') safeArguments.model = sanitizeAdvisorDisplayText(args.model)
  if (args.provider === 'claude' || args.provider === 'codex') safeArguments.provider = args.provider
  const safeCoverage = contentMinimalCoverage(evidence.coverage)
  const safeOutput = JSON.parse(boundedAdvisorJson(contentMinimalEvidence(evidence), ADVISOR_TOOL_OUTPUT_MAX_BYTES)) as AdvisorJsonObject
  const envelope: AdvisorToolResultEnvelope = {
    contractVersion: ADVISOR_TOOL_CONTRACT_VERSION,
    schemaVersion: ADVISOR_TOOL_SCHEMA_VERSION,
    tool: name,
    scope: safeScope,
    arguments: safeArguments,
    authority: authorityForTool(name, evidence),
    freshness: freshnessForTool(name, evidence),
    coverage: safeCoverage,
    semantics: semanticsForTool(name, evidence),
    evidenceRefs: contentMinimalEvidenceRefs(evidence.refs),
    unavailable: safeCoverage.level === 'unavailable',
    privacy: 'content-minimal',
    output: safeOutput,
  }
  boundedAdvisorJson(envelope, ADVISOR_TOOL_OUTPUT_MAX_BYTES)
  return envelope
}
