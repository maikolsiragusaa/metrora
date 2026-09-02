import { metrora } from '../lib/ipc'
import { buildAdvisorGroundedRepairMessages, buildAdvisorSwarmSynthesisMessages, type AdvisorGroundedRepairRequest } from './model-flow'
import { createAdvisorTurnDeadline, raceAdvisorAbort } from './abort'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { runAdvisorRuntimeAgentLoop } from '../agent-loop/advisor-runtime'
import { serializeMetroraAgentMessages, type MetroraAgentMessage } from '../agent-loop/contracts'
import type { AdvisorAnswer, AdvisorModelRuntime, AdvisorReasoningEffort, AdvisorRuntimeInput, AdvisorSwarmSynthesisInput, AdvisorSwarmSynthesisResult } from './types'

export { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'

export type LocalToolCall = { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }
export type LocalChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type LocalChatResponse = { message?: { content?: string; tool_calls?: LocalToolCall[] }; streamed?: boolean }
export type LocalAdvisorTransport = {
  chat: (requestId: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<LocalChatResponse>
  cancel: (requestId: string) => Promise<boolean>
  onDelta: (callback: (event: { requestId: string; text: string }) => void) => () => void
}
export type OllamaProbeResult = { available: boolean; models: string[]; modelLabels?: Record<string, string>; detail: string }
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
    return await raceAdvisorAbort(transport.probe(signal), signal)
  } catch (error) {
    if (signal?.aborted) throw error
    return { available: false, models: [], detail: 'Local Ollama is unavailable.' }
  }
}

function boundedModelText(value: unknown): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 32 * 1024) return ''
  return value
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
}

function requestId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
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
  nativeToolCalls?: boolean
}

export class LocalAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly mode: AdvisorAnswer['runtime']['mode']
  readonly providerSupport: readonly string[]
  readonly supportsStreaming = true
  readonly reasoningEfforts: readonly AdvisorReasoningEffort[] = ['default']
  readonly label: string
  readonly availability: 'ready' | 'checking' | 'unavailable'
  private readonly model: string
  private readonly transport: LocalAdvisorTransport
  private readonly unavailableMessage: string
  private readonly nativeToolCalls: boolean

  constructor(options: LocalAdvisorRuntimeOptions) {
    this.id = options.id
    this.mode = options.mode
    this.providerSupport = options.providerSupport
    this.model = options.model
    this.transport = options.transport
    this.availability = options.availability ?? 'ready'
    this.label = options.label
    this.unavailableMessage = options.unavailableMessage ?? 'Local Harness model is not available.'
    this.nativeToolCalls = options.nativeToolCalls ?? true
  }

  private async generateGroundedRepair(request: AdvisorGroundedRepairRequest, signal?: AbortSignal): Promise<string> {
    if (this.availability !== 'ready') throw new Error(this.unavailableMessage)
    throwIfAborted(signal)
    const deadline = createAdvisorTurnDeadline(signal, HARNESS_TOOL_LOOP_LIMITS.turnTimeoutMs)
    const activeRequestId = requestId('grounded-repair')
    const cancel = () => { void this.transport.cancel(activeRequestId).catch(() => {}) }
    deadline.signal.addEventListener('abort', cancel, { once: true })
    try {
      const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
        model: this.model,
        messages: serializeMetroraAgentMessages(buildAdvisorGroundedRepairMessages(request) as readonly MetroraAgentMessage[]),
        tools: [],
        stream: false,
        messageMode: this.nativeToolCalls ? 'native' : 'flattened',
      }, deadline.signal), deadline.signal)
      throwIfAborted(deadline.signal)
      if (response.message?.tool_calls?.length) throw new Error('Grounded repair returned an unexpected Tool call.')
      const answer = boundedModelText(response.message?.content)
      if (!answer.trim()) throw new Error('Grounded repair returned no usable answer.')
      return answer
    } finally {
      deadline.signal.removeEventListener('abort', cancel)
      deadline.dispose()
    }
  }

  async generateSwarmSynthesis(input: AdvisorSwarmSynthesisInput, signal?: AbortSignal): Promise<AdvisorSwarmSynthesisResult> {
    if (this.availability !== 'ready') throw new Error(this.unavailableMessage)
    throwIfAborted(signal)
    const activeRequestId = requestId('swarm-synthesis')
    const cancel = () => { void this.transport.cancel(activeRequestId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
        model: this.model,
        messages: buildAdvisorSwarmSynthesisMessages(input),
        tools: [],
        stream: false,
      }, signal), signal)
      throwIfAborted(signal)
      const answer = boundedModelText(response.message?.content)
      if (!answer.trim()) throw new Error('Swarm synthesis returned no usable answer.')
      return { answer, evidenceSummary: 'Dedicated bounded synthesis over ' + input.workers.length + ' worker report(s).' }
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (this.availability !== 'ready') throw new Error(this.unavailableMessage)
    throwIfAborted(signal)
    let activeRequestId: string | null = null
    let streaming = false
    const removeDelta = this.transport.onDelta(event => {
      if (streaming && event.requestId === activeRequestId) input.onDelta?.(event.text)
    })
    try {
      return await runAdvisorRuntimeAgentLoop({
        runtime: this,
        model: this.model,
        input,
        signal,
        transport: {
          nativeToolCalls: this.nativeToolCalls,
          complete: async (request, payload, requestSignal) => {
            activeRequestId = request
            streaming = payload.stream === true
            try {
              return await this.transport.chat(request, payload, requestSignal)
            } finally {
              activeRequestId = null
              streaming = false
            }
          },
          cancel: request => this.transport.cancel(request),
          buildPayload: ({ model, messages, tools, stream }) => ({
            model,
            messages: serializeMetroraAgentMessages(messages as readonly MetroraAgentMessage[]),
            tools: [...tools],
            stream,
            messageMode: this.nativeToolCalls ? 'native' : 'flattened',
          }),
          repair: (request, requestSignal) => this.generateGroundedRepair(request, requestSignal),
        },
      })
    } finally {
      streaming = false
      activeRequestId = null
      removeDelta()
    }
  }
}

export class OllamaAdvisorRuntime extends LocalAdvisorRuntime {
  constructor(options: { model: string; transport?: OllamaTransport; availability?: 'ready' | 'checking' | 'unavailable'; nativeToolCalls?: boolean }) {
    super({
      id: 'ollama-local',
      label: 'Ollama · ' + options.model,
      mode: 'ollama-local',
      providerSupport: ['Ollama official local API'],
      model: options.model,
      transport: options.transport ?? bridgeTransport,
      availability: options.availability,
      unavailableMessage: 'Local Ollama model is not available.',
      nativeToolCalls: options.nativeToolCalls,
    })
  }
}
