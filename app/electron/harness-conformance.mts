import { randomUUID } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, ReasoningEffortId, type LlmAdapter, type StreamChunk, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import { projectHarnessText, type HarnessModelConformance, type HarnessReasoningEffort } from './harness-runtime-types.js'

const NONCE_TOOL_NAME = 'metrora_conformance_nonce'
const NONCE_TOOL: ToolSchema = {
  name: NONCE_TOOL_NAME,
  description: 'A harmless verification tool. Return the nonce argument unchanged.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { nonce: { type: 'string' } },
    required: ['nonce'],
  },
}

type ConformanceRun = {
  sessionEvents: readonly SessionEvent[]
  toolExecutions: number
  finalText: string
}

type ConformanceToolBehavior = 'identity' | 'fail'

function mount(ctx: Context, plugin: unknown, config?: unknown): Promise<void> {
  return (ctx.plugin as unknown as (plugin: unknown, config?: unknown) => Promise<void>)(plugin, config)
}

function textFromContent(content: readonly { type: string; text?: string; content?: unknown }[]): string {
  return content.map(block => {
    if (block.type === 'text') return block.text ?? ''
    return Array.isArray(block.content) ? textFromContent(block.content as { type: string; text?: string; content?: unknown }[]) : ''
  }).join('')
}

function contentFromMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const content = (value as { content?: unknown }).content
  return Array.isArray(content) ? textFromContent(content as { type: string; text?: string; content?: unknown }[]) : ''
}

function nonceFromCall(event: SessionEvent): string | null {
  const data = event.data as { arguments?: unknown } | undefined
  if (!data || typeof data.arguments !== 'string') return null
  try {
    const args = JSON.parse(data.arguments) as unknown
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    const nonce = (args as { nonce?: unknown }).nonce
    return typeof nonce === 'string' ? nonce : null
  } catch {
    return null
  }
}

function toolResultFor(events: readonly SessionEvent[], callId: string): SessionEvent | undefined {
  return events.find(event => event.type === 'tool/result' && (event.data as { message?: { source?: { kind?: string; callId?: unknown } } } | undefined)?.message?.source?.kind === 'tool' && String((event.data as { message: { source: { callId: unknown } } }).message.source.callId) === callId)
}

function finalAssistantText(events: readonly SessionEvent[]): string {
  const messages = events.filter(event => event.type === 'assistant/message')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = (messages[index]!.data as { message?: unknown } | undefined)?.message
    const text = contentFromMessage(message)
    if (text.trim()) return text.trim()
  }
  return ''
}

function toolDefinition(behavior: ConformanceToolBehavior, onExecute: () => void): ToolDefinition {
  return {
    ...NONCE_TOOL,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: `nonce verified: ${String(value)}` }],
    },
    execute: async (args) => {
      const nonce = args && typeof args === 'object' && !Array.isArray(args) ? (args as { nonce?: unknown }).nonce : undefined
      if (typeof nonce !== 'string') throw new Error('The conformance nonce argument is invalid.')
      if (behavior === 'fail') throw new Error('The conformance ToolRuntime fixture failed deliberately.')
      onExecute()
      return nonce
    },
  }
}

/**
 * Run the exact model through an isolated copy of the ordinary DSH path.
 *
 * The checker owns no provider parsing, Tool execution, message construction,
 * or second request. DSH AgentLoop creates the ephemeral Session, assembles
 * the request, invokes ToolRuntime, records the Tool result, and continues the
 * same turn. The isolated registry contains only the nonce Tool.
 */
async function runConformanceRoundTrip(options: {
  adapter: LlmAdapter
  provider: string
  model: string
  reasoningEffort?: HarnessReasoningEffort | null
  nonceToolBehavior?: ConformanceToolBehavior
  signal?: AbortSignal
}): Promise<ConformanceRun> {
  const ctx = new Context()
  let handle: { agent: { followup(input: ReturnType<typeof createUserMessage>): void; whenIdle(): Promise<void>; cancel(cause: { kind: 'disposed' }): void; session: { snapshotEvents(): readonly SessionEvent[] } }; dispose(): Promise<void> } | undefined
  let toolExecutions = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let requestCount = 0
  let abortListener: (() => void) | undefined
  try {
    await mount(ctx, LlmRuntime)
    await mount(ctx, SessionStore)
    await mount(ctx, SessionProjectionRegistry)
    await mount(ctx, SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'This is an isolated model capability check. Use the supplied nonce Tool and then provide a natural final sentence containing its result.',
    })
    await mount(ctx, ToolRuntime, { mode: 'native', maxParallelSubCalls: 1 })
    await mount(ctx, AgentRegistry)
    await mount(ctx, AgentLoop, { maxParallelToolCalls: 1, agents: [] })

    ctx.llm.registerAdapter([options.provider], options.adapter)
    ctx.tools.register(toolDefinition(options.nonceToolBehavior ?? 'identity', () => { toolExecutions += 1 }))
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))

    const nonce = `metrora-${randomUUID().slice(0, 12)}`
    handle = await ctx.agents.create({
      sessionId: SessionId(`conformance-${randomUUID()}`),
      agentOptions: {
        provider: options.provider,
        model: options.model,
        ...(options.reasoningEffort ? { reasoningEffort: ReasoningEffortId(options.reasoningEffort) } : {}),
      },
    })
    const agentContext = (handle.agent as unknown as { ctx: { on(event: string, listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void } }).ctx
    agentContext.on('agent/request', async (_payload: unknown, next: () => Promise<unknown>) => {
      requestCount += 1
      if (requestCount > 2) throw new Error('The isolated conformance Agent exceeded its two-request round-trip budget.')
      return next()
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: `For conformance only, call ${NONCE_TOOL_NAME} with nonce ${nonce}. Do not answer until the Tool result arrives.` }],
      source: { kind: 'user' },
    }))
    if (options.signal?.aborted) options.signal.throwIfAborted()
    const idle = handle.agent.whenIdle()
    const aborted = options.signal ? new Promise<never>((_, reject) => {
      abortListener = () => {
        try { handle?.agent.cancel({ kind: 'disposed' }) } catch { /* best effort */ }
        const error = new Error('The isolated conformance check was cancelled.')
        error.name = 'AbortError'
        reject(error)
      }
      options.signal!.addEventListener('abort', abortListener, { once: true })
    }) : null
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('The isolated conformance Agent exceeded its bounded turn budget.')), 30_000)
      timeout.unref?.()
    })
    await Promise.race(aborted ? [idle, deadline, aborted] : [idle, deadline])
    const sessionEvents = handle.agent.session.snapshotEvents()
    return { sessionEvents, toolExecutions, finalText: finalAssistantText(sessionEvents) }
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abortListener && options.signal) options.signal.removeEventListener('abort', abortListener)
    if (handle) {
      try { handle.agent.cancel({ kind: 'disposed' }) } catch { /* best effort */ }
      try { await handle.dispose() } catch { /* best effort */ }
    }
    await ctx.fiber.dispose()
  }
}

function conformanceResult(fingerprint: string, checkedAt: string, state: HarnessModelConformance['state'], toolCalling: HarnessModelConformance['toolCalling'], detail: string, reasoning: HarnessModelConformance['reasoning'] = 'unknown'): HarnessModelConformance {
  return { state, fingerprint, toolCalling, reasoning, checkedAt, detail: projectHarnessText(detail) }
}

/** Exact-model verification: endpoint reachability and chat alone are not Verified. */
export async function verifyToolCapableModel(options: {
  adapter: LlmAdapter
  provider: string
  model: string
  reasoningEffort?: HarnessReasoningEffort | null
  routeFingerprint?: string
  signal?: AbortSignal
}): Promise<HarnessModelConformance> {
  const checkedAt = new Date().toISOString()
  const fingerprint = `${options.provider}:${options.model}:dsh-agent-session-tool-runtime-v1:${options.routeFingerprint ?? 'default'}:${options.reasoningEffort ?? 'provider-default'}`
  try {
    const run = await runConformanceRoundTrip(options)
    const events = run.sessionEvents
    const call = events.find(event => event.type === 'tool/call' && (event.data as { name?: unknown } | undefined)?.name === NONCE_TOOL_NAME)
    if (!call) return conformanceResult(fingerprint, checkedAt, 'limited', 'unsupported', 'The exact model completed the isolated check without emitting a native Tool call.')
    const callId = String((call.data as { callId?: unknown }).callId ?? '')
    const requestedNonce = nonceFromCall(call)
    const result = callId ? toolResultFor(events, callId) : undefined
    const resultData = result?.data as { message?: unknown; error?: unknown } | undefined
    const resultText = contentFromMessage(resultData?.message)
    const resultFailed = Boolean(resultData?.error) || Boolean((resultData?.message as { content?: unknown; isError?: unknown } | undefined)?.isError)
    if (!requestedNonce || !result || resultFailed || run.toolExecutions !== 1) {
      return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'unsupported', 'The native Tool call did not complete successfully through DSH ToolRuntime.')
    }
    if (!resultText.includes(`nonce verified: ${requestedNonce}`)) {
      return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'verified', 'The DSH Tool result did not contain the nonce returned by the isolated Tool.')
    }
    if (!run.finalText || !run.finalText.includes(requestedNonce)) {
      return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'verified', 'The exact model did not naturally synthesize the nonce from the DSH Tool result.')
    }
    const reasoning = events.some(event => event.type === 'assistant/chunk' && (event.data as { chunk?: { type?: string } } | undefined)?.chunk?.type === 'reasoning-delta') ? 'supported' : 'unknown'
    return conformanceResult(fingerprint, checkedAt, 'verified', 'verified', 'Native Tool round trip verified through the exact DSH Agent, Session, ToolRuntime and model route.', reasoning)
  } catch (error) {
    if (options.signal?.aborted) throw error
    return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'unknown', error instanceof Error ? error.message : String(error))
  }
}

/** Test-only negative seam; it still uses the same Agent/Session/ToolRuntime path. */
export async function verifyToolCapableModelWithToolFailure(options: Parameters<typeof verifyToolCapableModel>[0]): Promise<HarnessModelConformance> {
  const checkedAt = new Date().toISOString()
  const fingerprint = `${options.provider}:${options.model}:dsh-agent-session-tool-runtime-v1:${options.routeFingerprint ?? 'default'}:${options.reasoningEffort ?? 'provider-default'}`
  try {
    const run = await runConformanceRoundTrip({ ...options, nonceToolBehavior: 'fail' })
    const call = run.sessionEvents.find(event => event.type === 'tool/call' && (event.data as { name?: unknown } | undefined)?.name === NONCE_TOOL_NAME)
    const result = call ? toolResultFor(run.sessionEvents, String((call.data as { callId?: unknown }).callId ?? '')) : undefined
    const failed = Boolean((result?.data as { error?: unknown } | undefined)?.error) || Boolean((result?.data as { message?: { isError?: unknown } } | undefined)?.message?.isError)
    if (failed && run.toolExecutions === 0) return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'unsupported', 'The isolated DSH ToolRuntime execution failed; the exact model cannot be Verified.')
    return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'unsupported', 'The deliberate ToolRuntime failure fixture did not produce the expected failed Tool result.')
  } catch (error) {
    if (options.signal?.aborted) throw error
    return conformanceResult(fingerprint, checkedAt, 'failed-conformance', 'unknown', error instanceof Error ? error.message : String(error))
  }
}
