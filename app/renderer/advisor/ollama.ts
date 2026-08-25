import { metrora } from '../lib/ipc'
import { DeterministicAdvisorRuntime } from './runtime'
import { AdvisorToolContractError, assertStrictBoundedAdvisorToolContent, normalizeAdvisorRuntimeToolCall, normalizeAdvisorToolCall } from './contract'
import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorCoverageLevel, type AdvisorEvidence, type AdvisorModelRuntime, type AdvisorRuntimeInput, type AdvisorToolExecution } from './types'
import { ADVISOR_MODEL_NARRATIVE_MAX_BYTES, contentMinimalEvidence, sanitizeAdvisorAnswer } from './privacy'
import { buildAdvisorPresentationBlocks } from './presentation'
import { parseAdvisorSynthesisDraft, verifyAdvisorSynthesis } from './synthesis'

export type LocalToolCall = { function?: { name?: string; arguments?: unknown } }
export type LocalChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: LocalToolCall[]; tool_name?: string }
export type LocalChatResponse = { message?: { content?: string; tool_calls?: LocalToolCall[] }; streamed?: boolean }
type OllamaToolCall = LocalToolCall
type OllamaChatMessage = LocalChatMessage
type OllamaResponse = LocalChatResponse
export type OllamaProbeResult = { available: boolean; models: string[]; detail: string }
export type LocalAdvisorTransport = {
  chat: (requestId: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<LocalChatResponse>
  cancel: (requestId: string) => Promise<boolean>
  onDelta: (callback: (event: { requestId: string; text: string }) => void) => () => void
}
export type OllamaTransport = LocalAdvisorTransport & {
  probe: (signal?: AbortSignal) => Promise<OllamaProbeResult>
}
const bridgeTransport: OllamaTransport = {
  probe: signal => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorProbe()
  },
  chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorChat(requestId, payload)
  },
  cancel: requestId => metrora.advisorCancel(requestId),
  onDelta: callback => metrora.onAdvisorDelta(callback),
}
export async function probeOllama(signal?: AbortSignal, transport: OllamaTransport = bridgeTransport): Promise<OllamaProbeResult> {
  try {
    return await transport.probe(signal)
  } catch (error) {
    if (signal?.aborted) throw error
    return { available: false, models: [], detail: 'Local Ollama is unavailable.' }
  }
}
function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
function boundedModelText(value: unknown): string {
  if (typeof value !== 'string' || byteLength(value) > ADVISOR_MODEL_NARRATIVE_MAX_BYTES) return ''
  return value
}
function systemPrompt(): string {
  return [
    'You are Metrora Advisor, a read-only conversational investigator for local Metrora data.',
    'Answer natural-language questions freely inside Metrora usage, Projects, models, sessions, spend, pricing coverage, and provider quota.',
    'Use the supplied evidence tools before factual claims. You may call more than one tool and refine the investigation.',
    'Never invent arithmetic, prices, Project membership, history, quota, permissions, or causal certainty.',
    'Use natural plain language. For factual numbers, dates, provider/model identity, scope, trends, quota, or Bench claims, return a claim with evidenceRefs and evidencePaths; never invent a value.',
    'Bench results are controlled evidence for one task pack; never rank models, recommend a purchase, or generalize the result.',
    'If the question is outside Metrora, explain the boundary briefly and suggest a supported investigation.',
  ].join(' ')
}

function synthesisContractPrompt(): string {
  return 'After the evidence is available, return only a JSON object with contractVersion "advisor-synthesis-draft-v1", schemaVersion 1, conclusion, why, details, claims, and presentationRequests. Each material claim must include class, text, value, evidenceRefs, and evidencePaths pointing into the verified evidence object. Causal, forecast, and recommendation claims are unsupported. presentationRequests may request only text, metric-cards, line-chart, bar-chart, comparison-table, quota-card, bench-summary, warning, or evidence-disclosure; do not include chart values.'
}
export function sameEvidenceScope(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}
export function hasMixedEvidenceScopes(items: AdvisorEvidence[]): boolean {
  return items.length > 1 && items.some(item => !sameEvidenceScope(item.scope, items[0]!.scope))
}
export function mergeEvidence(items: AdvisorEvidence[], fallback: AdvisorEvidence): AdvisorEvidence {
  if (hasMixedEvidenceScopes(items)) {
    return {
      intent: 'unknown',
      question: fallback.question,
      scope: fallback.scope,
      refs: [],
      coverage: { level: 'unavailable', label: 'Conflicting evidence scopes', detail: 'Tool evidence from different scopes was rejected instead of being combined.' },
      assumptions: [],
      unknown: ['The local model requested evidence from different scopes; no cross-scope facts were combined.'],
      nextInvestigations: ['Repeat the investigation with one explicit period, Project, provider, and model scope.'],
    }
  }
  const last = items[items.length - 1]!
  const usable = items.filter(item => item.coverage.level !== 'unavailable')
  const level: AdvisorCoverageLevel = items.length > 0 && items.every(item => item.coverage.level === 'high')
    ? 'high'
    : usable.length
      ? 'partial'
      : 'unavailable'
  const coverage = level === 'high'
    ? { level: 'high' as const, label: 'High coverage', detail: 'All requested evidence tools returned usable canonical records.' }
    : level === 'partial'
      ? { level: 'partial' as const, label: 'Partial coverage', detail: 'Some requested evidence is usable; other dimensions remain limited or unavailable.' }
      : { level: 'unavailable' as const, label: 'Unavailable', detail: 'The requested canonical evidence was not available.' }
  const unique = <T>(values: T[]) => Array.from(new Set(values))
  const refs = Array.from(new Map(items.flatMap(item => item.refs).map(ref => [ref.id + '|' + ref.label, ref])).values())
  const spendRows = items.flatMap(item => item.spend ? [item.spend] : [])
  const modelRows = items.flatMap(item => item.modelEfficiency ? [item.modelEfficiency] : [])
  const quotaRows = items.flatMap(item => item.quota ? [item.quota] : [])
  const spend = spendRows[0] ? {
    ...spendRows[0],
    models: unique(spendRows.flatMap(item => item.models.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.models).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    projects: unique(spendRows.flatMap(item => item.projects.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.projects).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    sessionsByCost: unique(spendRows.flatMap(item => item.sessionsByCost.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.sessionsByCost).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
  } : undefined
  const modelEfficiency = modelRows[0] ? {
    ...modelRows[modelRows.length - 1],
    rows: unique(modelRows.flatMap(item => item.rows.map(row => row.provider + '|' + row.model)).map(key => modelRows.flatMap(item => item.rows).find(row => row.provider + '|' + row.model === key)!)),
    comparableWorkWarning: modelRows.some(item => item.comparableWorkWarning),
  } : undefined
  const quota = quotaRows[0] ? {
    ...quotaRows[quotaRows.length - 1],
    providers: unique(quotaRows.flatMap(item => item.providers.map(row => row.provider)).map(provider => quotaRows.flatMap(item => item.providers).find(row => row.provider === provider)!)),
  } : undefined
  return {
    ...last,
    refs,
    coverage,
    assumptions: unique(items.flatMap(item => item.assumptions)),
    unknown: unique(items.flatMap(item => item.unknown)),
    nextInvestigations: unique(items.flatMap(item => item.nextInvestigations)),
    ...(modelEfficiency ? { modelEfficiency } : {}),
    ...(quota ? { quota } : {}),
    ...(spend ? {
      spend: {
        ...spend,
        history: spendRows.flatMap(item => item.history).slice(-30),
        modelHistory: spendRows.flatMap(item => item.modelHistory).slice(-8),
      },
    } : {}),
    domainCoverage: Array.from(new Map(items.flatMap(item => item.domainCoverage ?? []).map(item => [item.domain, item])).values()),
  }
}
function toolCallName(call: OllamaToolCall): string {
  return typeof call.function?.name === 'string' ? call.function.name : ''
}
function boundedToolContent(content: string): string {
  return assertStrictBoundedAdvisorToolContent(content)
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
}
function safeConversation(input: AdvisorRuntimeInput): OllamaChatMessage[] {
  const currentScopeFingerprint = advisorScopeFingerprint(input.evidence.scope)
  return (input.conversation ?? []).filter(turn => turn.scopeFingerprint === currentScopeFingerprint).slice(-12).flatMap(turn => {
    const content = turn.content.trim().slice(0, 4000)
    return content ? [{ role: turn.role, content }] : []
  })
}
export type LocalAdvisorRuntimeOptions = {
  id: string
  label: string
  mode: AdvisorAnswer['runtime']['mode']
  providerSupport: readonly string[]
  model: string
  transport: LocalAdvisorTransport
  availability?: 'ready' | 'checking' | 'unavailable'
  unavailableMessage?: string
}
export class LocalAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly mode: AdvisorAnswer['runtime']['mode']
  readonly providerSupport: readonly string[]
  readonly supportsStreaming = true
  readonly label: string
  readonly availability: 'ready' | 'checking' | 'unavailable'
  private readonly model: string
  private readonly transport: LocalAdvisorTransport
  private readonly unavailableMessage: string
  constructor(options: LocalAdvisorRuntimeOptions) {
    this.id = options.id
    this.mode = options.mode
    this.providerSupport = options.providerSupport
    this.model = options.model
    this.transport = options.transport
    this.availability = options.availability ?? 'ready'
    this.label = options.label
    this.unavailableMessage = options.unavailableMessage ?? 'Local Advisor model is not available.'
  }
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (this.availability !== 'ready') throw new Error(this.unavailableMessage)
    throwIfAborted(signal)
    const requestId = 'advisor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    const messages: OllamaChatMessage[] = [{ role: 'system', content: systemPrompt() }, ...safeConversation(input)]
    messages.push({ role: 'user', content: input.question.trim().slice(0, 4000) })
    const verifiedFacts = boundedToolContent(JSON.stringify(contentMinimalEvidence(input.evidence)))
    messages.push({ role: 'system', content: 'Verified Metrora facts for this question. Treat them as read-only facts; do not recompute or add numbers: ' + verifiedFacts })
    const evidences: AdvisorEvidence[] = []
    let finalContent = ''
    const cancel = () => { void this.transport.cancel(requestId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      throwIfAborted(signal)
      const definitions = input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : []
      const planning = await this.transport.chat(requestId, {
        model: this.model,
        messages,
        tools: definitions,
        stream: definitions.length === 0,
      }, signal)
      throwIfAborted(signal)
      const planningMessage = planning.message ?? {}
      const calls = Array.isArray(planningMessage.tool_calls) ? planningMessage.tool_calls.slice(0, 8) : []
      const planningContent = boundedModelText(planningMessage.content)
      finalContent = planningContent
      if (!calls.length) {
        messages.push({ role: 'assistant', content: planningContent, tool_calls: [] })
      } else {
        const assistantMessage: OllamaChatMessage = { role: 'assistant', content: planningContent, tool_calls: [] }
        messages.push(assistantMessage)
        const normalizedCalls: OllamaToolCall[] = []
        for (const call of calls) {
          throwIfAborted(signal)
          if (!call || typeof call !== 'object') throw new AdvisorToolContractError('invalid-arguments', 'Malformed Advisor runtime tool call.')
          const normalized = input.toolContract
            ? normalizeAdvisorToolCall(toolCallName(call), call.function?.arguments)
            : normalizeAdvisorRuntimeToolCall(toolCallName(call), call.function?.arguments, definitions)
          normalizedCalls.push({ function: { name: normalized.name, arguments: JSON.stringify(normalized.arguments) } })
          input.onToolEvent?.({ name: normalized.name, status: 'started' })
          if (!input.executeTool) throw new AdvisorToolContractError('authority-unavailable', 'Advisor tool execution is unavailable.')
          const result: AdvisorToolExecution = await input.executeTool(normalized.name, normalized.arguments, signal)
          throwIfAborted(signal)
          evidences.push(result.evidence)
          messages.push({ role: 'tool', content: boundedToolContent(result.content), tool_name: normalized.name })
          input.onToolEvent?.({ name: normalized.name, status: 'completed' })
        }
        assistantMessage.tool_calls = normalizedCalls
        const validToolEvidence = !hasMixedEvidenceScopes(evidences)
          && evidences.some(item => item.intent !== 'unknown' && item.coverage.level !== 'unavailable' && item.refs.length > 0)
        throwIfAborted(signal)
        if (validToolEvidence) {
          messages.push({ role: 'system', content: synthesisContractPrompt() })
          const final = await this.transport.chat(requestId, {
            model: this.model,
            messages,
            tools: [],
            stream: false,
          }, signal)
          throwIfAborted(signal)
          finalContent = boundedModelText(final.message?.content)
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    throwIfAborted(signal)
    const evidenceItems = evidences.length ? evidences : [input.evidence]
    const evidence = mergeEvidence(evidenceItems, input.evidence)
    const homogeneous = !hasMixedEvidenceScopes(evidenceItems)
    const deterministicItems = homogeneous ? evidenceItems : [evidence]
    const deterministicAnswers = await Promise.all(deterministicItems.map(item => new DeterministicAdvisorRuntime().generate({ question: input.question, evidence: item }, signal)))
    const fallback = await new DeterministicAdvisorRuntime().generate({ question: input.question, evidence }, signal)
    throwIfAborted(signal)
    const verifiedConclusions = Array.from(new Set(deterministicAnswers.map(answer => answer.conclusion).filter(Boolean)))
    const verifiedConclusion = verifiedConclusions.length ? verifiedConclusions.join(' ') : fallback.conclusion
    const details = Array.from(new Set([
      ...deterministicAnswers.flatMap(answer => answer.details),
      ...fallback.details,
      ...(homogeneous ? evidences.flatMap(item => item.refs.map(ref => 'Evidence · ' + ref.label)) : []),
    ]))
    const draft = parseAdvisorSynthesisDraft(finalContent)
    const verification = draft ? verifyAdvisorSynthesis(draft, evidence) : null
    const plan = input.plan ?? input.evidence.plan
    if (draft && verification?.valid && plan) {
      return sanitizeAdvisorAnswer({
        ...fallback,
        conclusion: draft.conclusion,
        why: draft.why,
        details: draft.details,
        claims: verification.claims.filter(claim => claim.status === 'verified'),
        synthesis: { ...draft, claims: verification.claims },
        presentation: buildAdvisorPresentationBlocks(evidence, plan, input.question, draft),
        runtime: { id: this.id, label: this.label, mode: this.mode },
        generatedByModel: true,
        streamed: false,
      })
    }
    return sanitizeAdvisorAnswer({
      ...fallback,
      conclusion: verifiedConclusion,
      details,
      materialLimits: [...(fallback.materialLimits ?? []), ...(draft ? ['The model explanation did not pass Metrora claim verification; verified facts are shown instead.'] : [])],
      presentation: plan ? buildAdvisorPresentationBlocks(evidence, plan, input.question) : undefined,
      runtime: { id: this.id, label: this.label, mode: this.mode },
      generatedByModel: true,
      streamed: false,
    })
  }
}

export class OllamaAdvisorRuntime extends LocalAdvisorRuntime {
  constructor(options: { model: string; transport?: OllamaTransport; availability?: 'ready' | 'checking' | 'unavailable' }) {
    super({
      id: 'ollama-local',
      label: 'Ollama · ' + options.model,
      mode: 'ollama-local',
      providerSupport: ['Ollama official local API'],
      model: options.model,
      transport: options.transport ?? bridgeTransport,
      availability: options.availability,
      unavailableMessage: 'Local Ollama model is not available.',
    })
  }
}
