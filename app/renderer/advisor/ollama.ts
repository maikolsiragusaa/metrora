import { metrora } from '../lib/ipc'
import { AdvisorToolContractError, assertStrictBoundedAdvisorToolContent } from './contract'
import { finalizeModelAnswer, buildAdvisorPlanningMessages, buildAdvisorSynthesisMessages } from './model-flow'
import { deterministicPlanningFallback, parseAdvisorPlanningDraft, planningDraftFromNativeToolCalls, runtimeGuardPlan, validateAdvisorPlanningDraft, type AdvisorPlanningValidation } from './planner'
import { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'
import { ADVISOR_MODEL_NARRATIVE_MAX_BYTES } from './privacy'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorToolDefinition, AdvisorToolRequestV1 } from './types'

export { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'

export type LocalToolCall = { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown }
export type LocalChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type LocalChatResponse = { message?: { content?: string; tool_calls?: LocalToolCall[] }; streamed?: boolean }
export type LocalAdvisorTransport = {
  chat: (requestId: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<LocalChatResponse>
  cancel: (requestId: string) => Promise<boolean>
  onDelta: (callback: (event: { requestId: string; text: string }) => void) => () => void
}
export type OllamaProbeResult = { available: boolean; models: string[]; detail: string }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
}

function requestId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function boundedToolContent(content: string): string {
  return assertStrictBoundedAdvisorToolContent(content)
}

function toolDefinitions(input: AdvisorRuntimeInput): readonly AdvisorToolDefinition[] {
  return input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : []
}

async function executeRequests(input: AdvisorRuntimeInput, requests: readonly AdvisorToolRequestV1[], signal?: AbortSignal): Promise<AdvisorEvidence[]> {
  const evidence: AdvisorEvidence[] = []
  for (const request of requests) {
    throwIfAborted(signal)
    if (!input.executeTool) throw new AdvisorToolContractError('authority-unavailable', 'Advisor tool execution is unavailable.')
    input.onToolEvent?.({ name: request.tool, status: 'started' })
    const result = await input.executeTool(request.tool, request.arguments, signal)
    throwIfAborted(signal)
    // Validate the model-facing result even though it is not sent to a
    // provider as a tool result. This keeps the canonical evidence boundary.
    boundedToolContent(result.content)
    evidence.push(result.evidence)
    input.onToolEvent?.({ name: request.tool, status: 'completed' })
  }
  return evidence
}

function planningValidation(input: AdvisorRuntimeInput, response: LocalChatResponse): AdvisorPlanningValidation | null {
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  let draft = parseAdvisorPlanningDraft(response.message?.content ?? '')
  if (!draft && Array.isArray(response.message?.tool_calls)) {
    draft = planningDraftFromNativeToolCalls(response.message.tool_calls as Array<Record<string, unknown>>, fallbackPlan)
  }
  if (!draft) return null
  try {
    return validateAdvisorPlanningDraft(draft, guard, input.evidence.scope, input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : [])
  } catch {
    return null
  }
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
    const definitions = toolDefinitions(input)
    const { fallbackPlan, guard } = runtimeGuardPlan(input)
    if (guard.authorization !== 'read-only' || guard.turnKind !== 'investigate') {
      return finalizeModelAnswer({ runtime: this, input, evidenceItems: [input.evidence], finalContent: '', modelUsed: false }, signal)
    }
    let activeRequestId: string | null = null
    const cancel = () => { if (activeRequestId) void this.transport.cancel(activeRequestId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const fallback = async (note: string, modelUsed = false): Promise<AdvisorAnswer> => {
        const deterministic = deterministicPlanningFallback(fallbackPlan, definitions)
        let evidenceItems: AdvisorEvidence[] = []
        try {
          evidenceItems = await executeRequests(input, deterministic.toolRequests, signal)
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        }
        throwIfAborted(signal)
        return finalizeModelAnswer({ runtime: this, input: { ...input, plan: deterministic.plan, guard }, evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence], finalContent: '', modelUsed, fallbackNote: note }, signal)
      }

      let planningResponse: LocalChatResponse
      try {
        activeRequestId = requestId('advisor-planning')
        planningResponse = await this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorPlanningMessages(input, fallbackPlan, guard), tools: definitions, stream: false }, signal)
        activeRequestId = null
        throwIfAborted(signal)
      } catch (error) {
        activeRequestId = null
        if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        return fallback('The model planning phase was unavailable; this answer uses the deterministic Metrora evidence path.')
      }

      const validation = planningValidation(input, planningResponse)
      if (!validation) return fallback('The model planning output was malformed or outside the bounded Advisor contract.')
      const effectiveInput: AdvisorRuntimeInput = { ...input, plan: validation.plan, guard }
      let evidenceItems: AdvisorEvidence[] = []
      try {
        evidenceItems = await executeRequests(effectiveInput, validation.toolRequests, signal)
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        return fallback('The model requested evidence that could not be executed; this answer uses the deterministic Metrora evidence path.')
      }
      throwIfAborted(signal)
      const effectiveEvidenceItems = evidenceItems.length ? evidenceItems : [input.evidence]
      if (hasMixedEvidenceScopes(effectiveEvidenceItems)) {
        return finalizeModelAnswer({ runtime: this, input: effectiveInput, evidenceItems: effectiveEvidenceItems, finalContent: '', modelUsed: true, fallbackNote: 'Conflicting tool scopes were rejected; no cross-scope synthesis was attempted.' }, signal)
      }

      activeRequestId = requestId('advisor-synthesis')
      let synthesisResponse: LocalChatResponse
      try {
        const mergedEvidence = mergeEvidence(effectiveEvidenceItems, input.evidence)
        synthesisResponse = await this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorSynthesisMessages(effectiveInput, validation.plan, mergedEvidence), tools: [], stream: false }, signal)
        activeRequestId = null
        throwIfAborted(signal)
      } catch (error) {
        activeRequestId = null
        if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        return finalizeModelAnswer({ runtime: this, input: effectiveInput, evidenceItems: effectiveEvidenceItems, finalContent: '', modelUsed: true, fallbackNote: 'The fresh synthesis phase was unavailable; verified Metrora facts are shown instead.' }, signal)
      }
      return finalizeModelAnswer({ runtime: this, input: effectiveInput, evidenceItems: effectiveEvidenceItems, finalContent: boundedModelText(synthesisResponse.message?.content), modelUsed: true }, signal)
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
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
