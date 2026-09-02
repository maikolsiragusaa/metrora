import { normalizeAdvisorRuntimeToolCall } from '../advisor/contract'
import { parseAdvisorPlanningDraft, runtimeGuardPlan, validateAdvisorPlanningDraft } from '../advisor/planner'
import type { AdvisorRuntimeInput, AdvisorToolDefinition } from '../advisor/types'
import type { MetroraAgentContinuation, MetroraAgentModelStep, MetroraAgentToolCall } from './contracts'

export type AdvisorProviderModelResponse = {
  message?: { content?: unknown; tool_calls?: unknown }
  streamed?: unknown
  continuation?: MetroraAgentContinuation
}

export class MetroraModelStepError extends Error {
  readonly diagnostic: string

  constructor(diagnostic: string, message = 'The model step was not a valid bounded Metrora response.') {
    super(message)
    this.name = 'MetroraModelStepError'
    this.diagnostic = diagnostic
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function safeId(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) ? value : fallback
}

function callName(value: unknown): unknown {
  const item = record(value)
  if (!item) return undefined
  if (typeof item.name === 'string') return item.name
  return record(item.function)?.name
}

function callArguments(value: unknown): unknown {
  const item = record(value)
  if (!item) return undefined
  if (Object.prototype.hasOwnProperty.call(item, 'arguments')) return item.arguments
  return record(item.function)?.arguments
}

function nativeCalls(
  value: unknown,
  definitions: readonly AdvisorToolDefinition[],
): MetroraAgentToolCall[] {
  if (!Array.isArray(value)) throw new MetroraModelStepError('malformed_tool_call', 'The provider returned malformed tool calls.')
  const ids = new Set<string>()
  return value.slice(0, 16).map((item, index) => {
    const name = callName(item)
    const args = callArguments(item)
    try {
      const normalized = normalizeAdvisorRuntimeToolCall(name, args, definitions)
      let id = safeId(record(item)?.id, 'model-call-' + index)
      if (ids.has(id)) id = 'model-call-' + index
      ids.add(id)
      return { id, name: normalized.name, arguments: normalized.arguments as Record<string, unknown> }
    } catch {
      throw new MetroraModelStepError('malformed_tool_call', 'The provider returned a malformed Metrora tool call.')
    }
  })
}

function structuredCalls(
  content: string,
  input: AdvisorRuntimeInput,
  definitions: readonly AdvisorToolDefinition[],
): MetroraAgentToolCall[] | null {
  const draft = parseAdvisorPlanningDraft(content)
  if (!draft) return null
  const { guard } = runtimeGuardPlan(input)
  const validation = validateAdvisorPlanningDraft(draft, guard, input.evidence.scope, definitions)
  if (!validation || !validation.toolRequests.length) throw new MetroraModelStepError('malformed_tool_call', 'The model planning response did not contain an allowed read Tool.')
  return validation.toolRequests.map((request, index) => ({
    id: 'planning-call-' + index,
    name: request.tool,
    arguments: request.arguments as Record<string, unknown>,
  }))
}

export function normalizeAdvisorModelStep(
  response: AdvisorProviderModelResponse,
  input: AdvisorRuntimeInput,
  definitions: readonly AdvisorToolDefinition[],
  allowNativeToolCalls = true,
): MetroraAgentModelStep {
  const message = record(record(response)?.message)
  if (!message) throw new MetroraModelStepError('malformed_output', 'The provider returned no model message.')
  const content = typeof message.content === 'string' ? message.content : message.content === undefined ? '' : (() => { throw new MetroraModelStepError('malformed_output', 'The provider returned malformed model text.') })()
  const withContinuation = <T extends MetroraAgentModelStep>(step: T): T => response.continuation ? { ...step, continuation: response.continuation } : step
  const rawCalls = message.tool_calls
  if (Array.isArray(rawCalls) && rawCalls.length) {
    if (!allowNativeToolCalls) {
      const fallbackCalls = structuredCalls(content, input, definitions)
      if (fallbackCalls) return withContinuation({ kind: 'tool-calls', content: '', calls: fallbackCalls, streamed: response.streamed === true })
      throw new MetroraModelStepError('malformed_tool_call', 'Native Tool calls are not verified for this model.')
    }
    const calls = nativeCalls(rawCalls, definitions)
    return withContinuation({ kind: 'tool-calls', content, calls, streamed: response.streamed === true })
  }
  const calls = structuredCalls(content, input, definitions)
  if (calls) return withContinuation({ kind: 'tool-calls', content: '', calls, streamed: response.streamed === true })
  if (!content.trim()) throw new MetroraModelStepError('malformed_output', 'The provider returned an empty model message.')
  return withContinuation({ kind: 'final-text', content, calls: [], streamed: response.streamed === true })
}

export const normalizeMetroraModelStep = normalizeAdvisorModelStep
