import { emitMetroraAgentEvent, safeAgentEventText } from './events'
import type {
  MetroraAgentLoopBounds,
  MetroraAgentLoopEvent,
  MetroraAgentLoopOptions,
  MetroraAgentLoopResult,
  MetroraAgentMessage,
  MetroraAgentContinuation,
  MetroraAgentModelStep,
  MetroraAgentToolCall,
  MetroraAgentToolResult,
  MetroraAgentToolValidation,
} from './contracts'

const DEFAULT_TURN_ID = 'metrora-turn'
const CANCELLED_MESSAGE = 'Metrora agent turn cancelled.'

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function abortError(message = CANCELLED_MESSAGE): DOMException {
  return new DOMException(message, 'AbortError')
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.then(() => undefined, () => undefined)
    return Promise.reject(abortError())
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(value => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
}

function cloneCall(call: MetroraAgentToolCall): MetroraAgentToolCall {
  return { id: call.id, name: call.name, arguments: { ...call.arguments } }
}

function cloneMessage(message: MetroraAgentMessage): MetroraAgentMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map(cloneCall) } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
  }
}

function cloneContinuation(value: MetroraAgentContinuation | undefined): MetroraAgentContinuation | undefined {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.provider !== 'string' || typeof value.model !== 'string' || typeof value.protocol !== 'string' || typeof value.adapter !== 'string') return undefined
  const keys = Object.keys(value)
  if (keys.length !== 5 || keys.some(key => !['id', 'provider', 'model', 'protocol', 'adapter'].includes(key))) return undefined
  try {
    const encoded = JSON.stringify(value)
    if (new TextEncoder().encode(encoded).byteLength > 1024) return undefined
    const cloned = JSON.parse(encoded) as MetroraAgentContinuation
    return cloned
  } catch {
    return undefined
  }
}

function boundedBounds(input: MetroraAgentLoopBounds): MetroraAgentLoopBounds {
  const positive = (value: number, fallback: number) => Number.isSafeInteger(value) && value > 0 ? value : fallback
  return {
    maxSteps: positive(input.maxSteps, 1),
    maxCallsPerStep: positive(input.maxCallsPerStep, 1),
    maxCallsPerTurn: positive(input.maxCallsPerTurn, 1),
    maxToolRounds: positive(input.maxToolRounds, 1),
    maxParallelToolCalls: positive(input.maxParallelToolCalls, 1),
    turnTimeoutMs: positive(input.turnTimeoutMs, 1),
    maxContentBytes: positive(input.maxContentBytes, 8 * 1024),
    maxLedgerMessages: positive(input.maxLedgerMessages, 32),
  }
}

function defaultValidation(call: MetroraAgentToolCall, tools: readonly unknown[]): MetroraAgentToolValidation {
  const names = new Set(tools.flatMap(tool => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return []
    const fn = (tool as { function?: unknown }).function
    if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return []
    const name = (fn as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? [name] : []
  }))
  return names.has(call.name)
    ? { ok: true, call }
    : { ok: false, diagnostic: 'tool_not_allowlisted', detail: 'Tool is not in the immutable Metrora allowlist.' }
}

function errorContent(): string {
  return '{"available":false,"error":"Metrora Tool result unavailable for this bounded turn."}'
}

function resultStatus(result: MetroraAgentToolResult): 'completed' | 'unavailable' {
  return result.unavailable || result.evidenceStatus === 'unavailable' ? 'unavailable' : 'completed'
}

function resultEvidenceUsable(result: MetroraAgentToolResult): boolean {
  return !result.unavailable && result.evidenceStatus !== 'unavailable' && Boolean(result.evidence)
}

export class MetroraAgentLoop {
  private readonly options: MetroraAgentLoopOptions

  constructor(options: MetroraAgentLoopOptions) {
    this.options = options
  }

  async run(): Promise<MetroraAgentLoopResult> {
    const { options } = this
    const bounds = boundedBounds(options.bounds)
    const turnId = options.turnId?.trim() || DEFAULT_TURN_ID
    const now = options.now ?? (() => new Date().toISOString())
    const diagnostics: string[] = []
    const initialLedger = options.ledger.map(cloneMessage).filter(message => bytes(message.content) <= bounds.maxContentBytes)
    const ledger = initialLedger.length <= bounds.maxLedgerMessages
      ? initialLedger
      : bounds.maxLedgerMessages === 1
        ? initialLedger.slice(-1)
        : [initialLedger[0]!, ...initialLedger.slice(-(bounds.maxLedgerMessages - 1))]
    if (ledger.length !== options.ledger.length) diagnostics.push('agent_ledger_limit')
    const evidence: unknown[] = []
    const required = (options.requiredToolCalls ?? []).map(cloneCall)
    const requiredState = new Map(required.map(call => [this.callKey(call), 'pending' as 'pending' | 'satisfied' | 'attempted']))
    let requiredReady = options.requiredEvidenceReady ?? required.length === 0
    let baselineAttempted = required.length === 0
    let modelSteps = 0
    let toolCalls = 0
    let toolRounds = 0
    let finalText = ''
    let streamed = false
    let disposed = false
    let timedOut = false
    let continuation: MetroraAgentContinuation | undefined
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, bounds.turnTimeoutMs)
    const emit = (type: MetroraAgentLoopEvent['type'], fields: Omit<MetroraAgentLoopEvent, 'type' | 'turnId' | 'at'> = {}) => {
      if (disposed) return
      emitMetroraAgentEvent(options.onEvent, type, turnId, now, fields)
    }
    const cancelModel = () => {
      try { options.cancelModel?.() } catch { /* cancellation is best effort */ }
    }
    controller.signal.addEventListener('abort', cancelModel, { once: true })
    const append = (message: MetroraAgentMessage) => {
      if (ledger.length >= bounds.maxLedgerMessages || bytes(message.content) > bounds.maxContentBytes) throw new Error('agent_ledger_limit')
      ledger.push(cloneMessage(message))
    }
    const executeOne = async (call: MetroraAgentToolCall, step: number): Promise<void> => {
      if (controller.signal.aborted) throw abortError()
      const safeName = safeAgentEventText(call.name, 96) ?? 'unknown-tool'
      emit('tool-queued', { step, tool: safeName, callId: call.id })
      const validation = (options.validateToolCall ?? (candidate => defaultValidation(candidate, options.tools)))(call)
      if (!validation.ok) {
        diagnostics.push(validation.diagnostic)
        emit('tool-unavailable', { step, tool: safeName, callId: call.id, detail: validation.diagnostic })
        append({ role: 'tool', content: errorContent(), toolCallId: call.id, toolName: safeName })
        this.markRequired(call, requiredState, false)
        return
      }
      const validCall = validation.call
      emit('tool-started', { step, tool: safeName, callId: validCall.id })
      try {
        const raw = await raceAbort(Promise.resolve().then(() => options.executeTool(validCall, controller.signal)), controller.signal)
        if (typeof raw.content !== 'string' || bytes(raw.content) > bounds.maxContentBytes) throw new Error('tool_output_limit')
        const status = resultStatus(raw)
        if (raw.evidence && status !== 'unavailable') evidence.push(raw.evidence)
        if (resultEvidenceUsable(raw)) this.markRequired(validCall, requiredState, true)
        else this.markRequired(validCall, requiredState, false)
        append({ role: 'tool', content: raw.content, toolCallId: validCall.id, toolName: safeName })
        emit(status === 'completed' ? 'tool-completed' : 'tool-unavailable', { step, tool: safeName, callId: validCall.id })
      } catch (error) {
        if (isAbortLike(error) || controller.signal.aborted) throw error
        const diagnostic = error instanceof Error && error.message === 'tool_output_limit' ? 'tool_output_limit' : 'tool_execution_failed'
        diagnostics.push(diagnostic)
        this.markRequired(validCall, requiredState, false)
        append({ role: 'tool', content: errorContent(), toolCallId: validCall.id, toolName: safeName })
        emit('tool-failed', { step, tool: safeName, callId: validCall.id, detail: diagnostic })
      }
    }
    const executeCalls = async (calls: readonly MetroraAgentToolCall[], step: number, appendAssistantToolCall = false): Promise<boolean> => {
      if (toolRounds >= bounds.maxToolRounds) {
        diagnostics.push('tool_round_limit')
        return false
      }
      const remaining = bounds.maxCallsPerTurn - toolCalls
      const accepted = calls.slice(0, Math.min(bounds.maxCallsPerStep, Math.max(0, remaining)))
      if (!accepted.length) {
        diagnostics.push('tool_limit')
        return false
      }
      if (appendAssistantToolCall) append({ role: 'assistant', content: '', toolCalls: accepted })
      toolCalls += accepted.length
      toolRounds += 1
      for (const call of accepted) await executeOne(call, step)
      if (accepted.length < calls.length) diagnostics.push('tool_limit')
      return accepted.length === calls.length
    }
    const baselineCalls = () => required.filter(call => requiredState.get(this.callKey(call)) === 'pending')
    const finish = (status: MetroraAgentLoopResult['status']): MetroraAgentLoopResult => ({
      status,
      finalText,
      streamed,
      evidence,
      ledger: ledger.map(cloneMessage),
      modelSteps,
      toolCalls,
      toolRounds,
      diagnostics: [...new Set(diagnostics)],
    })
    emit('turn-started')
    try {
      while (true) {
        if (controller.signal.aborted) throw abortError()
        if (modelSteps >= bounds.maxSteps) {
          diagnostics.push('step_limit')
          emit('turn-failed', { detail: 'step_limit' })
          return finish('limit')
        }
        modelSteps += 1
        emit('model-started', { step: modelSteps })
        let step: MetroraAgentModelStep
        try {
          step = await raceAbort(Promise.resolve().then(() => options.complete({ ledger: ledger.map(cloneMessage), tools: options.tools, step: modelSteps, signal: controller.signal, ...(continuation ? { continuation: cloneContinuation(continuation) } : {}) })), controller.signal)
        } catch (error) {
          if (isAbortLike(error) || controller.signal.aborted) throw error
          const diagnostic = error && typeof error === 'object' && 'diagnostic' in error && typeof (error as { diagnostic?: unknown }).diagnostic === 'string'
            ? (error as { diagnostic: string }).diagnostic
            : 'provider_failure'
          diagnostics.push(diagnostic)
          emit('turn-failed', { step: modelSteps, detail: diagnostic })
          return finish('failed')
        }
        if (typeof step.content !== 'string' || bytes(step.content) > bounds.maxContentBytes || (step.kind === 'tool-calls' && !step.calls.length)) {
          diagnostics.push('malformed_output')
          emit('turn-failed', { step: modelSteps, detail: 'malformed_output' })
          return finish('failed')
        }
        emit('model-completed', { step: modelSteps, detail: step.kind })
        streamed ||= step.streamed === true
        continuation = cloneContinuation(step.continuation)
        append({ role: 'assistant', content: step.content, ...(step.calls.length ? { toolCalls: step.calls } : {}) })
        if (step.kind === 'tool-calls') {
          if (toolRounds >= bounds.maxToolRounds) {
            diagnostics.push('tool_round_limit')
            emit('turn-failed', { step: modelSteps, detail: 'tool_round_limit' })
            return finish('limit')
          }
          const allAccepted = await executeCalls(step.calls, modelSteps)
          if (!allAccepted) {
            emit('turn-failed', { step: modelSteps, detail: 'tool_limit' })
            return finish('limit')
          }
          requiredReady = this.requiredReady(requiredState)
          continue
        }
        finalText = step.content
        if (!requiredReady && !baselineAttempted && baselineCalls().length) {
          const calls = baselineCalls()
          baselineAttempted = true
          const allAccepted = await executeCalls(calls, modelSteps, true)
          requiredReady = this.requiredReady(requiredState)
          if (!allAccepted) {
            emit('turn-failed', { step: modelSteps, detail: 'tool_limit' })
            return finish('limit')
          }
          continue
        }
        emit('turn-completed', { step: modelSteps })
        return finish('completed')
      }
    } catch (error) {
      if (timedOut) {
        diagnostics.push('deadline')
        emit('turn-timeout', { detail: 'deadline' })
        return finish('timeout')
      }
      if (options.signal?.aborted || isAbortLike(error)) {
        diagnostics.push('cancelled')
        emit('turn-cancelled', { detail: 'cancelled' })
        return finish('cancelled')
      }
      diagnostics.push('turn_failure')
      emit('turn-failed', { detail: 'turn_failure' })
      return finish('failed')
    } finally {
      disposed = true
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', cancelModel)
      options.signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private callKey(call: MetroraAgentToolCall): string {
    return call.name + '\u0000' + JSON.stringify(call.arguments)
  }

  private markRequired(call: MetroraAgentToolCall, state: Map<string, 'pending' | 'satisfied' | 'attempted'>, usable: boolean): void {
    const key = this.callKey(call)
    if (!state.has(key)) return
    state.set(key, usable ? 'satisfied' : 'attempted')
  }

  private requiredReady(state: Map<string, 'pending' | 'satisfied' | 'attempted'>): boolean {
    return [...state.values()].every(value => value === 'satisfied')
  }
}

export async function runMetroraAgentLoop(options: MetroraAgentLoopOptions): Promise<MetroraAgentLoopResult> {
  return new MetroraAgentLoop(options).run()
}
