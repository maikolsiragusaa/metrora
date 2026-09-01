import { metrora } from '../lib/ipc'
import { AdvisorToolContractError, assertStrictBoundedAdvisorToolContent } from './contract'
import { buildAdvisorChatMessages, buildAdvisorConversationMessages, buildAdvisorSwarmSynthesisMessages, buildAdvisorToolContinuationMessages, finalizeAdvisorConversationAnswer, finalizeModelAnswer, buildAdvisorSynthesisMessages } from './model-flow'
import { deterministicPlanningFallback, parseAdvisorPlanningDraft, planningDraftFromNativeToolCalls, runtimeGuardPlan, validateAdvisorPlanningDraft, type AdvisorPlanningValidation } from './planner'
import { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'
import { ADVISOR_MODEL_NARRATIVE_MAX_BYTES } from './privacy'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { parseAdvisorSynthesisDraft } from './synthesis'
import { raceAdvisorAbort } from './abort'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorSwarmSynthesisInput, AdvisorSwarmSynthesisResult, AdvisorToolDefinition, AdvisorToolRequestV1 } from './types'

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
    if (!input.executeTool) throw new AdvisorToolContractError('authority-unavailable', 'Metrora Tools execution is unavailable.')
    input.onToolEvent?.({ name: request.tool, status: 'queued' })
    input.onToolEvent?.({ name: request.tool, status: 'started' })
    try {
      const result = await input.executeTool(request.tool, request.arguments, signal)
      throwIfAborted(signal)
      // Validate the model-facing result even though it is not sent to a
      // provider as a tool result. This keeps the canonical evidence boundary.
      boundedToolContent(result.content)
      evidence.push(result.evidence)
      input.onToolEvent?.({ name: request.tool, status: result.envelope?.unavailable || result.evidence.coverage.level === 'unavailable' ? 'unavailable' : 'completed' })
    } catch (error) {
      input.onToolEvent?.({ name: request.tool, status: signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message)) ? 'cancelled' : 'failed' })
      throw error
    }
  }
  return evidence
}

function requiresVerifiedEvidence(input: AdvisorRuntimeInput): boolean {
  const intent = input.fallbackIntent ?? input.evidence.intent
  return intent === 'spend-change' || intent === 'model-efficiency' || intent === 'quota-capacity' || intent === 'bench-result'
}

function planningValidation(input: AdvisorRuntimeInput, response: LocalChatResponse, strictContractErrors = requiresVerifiedEvidence(input)): AdvisorPlanningValidation | null {
  try {
    const { fallbackPlan, guard } = runtimeGuardPlan(input)
    let draft = parseAdvisorPlanningDraft(response.message?.content ?? '')
    if (!draft && Array.isArray(response.message?.tool_calls)) {
      draft = planningDraftFromNativeToolCalls(response.message.tool_calls as Array<Record<string, unknown>>, fallbackPlan)
    }
    if (!draft) return null
    return validateAdvisorPlanningDraft(draft, guard, input.evidence.scope, input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : [])
  } catch (error) {
    // Contract errors from provider-native calls are terminal for this turn.
    // Do not let a malformed or unknown tool request reach a read executor or
    // get silently converted into a different model plan.
    if (error instanceof AdvisorToolContractError && strictContractErrors) throw error
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
    this.unavailableMessage = options.unavailableMessage ?? 'Local Harness model is not available.'
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
    const definitions = toolDefinitions(input)
    const { fallbackPlan, guard } = runtimeGuardPlan(input)
    let activeRequestId: string | null = null
    let streamingConversation = false
    const removeDelta = this.transport.onDelta(event => {
      if (streamingConversation && event.requestId === activeRequestId) input.onDelta?.(event.text)
    })
    const cancel = () => { if (activeRequestId) void this.transport.cancel(activeRequestId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const conversation = async (kind: 'social' | 'boundary' | 'action', effectiveInput: AdvisorRuntimeInput): Promise<AdvisorAnswer> => {
        try {
          activeRequestId = requestId('advisor-conversation')
          streamingConversation = kind === 'social' && Boolean(input.onDelta)
          const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorConversationMessages(effectiveInput, kind), tools: [], stream: streamingConversation }, signal), signal)
          const wasStreaming = streamingConversation
          activeRequestId = null
          streamingConversation = false
          throwIfAborted(signal)
          const answer = await finalizeAdvisorConversationAnswer(this, effectiveInput, kind, boundedModelText(response.message?.content), true, signal)
          return { ...answer, streamed: wasStreaming || response.streamed }
        } catch (error) {
          activeRequestId = null
          streamingConversation = false
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
          return finalizeAdvisorConversationAnswer(this, effectiveInput, kind, '', false, signal)
        }
      }

      const fallback = async (note: string, modelUsed = false): Promise<AdvisorAnswer> => {
        const deterministic = deterministicPlanningFallback(fallbackPlan, definitions, input.question)
        let evidenceItems: AdvisorEvidence[] = []
        try {
          evidenceItems = await executeRequests(input, deterministic.toolRequests, signal)
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        }
        throwIfAborted(signal)
        return finalizeModelAnswer({ runtime: this, input: { ...input, plan: deterministic.plan, guard }, evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence], finalContent: '', modelUsed, fallbackNote: note }, signal)
      }

      if (guard.authorization !== 'read-only') {
        let actionResponse: LocalChatResponse
        try {
          activeRequestId = requestId('advisor-action-chat')
          actionResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorChatMessages(input, fallbackPlan, guard, { textPlanningFallback: false }), tools: [], stream: false }, signal), signal)
          activeRequestId = null
          throwIfAborted(signal)
        } catch (error) {
          activeRequestId = null
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
          return finalizeAdvisorConversationAnswer(this, input, 'action', '', false, signal)
        }
        if ((Array.isArray(actionResponse.message?.tool_calls) && actionResponse.message!.tool_calls!.length > 0) || parseAdvisorPlanningDraft(actionResponse.message?.content ?? '')) {
          return finalizeAdvisorConversationAnswer(this, input, 'action', '', false, signal)
        }
        return finalizeAdvisorConversationAnswer(this, input, 'action', boundedModelText(actionResponse.message?.content), true, signal)
      }

      let firstResponse: LocalChatResponse
      try {
        activeRequestId = requestId('advisor-chat')
        firstResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorChatMessages(input, fallbackPlan, guard, { nativeToolCalls: definitions.length > 0, textPlanningFallback: definitions.length === 0 }), tools: definitions, stream: false }, signal), signal)
        activeRequestId = null
        throwIfAborted(signal)
      } catch (error) {
        activeRequestId = null
        if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
        return fallback('The model response was unavailable; this answer uses the deterministic Metrora evidence path.')
      }

      const validation = planningValidation(input, firstResponse)
      if (!validation) {
        if (Array.isArray(firstResponse.message?.tool_calls) && firstResponse.message!.tool_calls!.length > 0) return fallback('The model requested a tool outside the bounded Metrora Tools contract.')
        const content = boundedModelText(firstResponse.message?.content)
        if (requiresVerifiedEvidence(input)) return fallback('The direct model response did not request a verified Metrora read; canonical evidence is shown instead.')
        if (!content.trim() || /^(?:\{|\[|```)/u.test(content.trim())) return fallback('The model response was malformed or outside the bounded Metrora Tools contract.')
        return finalizeAdvisorConversationAnswer(this, input, 'social', content, true, signal)
      }
      const effectiveInput: AdvisorRuntimeInput = { ...input, plan: validation.plan, guard }
      if (validation.plan.turnKind === 'social' || validation.plan.turnKind === 'boundary') {
        return conversation(validation.plan.turnKind, effectiveInput)
      }

      let evidenceItems: AdvisorEvidence[] = []
      let currentInput = effectiveInput
      let currentPlan = validation.plan
      let currentResponse = firstResponse
      let toolRound = 0
      let totalToolCalls = 0
      const fallbackFromEvidence = (note: string, finalContent = '') => finalizeModelAnswer({
        runtime: this,
        input: currentInput,
        evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence],
        finalContent,
        modelUsed: true,
        fallbackNote: note,
      }, signal)

      while (true) {
        const nextValidation = toolRound === 0 ? validation : planningValidation(currentInput, currentResponse)
        if (!nextValidation) {
          if (Array.isArray(currentResponse.message?.tool_calls) && currentResponse.message.tool_calls.length > 0) {
            return fallbackFromEvidence('The model requested a tool outside the bounded Metrora Tools contract; verified facts are shown instead.')
          }
          const finalContent = boundedModelText(currentResponse.message?.content)
          if (toolRound > 0 && finalContent.trim()) {
            const structured = /^(?:\{|\[)/u.test(finalContent.trim()) || finalContent.trim().startsWith(String.fromCharCode(96))
            const validDraft = structured && Boolean(parseAdvisorSynthesisDraft(finalContent))
            return fallbackFromEvidence(structured && !validDraft ? 'The model synthesis was malformed; verified facts are shown instead.' : '', finalContent)
          }
          return fallbackFromEvidence('The model continuation was malformed or outside the bounded Metrora Tools contract; verified facts are shown instead.')
        }
        currentPlan = nextValidation.plan
        currentInput = { ...currentInput, plan: currentPlan }
        const requestedCalls = nextValidation.toolRequests.length
        if (requestedCalls === 0 || requestedCalls > HARNESS_TOOL_LOOP_LIMITS.maxCallsPerRound || toolRound >= HARNESS_TOOL_LOOP_LIMITS.maxRounds || totalToolCalls + requestedCalls > HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn) {
          return fallbackFromEvidence('The bounded Metrora Tool loop limit was reached; verified facts are shown instead.')
        }
        currentInput.onToolRound?.(toolRound + 1)
        try {
          const roundEvidence = await executeRequests(currentInput, nextValidation.toolRequests, signal)
          evidenceItems.push(...roundEvidence)
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
          return fallbackFromEvidence('The model requested evidence that could not be executed; verified facts are shown instead.')
        }
        throwIfAborted(signal)
        totalToolCalls += requestedCalls
        toolRound += 1
        const effectiveEvidenceItems = evidenceItems.length ? evidenceItems : [input.evidence]
        if (hasMixedEvidenceScopes(effectiveEvidenceItems)) {
          return fallbackFromEvidence('Conflicting tool scopes were rejected; no cross-scope synthesis was attempted.')
        }
        const mergedEvidence = mergeEvidence(effectiveEvidenceItems, input.evidence)

        if (toolRound < HARNESS_TOOL_LOOP_LIMITS.maxRounds && totalToolCalls < HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn) {
          activeRequestId = requestId('advisor-tool-continuation')
          try {
            currentResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
              model: this.model,
              messages: buildAdvisorToolContinuationMessages(currentInput, currentPlan, mergedEvidence, toolRound + 1, { nativeToolCalls: definitions.length > 0, textPlanningFallback: definitions.length === 0 }),
              // Keep canonical definitions available after a native first
              // call so a genuine second bounded read remains possible.
              tools: definitions,
              stream: false,
            }, signal), signal)
            activeRequestId = null
            throwIfAborted(signal)
            continue
          } catch (error) {
            activeRequestId = null
            if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
            return fallbackFromEvidence('The bounded evidence continuation was unavailable; verified facts are shown instead.')
          }
        }

        activeRequestId = requestId('advisor-synthesis')
        let synthesisResponse: LocalChatResponse
        try {
          synthesisResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorSynthesisMessages(currentInput, currentPlan, mergedEvidence), tools: [], stream: false }, signal), signal)
          activeRequestId = null
          throwIfAborted(signal)
        } catch (error) {
          activeRequestId = null
          if (signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message))) throw error
          return fallbackFromEvidence('The fresh synthesis phase was unavailable; verified Metrora facts are shown instead.')
        }
        return fallbackFromEvidence('', boundedModelText(synthesisResponse.message?.content))
      }
    } finally {
      streamingConversation = false
      removeDelta()
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
