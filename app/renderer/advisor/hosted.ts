import { metrora } from '../lib/ipc'
import { buildAdvisorSwarmSynthesisMessages } from './model-flow'
import { createAdvisorTurnDeadline, raceAdvisorAbort } from './abort'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { runAdvisorRuntimeAgentLoop } from '../agent-loop/advisor-runtime'
import { serializeMetroraAgentMessages, type MetroraAgentContinuation, type MetroraAgentMessage } from '../agent-loop/contracts'
import type { AdvisorAnswer, AdvisorHostedModel, AdvisorHostedModelCapabilities, AdvisorHostedProviderId, AdvisorModelRuntime, AdvisorReasoningEffort, AdvisorRuntimeInput, AdvisorSwarmSynthesisInput, AdvisorSwarmSynthesisResult } from './types'

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
  chat(requestId: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean; continuation?: MetroraAgentContinuation }>
  cancel(requestId: string): Promise<boolean>
  onEvent(callback: (event: { requestId: string; kind: string; provider: string; model: string; usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null; streamed?: boolean; code?: string }) => void): () => void
}

const bridgeTransport: HostedAdvisorTransport = {
  probe: async (provider, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    const id = requestId('hosted-probe')
    const cancel = () => { void metrora.advisorHostedCancel(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await metrora.advisorHostedProbe(provider, id)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  },
  chat: async (requestId, payload, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
    const cancel = () => { void metrora.advisorHostedCancel(requestId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await metrora.advisorHostedChat(requestId, payload)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  },
  cancel: requestId => metrora.advisorHostedCancel(requestId),
  onEvent: callback => metrora.onAdvisorHostedEvent(callback),
}

export async function probeHostedAdvisor(provider: HostedAdvisorProvider, signal?: AbortSignal, transport: HostedAdvisorTransport = bridgeTransport): Promise<HostedAdvisorProbeResult> {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  const result = await raceAdvisorAbort(transport.probe(provider, signal), signal)
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  return result
}

function requestId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedHostedToolCall(value: unknown): boolean {
  if (!isRecord(value)) return false
  const functionValue = isRecord(value.function) ? value.function : null
  const name = typeof value.name === 'string' ? value.name : functionValue && typeof functionValue.name === 'string' ? functionValue.name : null
  if (!name?.trim()) return false
  const args = Object.prototype.hasOwnProperty.call(value, 'arguments')
    ? value.arguments
    : functionValue && Object.prototype.hasOwnProperty.call(functionValue, 'arguments')
      ? functionValue.arguments
      : undefined
  return args === undefined || typeof args === 'string' || isRecord(args)
}

function isNormalizedHostedResponse(value: unknown): value is { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean; continuation?: MetroraAgentContinuation } {
  if (!isRecord(value) || typeof value.streamed !== 'boolean' || !isRecord(value.message)) return false
  if (typeof value.message.content !== 'string' || new TextEncoder().encode(value.message.content).byteLength > 32 * 1024) return false
  const toolCalls = value.message.tool_calls
  if (toolCalls !== undefined && (!Array.isArray(toolCalls) || toolCalls.length > 16 || toolCalls.some(call => !normalizedHostedToolCall(call)))) return false
  if (value.continuation !== undefined) {
    if (!isRecord(value.continuation) || typeof value.continuation.provider !== 'string' || typeof value.continuation.model !== 'string' || typeof value.continuation.protocol !== 'string' || typeof value.continuation.adapter !== 'string' || !Array.isArray(value.continuation.responseMessages)) return false
  }
  return Boolean(value.message.content) || Boolean(Array.isArray(toolCalls) && toolCalls.length)
}

export class HostedAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly label: string
  readonly mode = 'hosted-byok' as const
  readonly providerSupport: readonly string[]
  readonly supportsStreaming: boolean
  readonly reasoningEfforts: readonly AdvisorReasoningEffort[]
  readonly availability = 'ready' as const
  private readonly provider: HostedAdvisorProvider
  private readonly model: string
  private readonly consent: boolean
  private readonly capabilities: AdvisorHostedModelCapabilities
  private readonly reasoningEffort: AdvisorReasoningEffort
  private readonly transport: HostedAdvisorTransport

  constructor(options: { provider: HostedAdvisorProvider; model: string; capabilities?: AdvisorHostedModelCapabilities; reasoningEffort?: AdvisorReasoningEffort; consent?: boolean; transport?: HostedAdvisorTransport }) {
    this.provider = options.provider
    this.model = options.model
    this.transport = options.transport ?? bridgeTransport
    this.consent = options.consent === true
    this.capabilities = options.capabilities ?? { conversational: 'unknown', streaming: 'unknown', toolCall: 'unknown' }
    this.reasoningEfforts = options.capabilities?.reasoningEfforts?.length ? [...new Set(options.capabilities.reasoningEfforts)] : ['default']
    this.reasoningEffort = options.reasoningEffort && this.reasoningEfforts.includes(options.reasoningEffort) ? options.reasoningEffort : 'default'
    this.supportsStreaming = this.capabilities.streaming !== 'unsupported'
    this.id = 'hosted-' + options.provider
    const providerLabel = options.provider === 'opencode-zen' ? 'OpenCode Zen' : options.provider === 'openrouter' ? 'OpenRouter' : options.provider.charAt(0).toUpperCase() + options.provider.slice(1)
    this.label = providerLabel + ' · ' + options.model.replace(/^models\//u, '')
    this.providerSupport = [options.provider + ' official API']
  }

  private reasoningRequest(): Record<string, unknown> {
    return this.reasoningEffort === 'default' ? {} : { reasoningEffort: this.reasoningEffort }
  }

  async generateSwarmSynthesis(input: AdvisorSwarmSynthesisInput, signal?: AbortSignal): Promise<AdvisorSwarmSynthesisResult> {
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    if (!this.consent) throw new Error('Hosted evidence sharing consent is required.')
    const deadline = createAdvisorTurnDeadline(signal, HARNESS_TOOL_LOOP_LIMITS.turnTimeoutMs)
    const turnSignal = deadline.signal
    let activeRequestId: string | null = null
    const cancel = () => { if (activeRequestId) void this.transport.cancel(activeRequestId).catch(() => {}) }
    turnSignal.addEventListener('abort', cancel, { once: true })
    try {
      activeRequestId = requestId('hosted-swarm-synthesis')
      const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
        provider: this.provider,
        model: this.model,
        ...this.reasoningRequest(),
        messages: buildAdvisorSwarmSynthesisMessages(input),
        tools: [],
        stream: false,
        consent: true,
        harnessConformance: true,
      }, turnSignal), turnSignal)
      activeRequestId = null
      throwIfAborted(turnSignal)
      if (!isNormalizedHostedResponse(response)) throw new Error('The dedicated hosted Swarm synthesis response was malformed.')
      return {
        answer: response.message.content,
        evidenceSummary: 'Dedicated bounded hosted synthesis over ' + input.workers.length + ' normalized worker closeout(s).',
      }
    } finally {
      turnSignal.removeEventListener('abort', cancel)
      deadline.dispose()
    }
  }

  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    if (!this.consent) throw new Error('Hosted evidence sharing consent is required.')
    return runAdvisorRuntimeAgentLoop({
      runtime: this,
      model: this.model,
      input,
      signal,
      transport: {
        nativeToolCalls: this.capabilities.toolCall === 'supported',
        complete: async (request, payload, requestSignal) => {
          const response = await this.transport.chat(request, {
            provider: this.provider,
            model: this.model,
            ...this.reasoningRequest(),
            messages: payload.messages,
            tools: payload.tools,
            stream: false,
            messageMode: payload.messageMode as 'native' | 'flattened' | undefined,
            continuation: payload.continuation as MetroraAgentContinuation | undefined,
            consent: true,
            harnessConformance: true,
          }, requestSignal)
          if (!isNormalizedHostedResponse(response)) throw new Error('The hosted model response was malformed.')
          return response
        },
        cancel: request => this.transport.cancel(request),
        buildPayload: ({ messages, tools, continuation }) => ({
          messages: serializeMetroraAgentMessages(messages as readonly MetroraAgentMessage[]),
          tools: [...tools],
          stream: false,
          messageMode: this.capabilities.toolCall === 'supported' ? 'native' : 'flattened',
          ...(continuation ? { continuation } : {}),
        }),
        reportConformance: true,
      },
    })
  }
}
