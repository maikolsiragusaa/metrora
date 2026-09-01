import { metrora } from '../lib/ipc'
import { AdvisorToolContractError, assertStrictBoundedAdvisorToolContent } from './contract'
import { buildAdvisorChatMessages, buildAdvisorConversationMessages, buildAdvisorSwarmSynthesisMessages, buildAdvisorToolContinuationMessages, finalizeAdvisorConversationAnswer, finalizeModelAnswer, buildAdvisorSynthesisMessages } from './model-flow'
import { deterministicPlanningFallback, parseAdvisorPlanningDraft, planningDraftFromNativeToolCalls, runtimeGuardPlan, validateAdvisorPlanningDraft, type AdvisorPlanningValidation } from './planner'
import { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'
import { ADVISOR_MODEL_NARRATIVE_MAX_BYTES } from './privacy'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { parseAdvisorSynthesisDraft } from './synthesis'
import { createAdvisorTurnDeadline, raceAdvisorAbort, shouldRethrowAdvisorAbort } from './abort'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorSwarmSynthesisInput, AdvisorSwarmSynthesisResult, AdvisorToolDefinition, AdvisorToolRequestV1 } from './types'

export { hasMixedEvidenceScopes, mergeEvidence, sameEvidenceScope } from './merge-evidence'

const BOUNDED_TURN_DEADLINE_NOTE = 'The bounded Metrora turn deadline was reached; verified facts are shown instead.'

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
      const result = await raceAdvisorAbort(Promise.resolve().then(() => input.executeTool!(request.tool, request.arguments, signal)), signal)
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

function planningValidation(input: AdvisorRuntimeInput, response: LocalChatResponse): AdvisorPlanningValidation | null {
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  let draft = parseAdvisorPlanningDraft(response.message?.content ?? '')
  if (!draft && Array.isArray(response.message?.tool_calls)) {
    try {
      draft = planningDraftFromNativeToolCalls(response.message.tool_calls as Array<Record<string, unknown>>, fallbackPlan)
    } catch {
      // A provider-native call is untrusted input. Keep the whole planning
      // phase fail-closed and let the deterministic evidence path answer;
      // never allow malformed arguments to reach a Tool executor.
      return null
    }
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
    const deadline = createAdvisorTurnDeadline(signal, HARNESS_TOOL_LOOP_LIMITS.turnTimeoutMs)
    const turnSignal = deadline.signal
    const finalizationSignal = () => deadline.didTimeout() ? undefined : turnSignal
    const shouldRethrow = (error: unknown) => shouldRethrowAdvisorAbort(error, signal, deadline)
    const definitions = toolDefinitions(input)
    const { fallbackPlan, guard } = runtimeGuardPlan(input)
    let activeRequestId: string | null = null
    let streamingConversation = false
    const removeDelta = this.transport.onDelta(event => {
      if (streamingConversation && event.requestId === activeRequestId) input.onDelta?.(event.text)
    })
    const cancel = () => { if (activeRequestId) void this.transport.cancel(activeRequestId).catch(() => {}) }
    turnSignal.addEventListener('abort', cancel, { once: true })
    try {
      const conversation = async (kind: 'social' | 'boundary' | 'action', effectiveInput: AdvisorRuntimeInput): Promise<AdvisorAnswer> => {
        try {
          activeRequestId = requestId('advisor-conversation')
          streamingConversation = kind === 'social' && Boolean(input.onDelta)
          const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorConversationMessages(effectiveInput, kind), tools: [], stream: streamingConversation }, turnSignal), turnSignal)
          const wasStreaming = streamingConversation
          activeRequestId = null
          streamingConversation = false
          throwIfAborted(turnSignal)
          const answer = await finalizeAdvisorConversationAnswer(this, effectiveInput, kind, boundedModelText(response.message?.content), true, finalizationSignal())
          return { ...answer, streamed: wasStreaming || response.streamed }
        } catch (error) {
          activeRequestId = null
          streamingConversation = false
          if (shouldRethrow(error)) throw error
          return finalizeAdvisorConversationAnswer(this, effectiveInput, kind, '', false, finalizationSignal())
        }
      }

      const fallback = async (note: string, modelUsed = false): Promise<AdvisorAnswer> => {
        const deterministic = deterministicPlanningFallback(fallbackPlan, definitions, input.question)
        let evidenceItems: AdvisorEvidence[] = [...(input.requiredEvidence ?? [])]
        if (!evidenceItems.length) {
          try {
            evidenceItems = await executeRequests(input, deterministic.toolRequests, turnSignal)
          } catch (error) {
            if (shouldRethrow(error)) throw error
          }
        }
        if (signal?.aborted) throwIfAborted(signal)
        return finalizeModelAnswer({ runtime: this, input: { ...input, plan: deterministic.plan, guard }, evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence], finalContent: '', modelUsed, fallbackNote: deadline.didTimeout() ? BOUNDED_TURN_DEADLINE_NOTE : note }, finalizationSignal())
      }

      if (guard.authorization !== 'read-only') {
        let actionResponse: LocalChatResponse
        try {
          activeRequestId = requestId('advisor-action-chat')
          actionResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorChatMessages(input, fallbackPlan, guard, { textPlanningFallback: false }), tools: [], stream: false }, turnSignal), turnSignal)
          activeRequestId = null
          throwIfAborted(turnSignal)
        } catch (error) {
          activeRequestId = null
          if (shouldRethrow(error)) throw error
          return finalizeAdvisorConversationAnswer(this, input, 'action', '', false, finalizationSignal())
        }
        if ((Array.isArray(actionResponse.message?.tool_calls) && actionResponse.message!.tool_calls!.length > 0) || parseAdvisorPlanningDraft(actionResponse.message?.content ?? '')) {
          return finalizeAdvisorConversationAnswer(this, input, 'action', '', false, finalizationSignal())
        }
        return finalizeAdvisorConversationAnswer(this, input, 'action', boundedModelText(actionResponse.message?.content), true, finalizationSignal())
      }

      let firstResponse: LocalChatResponse
      try {
        activeRequestId = requestId('advisor-chat')
        firstResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorChatMessages(input, fallbackPlan, guard, { nativeToolCalls: definitions.length > 0, textPlanningFallback: definitions.length === 0 }), tools: definitions, stream: false }, turnSignal), turnSignal)
        activeRequestId = null
        throwIfAborted(turnSignal)
      } catch (error) {
        activeRequestId = null
        if (shouldRethrow(error)) throw error
        return fallback('The model response was unavailable; this answer uses the deterministic Metrora evidence path.')
      }

      const validation = planningValidation(input, firstResponse)
      if (!validation) {
        if (Array.isArray(firstResponse.message?.tool_calls) && firstResponse.message!.tool_calls!.length > 0) return fallback('The model requested a tool outside the bounded Metrora Tools contract.')
        const content = boundedModelText(firstResponse.message?.content)
        const fallbackIntent = input.fallbackIntent ?? input.evidence.intent
        const requiresEvidence = fallbackIntent === 'spend-change' || fallbackIntent === 'model-efficiency' || fallbackIntent === 'quota-capacity' || fallbackIntent === 'bench-result'
        if (requiresEvidence) return fallback('The direct model response did not request a verified Metrora read; canonical evidence is shown instead.')
        if (!content.trim() || /^(?:\{|\[|```)/u.test(content.trim())) return fallback('The model response was malformed or outside the bounded Metrora Tools contract.')
        return finalizeAdvisorConversationAnswer(this, input, 'social', content, true, finalizationSignal())
      }
      const effectiveInput: AdvisorRuntimeInput = { ...input, plan: validation.plan, guard }
      if (validation.plan.turnKind === 'social' || validation.plan.turnKind === 'boundary') {
        return conversation(validation.plan.turnKind, effectiveInput)
      }

      let currentInput = effectiveInput
      let currentPlan = validation.plan
      let currentResponse = firstResponse
      let evidenceItems: AdvisorEvidence[] = [...(input.requiredEvidence ?? [])]
      let toolRound = 0
      let totalToolCalls = 0
      const fallbackFromEvidence = (note: string, finalContent = '') => finalizeModelAnswer({
        runtime: this,
        input: currentInput,
        evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence],
        finalContent,
        modelUsed: true,
        fallbackNote: deadline.didTimeout() ? BOUNDED_TURN_DEADLINE_NOTE : note,
      }, finalizationSignal())

      while (true) {
        const nextValidation = toolRound === 0 ? validation : planningValidation(currentInput, currentResponse)
        if (!nextValidation) {
          if (Array.isArray(currentResponse.message?.tool_calls) && currentResponse.message!.tool_calls!.length > 0) {
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
          const roundEvidence = await executeRequests(currentInput, nextValidation.toolRequests, turnSignal)
          evidenceItems.push(...roundEvidence)
        } catch (error) {
          if (shouldRethrow(error)) throw error
          return fallbackFromEvidence('The model requested evidence that could not be executed; verified facts are shown instead.')
        }
        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        throwIfAborted(signal)
        totalToolCalls += requestedCalls
        toolRound += 1
        const effectiveEvidenceItems = evidenceItems.length ? evidenceItems : [input.evidence]
        if (hasMixedEvidenceScopes(effectiveEvidenceItems)) return fallbackFromEvidence('Conflicting tool scopes were rejected; no cross-scope synthesis was attempted.')

        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        if (toolRound < HARNESS_TOOL_LOOP_LIMITS.maxRounds && totalToolCalls < HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn) {
          activeRequestId = requestId('advisor-tool-continuation')
          try {
            currentResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
              model: this.model,
              messages: buildAdvisorToolContinuationMessages(currentInput, currentPlan, mergeEvidence(effectiveEvidenceItems, input.evidence), toolRound + 1, { nativeToolCalls: definitions.length > 0, textPlanningFallback: definitions.length === 0 }),
              tools: definitions,
              stream: false,
            }, turnSignal), turnSignal)
            activeRequestId = null
            throwIfAborted(turnSignal)
            continue
          } catch (error) {
            activeRequestId = null
            if (shouldRethrow(error)) throw error
            return fallbackFromEvidence('The bounded evidence continuation was unavailable; verified facts are shown instead.')
          }
        }

        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        activeRequestId = requestId('advisor-synthesis')
        let synthesisResponse: LocalChatResponse
        try {
          synthesisResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, { model: this.model, messages: buildAdvisorSynthesisMessages(currentInput, currentPlan, mergeEvidence(effectiveEvidenceItems, input.evidence)), tools: [], stream: false }, turnSignal), turnSignal)
          activeRequestId = null
          throwIfAborted(turnSignal)
        } catch (error) {
          activeRequestId = null
          if (shouldRethrow(error)) throw error
          return fallbackFromEvidence('The fresh synthesis phase was unavailable; verified Metrora facts are shown instead.')
        }
        return fallbackFromEvidence('', boundedModelText(synthesisResponse.message?.content))
      }
    } finally {
      streamingConversation = false
      removeDelta()
      turnSignal.removeEventListener('abort', cancel)
      deadline.dispose()
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
