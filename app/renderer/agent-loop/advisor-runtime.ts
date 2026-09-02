import { assertStrictBoundedAdvisorToolContent, normalizeAdvisorRuntimeToolCall } from '../advisor/contract'
import { resolveAdvisorQuestion } from '../advisor/comprehension'
import { hasMixedEvidenceScopes, mergeEvidence } from '../advisor/merge-evidence'
import { evidenceUsable, buildAdvisorChatMessages, buildAdvisorConversationMessages, buildAdvisorEvidenceSynthesisMessages, finalizeAdvisorConversationAnswer, finalizeModelAnswer } from '../advisor/model-flow'
import { runtimeGuardPlan } from '../advisor/planner'
import { advisorQuestionRequiresCanonicalReads, requiredAdvisorToolRequests } from '../advisor/required-reads'
import { HARNESS_TOOL_LOOP_LIMITS } from '../advisor/limits'
import type {
  AdvisorAnswer,
  AdvisorEvidence,
  AdvisorModelRuntime,
  AdvisorRuntimeInput,
  AdvisorToolDefinition,
  AdvisorToolExecution,
  AdvisorToolRequestV1,
} from '../advisor/types'
import { runMetroraAgentLoop } from './loop'
import { normalizeAdvisorModelStep, type AdvisorProviderModelResponse } from './model-step'
import type {
  MetroraAgentLoopBounds,
  MetroraAgentLoopEvent,
  MetroraAgentMessage,
  MetroraAgentContinuation,
  MetroraAgentToolCall,
  MetroraAgentToolResult,
} from './contracts'

export type AdvisorAgentTransport = {
  complete: (requestId: string, payload: Record<string, unknown>, signal: AbortSignal) => Promise<AdvisorProviderModelResponse>
  cancel: (requestId: string) => Promise<boolean>
  nativeToolCalls: boolean
  buildPayload: (input: {
    model: string
    messages: readonly MetroraAgentMessage[]
    tools: readonly AdvisorToolDefinition[]
    stream: boolean
    continuation?: MetroraAgentContinuation
  }) => Record<string, unknown>
  reportConformance?: boolean
}

export type AdvisorAgentLoopOptions = {
  runtime: AdvisorModelRuntime
  model: string
  input: AdvisorRuntimeInput
  signal?: AbortSignal
  transport: AdvisorAgentTransport
}

function requestId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedText(value: string, max = 32 * 1024): string {
  return bytes(value) <= max ? value : ''
}

function toolDefinitions(input: AdvisorRuntimeInput): readonly AdvisorToolDefinition[] {
  return input.toolContract?.tools ? [...input.toolContract.tools] : input.tools ? [...input.tools] : []
}

function loopBounds(input: AdvisorRuntimeInput): MetroraAgentLoopBounds {
  const override = input.agentLoopBounds ?? {}
  const configured = (key: keyof MetroraAgentLoopBounds, fallback: number): number => {
    const value = override[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback
  }
  return {
    maxSteps: configured('maxSteps', HARNESS_TOOL_LOOP_LIMITS.maxSteps),
    maxCallsPerStep: configured('maxCallsPerStep', HARNESS_TOOL_LOOP_LIMITS.maxCallsPerRound),
    maxCallsPerTurn: configured('maxCallsPerTurn', HARNESS_TOOL_LOOP_LIMITS.maxCallsPerTurn),
    maxToolRounds: configured('maxToolRounds', HARNESS_TOOL_LOOP_LIMITS.maxRounds),
    maxParallelToolCalls: configured('maxParallelToolCalls', HARNESS_TOOL_LOOP_LIMITS.maxParallelToolCalls),
    turnTimeoutMs: configured('turnTimeoutMs', HARNESS_TOOL_LOOP_LIMITS.turnTimeoutMs),
    maxContentBytes: configured('maxContentBytes', 32 * 1024),
    maxLedgerMessages: configured('maxLedgerMessages', 32),
  }
}

function normalizedPromptLedger(input: AdvisorRuntimeInput, nativeToolCalls: boolean, seededEvidence: readonly AdvisorEvidence[]): MetroraAgentMessage[] {
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  const isConversation = fallbackPlan.turnKind === 'social' || fallbackPlan.turnKind === 'boundary' || guard.authorization !== 'read-only'
  const conversationKind = guard.authorization === 'proposal-required'
    ? 'action' as const
    : fallbackPlan.turnKind === 'boundary'
      ? 'boundary' as const
      : 'social' as const
  const suppliedEvidence = seededEvidence.length ? mergeEvidence([...seededEvidence], seededEvidence[0]!) : null
  const messages = suppliedEvidence
    ? buildAdvisorEvidenceSynthesisMessages(input, fallbackPlan, guard, suppliedEvidence)
    : isConversation
      ? buildAdvisorConversationMessages(input, conversationKind)
      : buildAdvisorChatMessages(input, fallbackPlan, guard, { nativeToolCalls, textPlanningFallback: !nativeToolCalls })
  return messages.map(message => ({ role: message.role, content: message.content }))
}

function requiredRequests(input: AdvisorRuntimeInput, definitions: readonly AdvisorToolDefinition[]): AdvisorToolRequestV1[] {
  if (input.requiredToolRequests) return [...input.requiredToolRequests]
  const resolved = resolveAdvisorQuestion(input.question, input.evidence.scope, input.conversation)
  return advisorQuestionRequiresCanonicalReads(resolved)
    ? requiredAdvisorToolRequests(resolved, definitions, input.question)
    : []
}

function requiredCalls(requests: readonly AdvisorToolRequestV1[]): MetroraAgentToolCall[] {
  return requests.map((request, index) => ({
    id: 'controller-required-' + index,
    name: request.tool,
    arguments: { ...request.arguments },
  }))
}

function toolEventStatus(event: MetroraAgentLoopEvent): 'queued' | 'started' | 'completed' | 'unavailable' | 'failed' | 'cancelled' | null {
  if (event.type === 'tool-queued') return 'queued'
  if (event.type === 'tool-started') return 'started'
  if (event.type === 'tool-completed') return 'completed'
  if (event.type === 'tool-unavailable') return 'unavailable'
  if (event.type === 'tool-failed') return 'failed'
  return null
}

function fallbackNote(status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'limit', factsAvailable: boolean): string | undefined {
  const suffix = factsAvailable
    ? ' Retrieved Metrora facts remain available in Sources and Details.'
    : ' Try again or choose another runtime.'
  if (status === 'timeout') return 'The selected model timed out before finishing.' + suffix
  if (status === 'limit') return 'The selected model reached the bounded turn limit before finishing.' + suffix
  if (status === 'failed') return 'The selected model could not finish this answer.' + suffix
  return undefined
}

function isModelRuntimeFailure(diagnostics: readonly string[]): boolean {
  // A model that tries to invoke an unavailable action is a policy boundary,
  // not a provider outage. Preserve the deterministic proposal-only answer
  // when that is the only diagnostic, while still surfacing a genuine
  // transport/loop failure if the diagnostics are mixed.
  const modelFailure = diagnostics.some(diagnostic => [
    'provider_failure',
    'malformed_output',
    'malformed_tool_call',
    'turn_failure',
    'deadline',
    'tool_execution_failed',
    'tool_output_limit',
    'step_limit',
    'tool_round_limit',
    'tool_limit',
  ].includes(diagnostic))
  return modelFailure
}

function factualTurn(input: AdvisorRuntimeInput): boolean {
  const { fallbackPlan } = runtimeGuardPlan(input)
  return fallbackPlan.turnKind === 'investigate' && advisorQuestionRequiresCanonicalReads(resolveAdvisorQuestion(input.question, input.evidence.scope, input.conversation))
}

function evidenceFromLoop(value: readonly unknown[]): AdvisorEvidence[] {
  return value.filter((item): item is AdvisorEvidence => Boolean(item && typeof item === 'object' && 'scope' in item && 'refs' in item))
}

function eventForwarder(input: AdvisorRuntimeInput, seenRounds: Set<number>): (event: MetroraAgentLoopEvent) => void {
  return event => {
    input.onAgentEvent?.(event)
    const status = toolEventStatus(event)
    if (!status || !event.tool) return
    if ((status === 'queued' || status === 'started') && event.step !== undefined && !seenRounds.has(event.step)) {
      seenRounds.add(event.step)
      input.onToolRound?.(event.step)
    }
    input.onToolEvent?.({ name: event.tool, status })
  }
}

export async function runAdvisorRuntimeAgentLoop(options: AdvisorAgentLoopOptions): Promise<AdvisorAnswer> {
  const { input, runtime, transport } = options
  if (options.signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  const definitions = toolDefinitions(input)
  const nativeToolCalls = transport.nativeToolCalls
  const requests = requiredRequests(input, definitions)
  const seededEvidence = [...(input.requiredEvidence ?? [])]
  // A controller-first baseline read is already complete (or truthfully
  // unavailable). Do not replay it as a fabricated provider-native tool call;
  // the model sees the bounded canonical evidence directly and may request
  // only an additional real Tool through the loop.
  const required = seededEvidence.length ? [] : requiredCalls(requests)
  const ledger = normalizedPromptLedger(input, nativeToolCalls, seededEvidence)
  const conformance = { reported: false }
  const active = { requestId: null as string | null }
  const seenRounds = new Set<number>()
  const inputRequiredReady = seededEvidence.length > 0 && evidenceUsable(seededEvidence)
  const isFactual = factualTurn(input)
  const { fallbackPlan: streamPlan, guard: streamGuard } = runtimeGuardPlan(input)
  const streamResolved = resolveAdvisorQuestion(input.question, input.evidence.scope, input.conversation)
  const streamTurn = Boolean(input.onDelta)
    && !isFactual
    && streamGuard.authorization === 'read-only'
    && (streamPlan.turnKind === 'social' || !advisorQuestionRequiresCanonicalReads(streamResolved))
  const loop = await runMetroraAgentLoop({
    turnId: requestId('metrora-agent-turn'),
    signal: options.signal,
    bounds: loopBounds(input),
    ledger,
    tools: nativeToolCalls ? definitions : [],
    requiredToolCalls: required,
    requiredEvidenceReady: required.length === 0 || inputRequiredReady,
    validateToolCall: call => {
      try {
        const normalized = normalizeAdvisorRuntimeToolCall(call.name, call.arguments, definitions)
        if (!definitions.some(definition => definition.function.name === normalized.name)) return { ok: false, diagnostic: 'tool_not_allowlisted', detail: 'Tool is not in the immutable Metrora allowlist.' }
        return { ok: true, call: { ...call, name: normalized.name, arguments: normalized.arguments as Record<string, unknown> } }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Malformed Metrora Tool call.'
        return { ok: false, diagnostic: 'malformed_tool_call', detail }
      }
    },
    complete: async context => {
      const id = requestId('metrora-agent-step')
      active.requestId = id
      const payload = transport.buildPayload({ model: options.model, messages: context.ledger, tools: nativeToolCalls ? definitions : [], stream: streamTurn, ...(context.continuation ? { continuation: context.continuation } : {}) })
      try {
        const response = await transport.complete(id, payload, context.signal)
        if (context.signal.aborted) throw new DOMException('Metrora model step cancelled', 'AbortError')
        const step = normalizeAdvisorModelStep(response, input, definitions, nativeToolCalls)
        if (transport.reportConformance && !conformance.reported) {
          conformance.reported = true
          input.onConformance?.()
        }
        return step
      } finally {
        active.requestId = null
      }
    },
    executeTool: async (call, signal): Promise<MetroraAgentToolResult> => {
      if (!input.executeTool) return { content: '{"available":false,"error":"Metrora Tool execution is unavailable."}', evidenceStatus: 'unavailable', unavailable: true }
      const execution: AdvisorToolExecution = await input.executeTool(call.name, call.arguments, signal)
      const unavailable = execution.envelope?.unavailable === true || execution.evidence.coverage.level === 'unavailable'
      const evidence = unavailable ? { ...execution.evidence, refs: [] } : execution.evidence
      const content = assertStrictBoundedAdvisorToolContent(execution.content)
      return {
        content: boundedText(content),
        evidence,
        evidenceStatus: unavailable ? 'unavailable' : execution.evidence.refs.length ? 'usable' : 'partial',
        unavailable,
      }
    },
    cancelModel: () => {
      if (active.requestId) void transport.cancel(active.requestId).catch(() => {})
    },
    onEvent: eventForwarder(input, seenRounds),
  })
  if (loop.status === 'cancelled' && options.signal?.aborted) throw new DOMException('Advisor request cancelled', 'AbortError')
  const loopEvidence = evidenceFromLoop(loop.evidence)
  const evidenceItems = [...seededEvidence, ...loopEvidence]
  const content = loop.status === 'completed' || loop.status === 'limit' ? loop.finalText : ''
  const usedModel = loop.modelSteps > 0
  const note = isModelRuntimeFailure(loop.diagnostics)
    ? fallbackNote(loop.status, evidenceUsable(evidenceItems))
    : undefined
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  if (!isFactual || fallbackPlan.turnKind !== 'investigate' || guard.authorization !== 'read-only') {
    const kind = guard.authorization === 'proposal-required' ? 'action' : fallbackPlan.turnKind === 'boundary' ? 'boundary' : 'social'
    const answer = await finalizeAdvisorConversationAnswer(runtime, input, kind, content, usedModel, options.signal)
    if (kind !== 'action' && note) {
      return {
        ...answer,
        conclusion: note,
        presentation: undefined,
        materialLimits: [...(answer.materialLimits ?? []), note],
        generatedByModel: false,
        runtimeFailure: true,
        streamed: false,
      }
    }
    return {
      ...answer,
      streamed: streamTurn && loop.streamed,
    }
  }
  const finalEvidence = evidenceItems.length ? evidenceItems : [input.evidence]
  const authoritative = !hasMixedEvidenceScopes(finalEvidence)
    ? mergeEvidence(finalEvidence, finalEvidence[0]!)
    : input.evidence
  const answer = await finalizeModelAnswer({
    runtime,
    input: { ...input, evidence: authoritative, plan: fallbackPlan, guard },
    evidenceItems: finalEvidence,
    finalContent: content,
    modelUsed: usedModel,
    fallbackNote: note,
  }, options.signal)
  return { ...answer, streamed: streamTurn && loop.streamed }
}
