import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'

import { projectHarnessText, type HarnessScopeInput } from './harness-runtime-types.js'

export type MetroraHarnessToolScope = HarnessScopeInput
export type MetroraHarnessToolName =
  | 'get_spend_snapshot'
  | 'get_model_efficiency'
  | 'get_quota_snapshot'
  | 'get_overview_snapshot'
  | 'get_project_drivers'
  | 'get_session_highlights'
  | 'get_coverage_report'
  | 'get_bench_evidence'

export type MetroraHarnessToolSource = {
  getOverview(scope: MetroraHarnessToolScope, signal?: AbortSignal): Promise<unknown>
  getModels(scope: MetroraHarnessToolScope, signal?: AbortSignal): Promise<unknown>
  getQuota(signal?: AbortSignal): Promise<unknown>
  getBenchEvidence?(scope: MetroraHarnessToolScope, signal?: AbortSignal): Promise<unknown>
}

type MetroraToolExecution = {
  contractVersion: 'advisor-tool-v1'
  schemaVersion: 1
  tool: MetroraHarnessToolName
  scope: MetroraHarnessToolScope
  arguments: Record<string, unknown>
  authority: 'metrora-canonical'
  freshness: 'fresh' | 'mixed' | 'unavailable'
  coverage: 'high' | 'partial' | 'unavailable'
  semantics: Array<{ source: 'overview' | 'history' | 'models' | 'quota' | 'bench' | 'unknown'; authority: 'metrora-canonical' | 'provider-reported' | 'mixed' | 'unknown'; status: 'observed' | 'derived' | 'estimated' | 'unknown' }>
  evidenceRefs: Array<{ id: string; label: string; source: 'overview' | 'history' | 'models' | 'quota' | 'bench' }>
  unavailable: boolean
  privacy: 'content-minimal'
  output: Record<string, unknown>
}

const TOOL_CONTRACT_VERSION = 'advisor-tool-v1' as const
const MAX_OUTPUT_BYTES = 32 * 1024
const MAX_MODEL_LENGTH = 256
const PERIOD_ORDER: Record<HarnessScopeInput['period'], number> = {
  today: 0,
  week: 1,
  '30days': 2,
  month: 3,
  all: 4,
  lifetime: 5,
}
const PERIODS = new Set([...Object.keys(PERIOD_ORDER), 'yesterday'])
const TOOL_PERIOD_VALUES = ['today', 'yesterday', 'week', '30days', 'month', 'all', 'lifetime'] as const
const PROVIDER_FILTER_VALUES = new Set(['all', 'claude', 'codex'])
const ALLOWED_ARGUMENTS: Record<MetroraHarnessToolName, readonly string[]> = {
  get_spend_snapshot: ['model', 'period'],
  get_model_efficiency: ['model', 'period'],
  get_quota_snapshot: ['provider'],
  get_overview_snapshot: ['model', 'period'],
  get_project_drivers: ['period'],
  get_session_highlights: ['period'],
  get_coverage_report: ['period'],
  get_bench_evidence: ['period'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function contentText(value: unknown): string {
  let encoded: string
  try { encoded = JSON.stringify(value) } catch { return '{"status":"unavailable","detail":"Metrora returned non-serializable evidence."}' }
  return encoded.length > MAX_OUTPUT_BYTES ? encoded.slice(0, MAX_OUTPUT_BYTES) : encoded
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return projectHarnessText(value, '')
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.slice(0, 128).map(item => sanitizeValue(item, depth + 1))
  if (!isRecord(value)) return null
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).slice(0, 256)) {
    if (/prompt|response|source|secret|password|credential|api[-_]?key|messages|raw|(?:^|[_-])path$/iu.test(key)) continue
    result[key] = typeof child === 'string' ? projectHarnessText(child, '') : sanitizeValue(child, depth + 1)
  }
  return result
}

function validateScope(scope: MetroraHarnessToolScope): MetroraHarnessToolScope {
  if (!isRecord(scope) || !(scope.period in PERIOD_ORDER)) throw new Error('Harness Metrora scope is invalid.')
  if (!isRecord(scope.range) && scope.range !== null) throw new Error('Harness Metrora date range is invalid.')
  if (scope.range && (typeof scope.range.from !== 'string' || typeof scope.range.to !== 'string' || !validDate(scope.range.from) || !validDate(scope.range.to) || scope.range.from > scope.range.to)) throw new Error('Harness Metrora date range is invalid.')
  for (const [key, value] of Object.entries(scope)) {
    if (key === 'range') continue
    if (key === 'model' && value === null) continue
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_MODEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Harness Metrora scope is invalid.')
  }
  if (scope.model !== null && (typeof scope.model !== 'string' || !scope.model.trim() || scope.model.length > MAX_MODEL_LENGTH)) throw new Error('Harness Metrora model scope is invalid.')
  return {
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: scope.provider,
    projectId: scope.projectId,
    projectName: scope.projectName,
    model: scope.model,
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function yesterdayLocalDate(): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - 1)
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function normalizedArgs(name: MetroraHarnessToolName, value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > 8 * 1024) throw new Error('Metrora tool arguments are too large.')
    try { parsed = JSON.parse(value) } catch { throw new Error('Metrora tool arguments must be valid JSON.') }
  }
  if (!isRecord(parsed)) throw new Error('Metrora tool arguments must be an object.')
  const allowed = new Set(ALLOWED_ARGUMENTS[name])
  if (Object.keys(parsed).some(key => !allowed.has(key))) throw new Error('Additional Metrora tool arguments are not allowed.')
  const result: Record<string, unknown> = {}
  if (parsed.model !== undefined) {
    if (typeof parsed.model !== 'string' || !parsed.model.trim() || parsed.model.length > MAX_MODEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(parsed.model)) throw new Error('Metrora model filter is invalid.')
    result.model = parsed.model.trim()
  }
  if (parsed.provider !== undefined) {
    if (typeof parsed.provider !== 'string' || !PROVIDER_FILTER_VALUES.has(parsed.provider)) throw new Error('Metrora provider filter is invalid.')
    result.provider = parsed.provider
  }
  if (parsed.period !== undefined) {
    if (typeof parsed.period !== 'string' || !PERIODS.has(parsed.period)) throw new Error('Metrora period filter is invalid.')
    result.period = parsed.period
  }
  return result
}

function effectiveScope(name: MetroraHarnessToolName, scope: MetroraHarnessToolScope, args: Record<string, unknown>): MetroraHarnessToolScope {
  let next: MetroraHarnessToolScope = { ...scope, range: scope.range ? { ...scope.range } : null }
  if (typeof args.period === 'string') {
    if (args.period === 'yesterday') {
      if (scope.period === 'today' && !scope.range) throw new Error('Metrora tool request cannot widen today to yesterday.')
      const value = yesterdayLocalDate()
      if (scope.range && (value < scope.range.from || value > scope.range.to)) throw new Error('Metrora tool request is outside the selected scope.')
      next = { ...next, period: 'today', range: { from: value, to: value } }
    } else {
      if (scope.range && args.period !== scope.period) throw new Error('Metrora tool request cannot change a ranged scope.')
      if (PERIOD_ORDER[args.period as HarnessScopeInput['period']] > PERIOD_ORDER[scope.period]) throw new Error('Metrora tool request cannot widen the selected scope.')
      next = { ...next, period: args.period as HarnessScopeInput['period'], range: args.period === scope.period ? scope.range : null }
    }
  }
  if ((name === 'get_spend_snapshot' || name === 'get_model_efficiency' || name === 'get_overview_snapshot') && typeof args.model === 'string') {
    if (scope.model !== null && args.model !== scope.model) throw new Error('Metrora tool request cannot change the selected model scope.')
    next.model = args.model
  }
  if (name === 'get_quota_snapshot' && typeof args.provider === 'string') {
    if (scope.provider !== 'all' && args.provider !== scope.provider) throw new Error('Metrora quota request cannot change the selected provider scope.')
    next.provider = args.provider
  }
  return next
}

function safeOutput(value: unknown): Record<string, unknown> {
  const projected = sanitizeValue(value)
  if (!isRecord(projected)) return { value: projected }
  if (jsonBytes(projected) <= MAX_OUTPUT_BYTES) return projected
  return { status: 'partial', detail: 'Metrora returned more evidence than the Harness output bound; the projection was clipped.' }
}

function schema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: [], additionalProperties: false }
}

const definitions: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description' | 'parameters'>> = [
  { name: 'get_spend_snapshot', description: 'Read Metrora measured spend, daily trend, model and Project drivers, and coverage for the selected scope.', parameters: schema({ model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' }, period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' } }) },
  { name: 'get_model_efficiency', description: 'Read canonical Metrora model rows and observed cost per call. Do not infer quality or comparable work.', parameters: schema({ model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' }, period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope.' } }) },
  { name: 'get_quota_snapshot', description: 'Read provider-reported quota windows, reset timestamps, freshness, and credits. Never estimate quota from Metrora spend.', parameters: schema({ provider: { type: 'string', enum: [...PROVIDER_FILTER_VALUES], description: 'Optional factual supported-provider filter.' } }) },
  { name: 'get_overview_snapshot', description: 'Read the current canonical Metrora overview for the selected period, Project, provider, and model context.', parameters: schema({ model: { type: 'string', description: 'Optional exact model filter; bounded identifier.' }, period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' } }) },
  { name: 'get_project_drivers', description: 'Read descriptive Project spend drivers from the canonical Metrora overview. Do not infer causality.', parameters: schema({ period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' } }) },
  { name: 'get_session_highlights', description: 'Read content-minimal highest-cost session summaries from the canonical Metrora overview. No raw session content is exposed.', parameters: schema({ period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' } }) },
  { name: 'get_coverage_report', description: 'Read Metrora evidence coverage, assumptions, and unknowns for the selected scope.', parameters: schema({ period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope or request yesterday.' } }) },
  { name: 'get_bench_evidence', description: 'Read bounded canonical Bench history and compatible comparisons for the selected scope. Never start a Bench run.', parameters: schema({ period: { type: 'string', enum: TOOL_PERIOD_VALUES, description: 'Optional bounded period refinement; it may only narrow the selected scope.' } }) },
]

/**
 * Direct registration of Metrora's first-party read tools in DSH's native
 * registry. No generic MCP round-trip is involved.
 */
export class MetroraToolBridge {
  private readonly source: MetroraHarnessToolSource
  private readonly scopes = new Map<string, MetroraHarnessToolScope>()
  private readonly registrations: Array<() => void> = []
  private defaultScope: MetroraHarnessToolScope | null = null

  constructor(source: MetroraHarnessToolSource) {
    this.source = source
  }

  setScope(sessionId: string, scope: MetroraHarnessToolScope): void {
    const validated = validateScope(scope)
    this.scopes.set(sessionId, validated)
    this.defaultScope ??= validated
  }

  register(ctx: Context): void {
    const tools = ctx.tools
    if (!tools) throw new Error('DSH ToolRuntime is unavailable.')
    this.registrations.push(ctx.on('agent/created', ({ agent }) => {
      const parentSession = agent.session.header.parentSession
      if (parentSession === undefined) return
      const scope = this.scopes.get(String(parentSession))
      if (scope) this.scopes.set(String(agent.id), scope)
    }))
    for (const definition of definitions) {
      const name = definition.name as MetroraHarnessToolName
      this.registrations.push(tools.register({
        ...definition,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args: unknown, value: any): ContentBlock[] => [{ type: 'text', text: contentText(value) }],
        },
        isConcurrencySafe: () => name !== 'get_quota_snapshot',
        execute: (args: unknown, execution: ToolRunContext) => this.execute(name, args, execution),
      }))
    }
  }

  dispose(): void {
    while (this.registrations.length) this.registrations.pop()?.()
  }

  private scopeFor(agent: Agent | undefined): MetroraHarnessToolScope {
    const id = agent?.id ? String(agent.id) : ''
    const scope = this.scopes.get(id) ?? this.defaultScope
    if (!scope) throw new Error('Metrora Harness scope is not bound to this conversation.')
    return scope
  }

  private async execute(name: MetroraHarnessToolName, value: unknown, execution: ToolRunContext): Promise<MetroraToolExecution> {
    const args = normalizedArgs(name, value)
    const scope = effectiveScope(name, this.scopeFor(execution.agent), args)
    let raw: unknown
    if (name === 'get_quota_snapshot') {
      raw = await this.source.getQuota(execution.signal)
      if (args.provider && args.provider !== 'all' && Array.isArray(raw)) raw = raw.filter(item => isRecord(item) && item.provider === args.provider)
    } else if (name === 'get_model_efficiency') {
      raw = await this.source.getModels({ ...scope, model: typeof args.model === 'string' ? args.model : scope.model }, execution.signal)
    } else if (name === 'get_bench_evidence') {
      raw = this.source.getBenchEvidence ? await this.source.getBenchEvidence(scope, execution.signal) : { state: 'UNAVAILABLE' }
    } else {
      raw = await this.source.getOverview({ ...scope, model: typeof args.model === 'string' ? args.model : scope.model }, execution.signal)
    }
    const output = safeOutput(raw)
    return {
      contractVersion: TOOL_CONTRACT_VERSION,
      schemaVersion: 1,
      tool: name,
      scope,
      arguments: args,
      authority: 'metrora-canonical',
      freshness: output.status === 'partial' || output.status === 'UNAVAILABLE' ? 'unavailable' : 'fresh',
      coverage: output.status === 'partial' ? 'partial' : output.status === 'UNAVAILABLE' ? 'unavailable' : 'high',
      semantics: [{
        source: name === 'get_quota_snapshot' ? 'quota' : name === 'get_bench_evidence' ? 'bench' : name === 'get_model_efficiency' ? 'models' : 'overview',
        authority: 'metrora-canonical',
        status: 'observed',
      }],
      evidenceRefs: [],
      unavailable: output.status === 'UNAVAILABLE',
      privacy: 'content-minimal',
      output,
    }
  }
}

export function metroraToolNames(): readonly string[] {
  return definitions.map(definition => definition.name)
}

/** Contract-shaped view used by conformance tests and diagnostics. */
export function metroraToolDefinitions(): ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return definitions.map(({ name, description, parameters }) => ({ name, description, parameters }))
}
