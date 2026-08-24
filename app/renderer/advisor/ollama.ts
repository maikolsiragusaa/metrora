import { metrora } from '../lib/ipc'
import { DeterministicAdvisorRuntime } from './runtime'
import { ADVISOR_TOOL_OUTPUT_MAX_BYTES, AdvisorToolContractError, normalizeAdvisorRuntimeToolCall, normalizeAdvisorToolCall } from './contract'
import { advisorScopeFingerprint, type AdvisorAnswer, type AdvisorCoverageLevel, type AdvisorEvidence, type AdvisorModelRuntime, type AdvisorRuntimeInput, type AdvisorToolExecution } from './types'

type OllamaToolCall = { function?: { name?: string; arguments?: unknown } }
type OllamaChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: OllamaToolCall[]; tool_name?: string }
type OllamaResponse = { message?: { content?: string; tool_calls?: OllamaToolCall[] }; streamed?: boolean }
export type OllamaProbeResult = { available: boolean; models: string[]; detail: string }
export type OllamaTransport = {
  probe: (signal?: AbortSignal) => Promise<OllamaProbeResult>
  chat: (requestId: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<OllamaResponse>
  cancel: (requestId: string) => Promise<boolean>
  onDelta: (callback: (event: { requestId: string; text: string }) => void) => () => void
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
function extractNarrative(value: string): string {
  const trimmed = value.trim().replace(/^\s*\x60\x60\x60(?:json|text)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim()
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ['conclusion', 'answer', 'message']) if (typeof parsed[key] === 'string') return parsed[key] as string
  } catch { /* Plain text is valid. */ }
  return trimmed
}
function sanitizeNarrative(value: string): string {
  const original = extractNarrative(value)
  if (/\d/.test(original)) return ''
  const text = original.trim()
  return text.length > 800 ? text.slice(0, 797) + '…' : text
}
function systemPrompt(): string {
  return [
    'You are Metrora Advisor, a read-only conversational investigator for local Metrora data.',
    'Answer natural-language questions freely inside Metrora usage, Projects, models, sessions, spend, pricing coverage, and provider quota.',
    'Use the supplied evidence tools before factual claims. You may call more than one tool and refine the investigation.',
    'Never invent arithmetic, prices, Project membership, history, quota, permissions, or causal certainty.',
    'Keep the narrative plain-language and qualitative; do not write numeric factual claims, dates, paths, secrets, prompts, or hidden reasoning. Verified tool facts render separately.',
    'If the question is outside Metrora, explain the boundary briefly and suggest a supported investigation.',
  ].join(' ')
}
function sameEvidenceScope(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}
function hasMixedEvidenceScopes(items: AdvisorEvidence[]): boolean {
  return items.length > 1 && items.some(item => !sameEvidenceScope(item.scope, items[0]!.scope))
}
function mergeEvidence(items: AdvisorEvidence[], fallback: AdvisorEvidence): AdvisorEvidence {
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
    ...(spend ? { spend } : {}),
    ...(modelEfficiency ? { modelEfficiency } : {}),
    ...(quota ? { quota } : {}),
  }
}
function toolCallName(call: OllamaToolCall): string {
  return typeof call.function?.name === 'string' ? call.function.name : ''
}
function boundedToolContent(content: string): string {
  if (new TextEncoder().encode(content).byteLength > ADVISOR_TOOL_OUTPUT_MAX_BYTES) throw new AdvisorToolContractError('output-too-large', 'Advisor tool content exceeded its safety limit.')
  return content
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
export class OllamaAdvisorRuntime implements AdvisorModelRuntime {
  readonly id = 'ollama-local'
  readonly mode = 'ollama-local' as const
  readonly providerSupport = ['Ollama official local API'] as const
  readonly supportsStreaming = true
  readonly label: string
  readonly availability: 'ready' | 'checking' | 'unavailable'
  private readonly model: string
  private readonly transport: OllamaTransport
  constructor(options: { model: string; transport?: OllamaTransport; availability?: 'ready' | 'checking' | 'unavailable' }) {
    this.model = options.model
    this.transport = options.transport ?? bridgeTransport
    this.availability = options.availability ?? 'ready'
    this.label = 'Ollama · ' + options.model
  }
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (this.availability !== 'ready') throw new Error('Local Ollama model is not available.')
    throwIfAborted(signal)
    const requestId = 'advisor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    const messages: OllamaChatMessage[] = [{ role: 'system', content: systemPrompt() }, ...safeConversation(input)]
    messages.push({ role: 'user', content: input.question.trim().slice(0, 4000) })
    const evidences: AdvisorEvidence[] = []
    let finalContent = ''
    let streamed = false
    let allowDelta = false
    const offDelta = this.transport.onDelta(event => {
      if (event.requestId === requestId && allowDelta && !/\d/.test(event.text)) {
        streamed = true
        input.onDelta?.(event.text)
      }
    })
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
      messages.push({ role: 'assistant', content: typeof planningMessage.content === 'string' ? planningMessage.content : '', tool_calls: calls })
      if (!calls.length) {
        finalContent = typeof planningMessage.content === 'string' ? planningMessage.content : ''
      } else {
        for (const call of calls) {
          throwIfAborted(signal)
          if (!call || typeof call !== 'object') throw new AdvisorToolContractError('invalid-arguments', 'Malformed Advisor runtime tool call.')
          const normalized = input.toolContract
            ? normalizeAdvisorToolCall(toolCallName(call), call.function?.arguments)
            : normalizeAdvisorRuntimeToolCall(toolCallName(call), call.function?.arguments, definitions)
          input.onToolEvent?.({ name: normalized.name, status: 'started' })
          if (!input.executeTool) throw new AdvisorToolContractError('authority-unavailable', 'Advisor tool execution is unavailable.')
          const result: AdvisorToolExecution = await input.executeTool(normalized.name, normalized.arguments, signal)
          throwIfAborted(signal)
          evidences.push(result.evidence)
          messages.push({ role: 'tool', content: boundedToolContent(result.content), tool_name: normalized.name })
          input.onToolEvent?.({ name: normalized.name, status: 'completed' })
        }
        const validToolEvidence = !hasMixedEvidenceScopes(evidences)
          && evidences.some(item => item.intent !== 'unknown' && item.coverage.level !== 'unavailable' && item.refs.length > 0)
        throwIfAborted(signal)
        if (validToolEvidence) {
          allowDelta = true
          const finalResponse = await this.transport.chat(requestId, {
            model: this.model,
            messages,
            tools: [],
            stream: true,
          }, signal)
          throwIfAborted(signal)
          streamed = streamed || Boolean(finalResponse.streamed)
          finalContent = typeof finalResponse.message?.content === 'string' ? finalResponse.message.content : ''
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
      offDelta()
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
    const hasValidEvidence = evidences.length > 0 && homogeneous && evidences.some(item => item.intent !== 'unknown' && item.coverage.level !== 'unavailable' && item.refs.length > 0)
    const insight = hasValidEvidence ? sanitizeNarrative(finalContent) : ''
    const conclusion = verifiedConclusion + (insight ? ' Local model context: ' + insight : '')
    const details = Array.from(new Set([
      ...deterministicAnswers.flatMap(answer => answer.details),
      ...fallback.details,
      ...(homogeneous ? evidences.flatMap(item => item.refs.map(ref => 'Evidence · ' + ref.label)) : []),
    ]))
    return {
      ...fallback,
      conclusion: conclusion.slice(0, 1600),
      details,
      runtime: { id: this.id, label: this.label, mode: this.mode },
      generatedByModel: true,
      streamed,
    }
  }
}
