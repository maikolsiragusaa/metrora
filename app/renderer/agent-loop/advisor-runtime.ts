import { assertStrictBoundedAdvisorToolContent, normalizeAdvisorRuntimeToolCall } from '../advisor/contract'
import { resolveAdvisorQuestion } from '../advisor/comprehension'
import { hasMixedEvidenceScopes, mergeEvidence } from '../advisor/merge-evidence'
import { evidenceUsable, buildAdvisorChatMessages, buildAdvisorConversationMessages, finalizeAdvisorConversationAnswer, finalizeModelAnswer } from '../advisor/model-flow'
import { runtimeGuardPlan } from '../advisor/planner'
import { advisorQuestionRequiresCanonicalReads, requiredAdvisorToolRequests } from '../advisor/required-reads'
import { contentMinimalEvidence } from '../advisor/privacy'
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
  MetroraAgentToolCall,
  MetroraAgentToolResult,
} from './contracts'

export type AdvisorAgentWireMode = 'flattened' | 'openai'

export type AdvisorAgentTransport = {
  complete: (requestId: string, payload: Record<string, unknown>, signal: AbortSignal) => Promise<AdvisorProviderModelResponse>
  cancel: (requestId: string) => Promise<boolean>
  wireMode: AdvisorAgentWireMode
  nativeToolCalls: boolean
  buildPayload: (input: {
    model: string
    messages: Array<Record<string, unknown>>
    tools: readonly AdvisorToolDefinition[]
    stream: boolean
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

function normalizedPromptLedger(input: AdvisorRuntimeInput, nativeToolCalls: boolean): MetroraAgentMessage[] {
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  const isConversation = fallbackPlan.turnKind === 'social' || fallbackPlan.turnKind === 'boundary' || guard.authorization !== 'read-only'
  const conversationKind = guard.authorization === 'proposal-required'
    ? 'action' as const
    : fallbackPlan.turnKind === 'boundary'
      ? 'boundary' as const
      : 'social' as const
  const messages = isConversation
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

function seedEvidenceLedger(ledger: MetroraAgentMessage[], evidenceItems: readonly AdvisorEvidence[], calls: readonly MetroraAgentToolCall[]): void {
  evidenceItems.forEach((evidence, index) => {
    const call = calls[index] ?? { id: 'controller-evidence-' + index, name: 'canonical_metrora_evidence', arguments: {} }
    ledger.push({
      role: 'assistant',
      content: 'Metrora supplied a verified read result for this turn.',
      toolCalls: [call],
    })
    ledger.push({
      role: 'tool',
      content: JSON.stringify(contentMinimalEvidence(evidence, { preserveEvidenceIds: true, modelFacing: true })),
      toolCallId: call.id,
      toolName: call.name,
    })
  })
}

function wireLedger(ledger: readonly MetroraAgentMessage[], mode: AdvisorAgentWireMode): Array<Record<string, unknown>> {
  return ledger.map(message => {
    if (message.role === 'tool') {
      if (mode === 'openai') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? 'metrora-tool-result' }
      return { role: 'user', content: 'Metrora Tool result' + (message.toolName ? ' (' + message.toolName + ')' : '') + ': ' + message.content }
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }))
      if (mode === 'openai') return { role: 'assistant', content: message.content, tool_calls: calls }
      const requestText = calls.map(call => {
        const fn = call.function as { name: string; arguments: string }
        return fn.name + ' ' + fn.arguments
      }).join('; ')
      return { role: 'assistant', content: [message.content, 'Metrora read request: ' + requestText].filter(Boolean).join('\n') }
    }
    return { role: message.role, content: message.content }
  })
}

function toolEventStatus(event: MetroraAgentLoopEvent): 'queued' | 'started' | 'completed' | 'unavailable' | 'failed' | 'cancelled' | null {
  if (event.type === 'tool-queued') return 'queued'
  if (event.type === 'tool-started') return 'started'
  if (event.type === 'tool-completed') return 'completed'
  if (event.type === 'tool-unavailable') return 'unavailable'
  if (event.type === 'tool-failed') return 'failed'
  return null
}

function fallbackNote(status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'limit'): string | undefined {
  if (status === 'timeout') return 'The bounded Metrora turn deadline was reached; verified facts are shown instead.'
  if (status === 'limit') return 'The bounded Metrora Tool loop limit was reached; verified facts are shown instead.'
  if (status === 'failed') return 'The bounded model step or continuation was unavailable; verified Metrora facts are shown instead.'
  return undefined
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
  const required = requiredCalls(requests)
  const seededEvidence = [...(input.requiredEvidence ?? [])]
  const ledger = normalizedPromptLedger(input, nativeToolCalls)
  seedEvidenceLedger(ledger, seededEvidence, required)
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
      const payload = transport.buildPayload({ model: options.model, messages: wireLedger(context.ledger, transport.wireMode), tools: nativeToolCalls ? definitions : [], stream: streamTurn })
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
  const note = fallbackNote(loop.status)
  const { fallbackPlan, guard } = runtimeGuardPlan(input)
  if (!isFactual || fallbackPlan.turnKind !== 'investigate' || guard.authorization !== 'read-only') {
    const kind = guard.authorization === 'proposal-required' ? 'action' : fallbackPlan.turnKind === 'boundary' ? 'boundary' : 'social'
    const answer = await finalizeAdvisorConversationAnswer(runtime, input, kind, content, usedModel, options.signal)
    return { ...answer, streamed: streamTurn && loop.streamed }
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
