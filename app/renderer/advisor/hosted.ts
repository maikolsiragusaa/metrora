import { metrora } from '../lib/ipc'
import { AdvisorToolContractError, assertStrictBoundedAdvisorToolContent } from './contract'
import { buildAdvisorChatMessages, buildAdvisorConversationMessages, buildAdvisorToolContinuationMessages, finalizeAdvisorConversationAnswer, finalizeModelAnswer, buildAdvisorSynthesisMessages } from './model-flow'
import { deterministicPlanningFallback, parseAdvisorPlanningDraft, planningDraftFromNativeToolCalls, runtimeGuardPlan, validateAdvisorPlanningDraft, type AdvisorPlanningValidation } from './planner'
import { hasMixedEvidenceScopes, mergeEvidence } from './merge-evidence'
import { HARNESS_TOOL_LOOP_LIMITS } from './limits'
import { parseAdvisorSynthesisDraft } from './synthesis'
import { createAdvisorTurnDeadline, raceAdvisorAbort, shouldRethrowAdvisorAbort } from './abort'
import type { AdvisorAnswer, AdvisorEvidence, AdvisorHostedModel, AdvisorHostedModelCapabilities, AdvisorHostedProviderId, AdvisorModelRuntime, AdvisorRuntimeInput, AdvisorToolDefinition, AdvisorToolRequestV1 } from './types'

const BOUNDED_TURN_DEADLINE_NOTE = 'The bounded Metrora turn deadline was reached; verified facts are shown instead.'

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

function isNormalizedHostedResponse(value: unknown): value is { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean } {
  if (!isRecord(value) || typeof value.streamed !== 'boolean' || !isRecord(value.message)) return false
  if (typeof value.message.content !== 'string' || new TextEncoder().encode(value.message.content).byteLength > 32 * 1024) return false
  const toolCalls = value.message.tool_calls
  if (toolCalls !== undefined && (!Array.isArray(toolCalls) || toolCalls.length > 16 || toolCalls.some(call => !normalizedHostedToolCall(call)))) return false
  return Boolean(value.message.content) || Boolean(Array.isArray(toolCalls) && toolCalls.length)
}

function toolDefinitions(input: AdvisorRuntimeInput): readonly AdvisorToolDefinition[] {
  return input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : []
}

function planningValidation(input: AdvisorRuntimeInput, response: { message: { content: string; tool_calls?: Array<Record<string, unknown>> } }, allowNativeToolCalls = true): AdvisorPlanningValidation | null {
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  let draft = parseAdvisorPlanningDraft(response.message?.content ?? '')
  if (!draft && allowNativeToolCalls && Array.isArray(response.message?.tool_calls)) {
    try {
      draft = planningDraftFromNativeToolCalls(response.message.tool_calls, fallbackPlan)
    } catch {
      // Provider-native calls are untrusted. A malformed call must not escape
      // the planning boundary or reach the Tool executor.
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
    if (typeof result.content !== 'string' || result.content.length > 32 * 1024) throw new AdvisorToolContractError('output-too-large', 'Metrora tool content exceeded its safety limit.')
    // The renderer still validates content-minimal output locally; it is never
    // replayed as a provider-native tool result.
    assertStrictBoundedAdvisorToolContent(result.content)
    evidence.push(result.evidence)
      input.onToolEvent?.({ name: request.tool, status: result.envelope?.unavailable || result.evidence.coverage.level === 'unavailable' ? 'unavailable' : 'completed' })
    } catch (error) {
      input.onToolEvent?.({ name: request.tool, status: signal?.aborted || (error instanceof Error && /cancel|abort/i.test(error.message)) ? 'cancelled' : 'failed' })
      throw error
    }
  }
  return evidence
}

export class HostedAdvisorRuntime implements AdvisorModelRuntime {
  readonly id: string
  readonly label: string
  readonly mode = 'hosted-byok' as const
  readonly providerSupport: readonly string[]
  readonly supportsStreaming: boolean
  readonly availability = 'ready' as const
  private readonly provider: HostedAdvisorProvider
  private readonly model: string
  private readonly consent: boolean
  private readonly capabilities: AdvisorHostedModelCapabilities
  private readonly transport: HostedAdvisorTransport

  constructor(options: { provider: HostedAdvisorProvider; model: string; capabilities?: AdvisorHostedModelCapabilities; consent?: boolean; transport?: HostedAdvisorTransport }) {
    this.provider = options.provider
    this.model = options.model
    this.transport = options.transport ?? bridgeTransport
    this.consent = options.consent === true
    this.capabilities = options.capabilities ?? { conversational: 'unknown', streaming: 'unknown', toolCall: 'unknown' }
    this.supportsStreaming = this.capabilities.streaming !== 'unsupported'
    this.id = 'hosted-' + options.provider
    const providerLabel = options.provider === 'opencode-zen' ? 'OpenCode Zen' : options.provider === 'openrouter' ? 'OpenRouter' : options.provider.charAt(0).toUpperCase() + options.provider.slice(1)
    this.label = providerLabel + ' · ' + options.model.replace(/^models\//u, '')
    this.providerSupport = [options.provider + ' official API']
  }

  async generate(input: AdvisorRuntimeInput, signal?: AbortSignal): Promise<AdvisorAnswer> {
    if (signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
    if (!this.consent) throw new Error('Hosted evidence sharing consent is required.')
    const definitions = toolDefinitions(input)
    const { fallbackPlan, guard } = runtimeGuardPlan(input)
    if (guard.authorization !== 'read-only') {
      return finalizeModelAnswer({ runtime: this, input, evidenceItems: [input.evidence], finalContent: '', modelUsed: false }, signal)
    }
    const deadline = createAdvisorTurnDeadline(signal, HARNESS_TOOL_LOOP_LIMITS.turnTimeoutMs)
    const turnSignal = deadline.signal
    const finalizationSignal = () => deadline.didTimeout() ? undefined : turnSignal
    const shouldRethrow = (error: unknown) => shouldRethrowAdvisorAbort(error, signal, deadline)
    let activeRequestId: string | null = null
    let conformanceReported = false
    const reportConformance = () => {
      if (conformanceReported) return
      conformanceReported = true
      input.onConformance?.()
    }
    const cancel = () => { if (activeRequestId) void this.transport.cancel(activeRequestId).catch(() => {}) }
    turnSignal.addEventListener('abort', cancel, { once: true })
    try {
      const conversation = async (kind: 'social' | 'boundary', effectiveInput: AdvisorRuntimeInput): Promise<AdvisorAnswer> => {
        try {
          activeRequestId = requestId('hosted-conversation')
          const response = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
            provider: this.provider,
            model: this.model,
            messages: buildAdvisorConversationMessages(effectiveInput, kind),
            tools: [],
            stream: false,
            consent: true,
          }, turnSignal), turnSignal)
          activeRequestId = null
          throwIfAborted(turnSignal)
          return finalizeAdvisorConversationAnswer(this, effectiveInput, kind, response.message?.content ?? '', true, finalizationSignal())
        } catch (error) {
          activeRequestId = null
          if (shouldRethrow(error)) throw error
          return finalizeAdvisorConversationAnswer(this, effectiveInput, kind, '', false, finalizationSignal())
        }
      }

      const fallback = async (note: string, modelUsed = false): Promise<AdvisorAnswer> => {
        const deterministic = deterministicPlanningFallback(fallbackPlan, definitions, input.question)
        let evidenceItems: AdvisorEvidence[] = []
        try { evidenceItems = await executeRequests(input, deterministic.toolRequests, turnSignal) } catch (error) {
          if (shouldRethrow(error)) throw error
        }
        if (signal?.aborted) throwIfAborted(signal)
        return finalizeModelAnswer({ runtime: this, input: { ...input, plan: deterministic.plan, guard }, evidenceItems: evidenceItems.length ? evidenceItems : [input.evidence], finalContent: '', modelUsed, fallbackNote: deadline.didTimeout() ? BOUNDED_TURN_DEADLINE_NOTE : note }, finalizationSignal())
      }

      let firstResponse: { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }
      const allowNativeToolCalls = this.capabilities.toolCall === 'supported'
      try {
        activeRequestId = requestId('hosted-chat')
        firstResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
          provider: this.provider,
          model: this.model,
          messages: buildAdvisorChatMessages(input, fallbackPlan, guard, { nativeToolCalls: allowNativeToolCalls, textPlanningFallback: !allowNativeToolCalls }),
          tools: allowNativeToolCalls ? definitions : [],
          stream: false,
          consent: true,
          harnessConformance: true,
        }, turnSignal), turnSignal)
        activeRequestId = null
        throwIfAborted(turnSignal)
      } catch (error) {
        activeRequestId = null
        if (shouldRethrow(error)) throw error
        return fallback('The hosted model response was unavailable; this answer uses the deterministic Metrora evidence path.')
      }

      if (!isNormalizedHostedResponse(firstResponse)) {
        return fallback('The hosted model response was malformed; this answer uses the deterministic Metrora evidence path.')
      }
      // The provider boundary has already normalized and bounded this first
      // response. It is the first qualifying Harness request; no extra tool or
      // synthesis round is required to establish conversational conformance.
      reportConformance()

      const validation = planningValidation(input, firstResponse, allowNativeToolCalls)
      if (!validation) {
        if (Array.isArray(firstResponse.message?.tool_calls) && firstResponse.message.tool_calls.length > 0) return fallback('The model requested a tool outside the bounded Metrora Tools contract.')
        const content = firstResponse.message?.content ?? ''
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
      let evidenceItems: AdvisorEvidence[] = []
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
        const nextValidation = toolRound === 0 ? validation : planningValidation(currentInput, currentResponse, allowNativeToolCalls)
        if (!nextValidation) {
          if (Array.isArray(currentResponse.message?.tool_calls) && currentResponse.message.tool_calls.length > 0) {
            return fallbackFromEvidence('The model requested a tool outside the bounded Metrora Tools contract; verified facts are shown instead.')
          }
          const finalContent = currentResponse.message?.content ?? ''
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
          return fallbackFromEvidence('The hosted model requested evidence that could not be executed; verified facts are shown instead.')
        }
        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        throwIfAborted(signal)
        totalToolCalls += requestedCalls
        toolRound += 1
        const effectiveEvidenceItems = evidenceItems.length ? evidenceItems : [input.evidence]
        if (hasMixedEvidenceScopes(effectiveEvidenceItems)) return fallbackFromEvidence('Conflicting tool scopes were rejected; no cross-scope synthesis was attempted.')

        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        if (toolRound < HARNESS_TOOL_LOOP_LIMITS.maxRounds && totalToolCalls < HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn) {
          activeRequestId = requestId('hosted-tool-continuation')
          try {
            currentResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
              provider: this.provider,
              model: this.model,
              messages: buildAdvisorToolContinuationMessages(currentInput, currentPlan, mergeEvidence(effectiveEvidenceItems, input.evidence), toolRound + 1, { nativeToolCalls: allowNativeToolCalls, textPlanningFallback: !allowNativeToolCalls }),
              tools: allowNativeToolCalls ? definitions : [],
              stream: false,
              consent: true,
              harnessConformance: true,
            }, turnSignal), turnSignal)
            activeRequestId = null
            throwIfAborted(turnSignal)
            if (!isNormalizedHostedResponse(currentResponse)) throw new Error('The bounded hosted continuation was malformed.')
            reportConformance()
            continue
          } catch (error) {
            activeRequestId = null
            if (shouldRethrow(error)) throw error
            return fallbackFromEvidence('The bounded hosted evidence continuation was unavailable; verified facts are shown instead.')
          }
        }

        if (deadline.didTimeout()) return fallbackFromEvidence(BOUNDED_TURN_DEADLINE_NOTE)
        activeRequestId = requestId('hosted-synthesis')
        let synthesisResponse: { message: { content: string; tool_calls?: Array<Record<string, unknown>> }; streamed: boolean }
        try {
          const mergedEvidence = mergeEvidence(effectiveEvidenceItems, input.evidence)
          synthesisResponse = await raceAdvisorAbort(this.transport.chat(activeRequestId, {
            provider: this.provider,
            model: this.model,
            messages: buildAdvisorSynthesisMessages(currentInput, currentPlan, mergedEvidence),
            tools: [],
            stream: false,
            consent: true,
            harnessConformance: true,
          }, turnSignal), turnSignal)
          activeRequestId = null
          throwIfAborted(turnSignal)
          if (!isNormalizedHostedResponse(synthesisResponse)) throw new Error('The bounded hosted synthesis response was malformed.')
          reportConformance()
        } catch (error) {
          activeRequestId = null
          if (shouldRethrow(error)) throw error
          return fallbackFromEvidence('The fresh hosted synthesis phase was unavailable; verified Metrora facts are shown instead.')
        }
        return fallbackFromEvidence('', synthesisResponse.message?.content ?? '')
      }
    } finally {
      turnSignal.removeEventListener('abort', cancel)
      deadline.dispose()
    }
  }
}
