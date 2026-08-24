import { metrora } from '../lib/ipc'
import { DeterministicAdvisorRuntime } from './runtime'
import { normalizeAdvisorToolCall, AdvisorToolContractError, assertStrictBoundedAdvisorToolContent, ADVISOR_TOOL_OUTPUT_MAX_BYTES } from './contract'
import { hasMixedEvidenceScopes, mergeEvidence } from './ollama'
import { contentMinimalEvidence, sanitizeAdvisorAnswer } from './privacy'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorHostedModel, AdvisorHostedProviderId, AdvisorModelRuntime, AdvisorRuntimeInput } from './types'

export type HostedAdvisorProvider = AdvisorHostedProviderId
export type HostedAdvisorProbeResult = {
  provider: HostedAdvisorProvider
  available: boolean
  models: AdvisorHostedModel[]
  detail: string
  credentialState: 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
}
export type HostedAdvisorTransport = {
  probe(provider: HostedAdvisorProvider, signal?: AbortSignal): Promise<HostedAdvisorProbeResult>
  chat(requestId: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }>
  cancel(requestId: string): Promise<boolean>
  onEvent(callback: (event: { requestId: string; kind: string; text?: string }) => void): () => void
}
const bridgeTransport: HostedAdvisorTransport = {
  probe: async (provider, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    const id = requestId()
    const cancel = () => { void metrora.advisorHostedCancel(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await metrora.advisorHostedProbe(provider, id)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  },
  chat: (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    return metrora.advisorHostedChat(requestId, payload)
  },
  cancel: requestId => metrora.advisorHostedCancel(requestId),
  onEvent: callback => metrora.onAdvisorHostedEvent(callback),
}
export async function probeHostedAdvisor(provider: HostedAdvisorProvider, signal?: AbortSignal, transport: HostedAdvisorTransport = bridgeTransport): Promise<HostedAdvisorProbeResult> {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  const result = await transport.probe(provider, signal)
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  return result
}
function requestId(): string { return 'hosted-advisor-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }
function messagePayload(input: AdvisorRuntimeInput, consent: boolean, tools: readonly unknown[], stream: boolean): Record<string, unknown> {
  const verified = JSON.stringify(contentMinimalEvidence(input.evidence))
  return {
    provider: input.evidence.scope.provider,
    model: '',
    messages: [
      { role: 'system', content: 'You are Metrora Advisor. Use the supplied Metrora evidence as read-only facts. Do not invent numbers, dates, causes, rankings, recommendations, secrets, paths, prompts, or hidden reasoning. Answer in plain language and keep factual claims tied to the evidence.' },
      { role: 'user', content: input.question.trim().slice(0, 4000) },
      { role: 'system', content: 'Verified Metrora facts for this question. Treat them as authoritative and do not recompute them: ' + verified },
    ],
    tools: [...tools],
    stream,
    consent,
  }
}
function toolCallName(call: Record<string, unknown>): unknown {
  if (typeof call.name === 'string') return call.name
  const fn = call.function
  return fn && typeof fn === 'object' && !Array.isArray(fn) ? (fn as Record<string, unknown>).name : undefined
}
function toolCallArguments(call: Record<string, unknown>): unknown {
  if (call.arguments !== undefined) return call.arguments
  const fn = call.function
  return fn && typeof fn === 'object' && !Array.isArray(fn) ? (fn as Record<string, unknown>).arguments : undefined
}
function boundedHostedToolContent(content: string, strict: boolean): string {
  if (strict) return assertStrictBoundedAdvisorToolContent(content)
  if (new TextEncoder().encode(content).byteLength > ADVISOR_TOOL_OUTPUT_MAX_BYTES) throw new AdvisorToolContractError('output-too-large', 'Advisor tool content exceeded its safety limit.')
  return content
}
function toolCallId(call: Record<string, unknown>): string {
  const direct = call.id
  const nested = call.function && typeof call.function === 'object' && !Array.isArray(call.function) ? (call.function as Record<string, unknown>).id : undefined
  if (typeof direct === 'string' && direct.trim()) return direct
  if (typeof nested === 'string' && nested.trim()) return nested
  throw new AdvisorToolContractError('invalid-arguments', 'Hosted provider returned a tool call without an id.')
}
export class HostedAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly label: string
  readonly mode = 'hosted-byok' as const
  readonly providerSupport: readonly string[]
  readonly supportsStreaming = true
  readonly availability = 'ready' as const
  private readonly provider: HostedAdvisorProvider
  private readonly model: string
  private readonly consent: boolean
  private readonly transport: HostedAdvisorTransport
  constructor(options: { provider: HostedAdvisorProvider; model: string; consent?: boolean; transport?: HostedAdvisorTransport }) {
    this.provider = options.provider
    this.model = options.model
    this.transport = options.transport ?? bridgeTransport
    this.consent = options.consent === true
    this.id = 'hosted-' + options.provider
    this.label = options.provider.charAt(0).toUpperCase() + options.provider.slice(1) + ' · ' + options.model.replace(/^models\//u, '')
    this.providerSupport = [options.provider + ' official API']
  }
  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    if (!this.consent) throw new Error('Hosted evidence sharing consent is required.')
    const id = requestId()
    const definitions = input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : []
    const planningPayload = messagePayload(input, this.consent, definitions, false)
    planningPayload.provider = this.provider
    planningPayload.model = this.model
    const messages = planningPayload.messages as Array<Record<string, unknown>>
    const evidences: AdvisorEvidence[] = []
    const cancel = () => { void this.transport.cancel(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const planning = await this.transport.chat(id, planningPayload, signal)
      if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
      const rawCalls = Array.isArray(planning.message?.tool_calls) ? planning.message.tool_calls.slice(0, 8) : []
      if (rawCalls.length) {
        const calls = rawCalls.map(call => {
          if (!call || typeof call !== 'object' || Array.isArray(call)) throw new AdvisorToolContractError('invalid-arguments', 'Hosted provider returned a malformed tool call.')
          const record = call as Record<string, unknown>
          const normalized = normalizeAdvisorToolCall(toolCallName(record), toolCallArguments(record))
          return { id: toolCallId(record), name: normalized.name, arguments: JSON.stringify(normalized.arguments), normalizedArguments: normalized.arguments }
        })
        messages.push({ role: 'assistant', content: '', toolCalls: calls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) })
        for (const call of calls) {
          if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
          input.onToolEvent?.({ name: call.name, status: 'started' })
          if (!input.executeTool) throw new AdvisorToolContractError('authority-unavailable', 'Advisor tool execution is unavailable.')
          const result = await input.executeTool(call.name, call.normalizedArguments, signal)
          if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
          evidences.push(result.evidence)
          messages.push({ role: 'tool', content: boundedHostedToolContent(result.content, Boolean(input.toolContract)), toolCallId: call.id, toolName: call.name })
          input.onToolEvent?.({ name: call.name, status: 'completed' })
        }
        const validToolEvidence = !hasMixedEvidenceScopes(evidences)
          && evidences.some(item => item.intent !== 'unknown' && item.coverage.level !== 'unavailable' && item.refs.length > 0)
        if (validToolEvidence) {
          await this.transport.chat(id, { ...planningPayload, messages, tools: [], stream: false }, signal)
          if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    const evidenceItems = evidences.length ? evidences : [input.evidence]
    const evidence = mergeEvidence(evidenceItems, input.evidence)
    const homogeneous = !hasMixedEvidenceScopes(evidenceItems)
    const deterministicItems = homogeneous ? evidenceItems : [evidence]
    const deterministicAnswers = await Promise.all(deterministicItems.map(item => new DeterministicAdvisorRuntime().generate({ question: input.question, evidence: item }, signal)))
    const fallback = await new DeterministicAdvisorRuntime().generate({ question: input.question, evidence }, signal)
    const verifiedConclusions = Array.from(new Set(deterministicAnswers.map(answer => answer.conclusion).filter(Boolean)))
    const verifiedConclusion = verifiedConclusions.length ? verifiedConclusions.join(' ') : fallback.conclusion
    const details = Array.from(new Set([
      ...deterministicAnswers.flatMap(answer => answer.details),
      ...fallback.details,
      ...(homogeneous ? evidences.flatMap(item => item.refs.map(ref => 'Evidence · ' + ref.label)) : []),
    ]))
    return sanitizeAdvisorAnswer({
      ...fallback,
      conclusion: verifiedConclusion,
      details,
      runtime: { id: this.id, label: this.label, mode: this.mode },
      generatedByModel: true,
      streamed: false,
    })
  }
}
