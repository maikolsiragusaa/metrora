import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop'
import { LlmRuntime, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import { Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import * as SpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'

import { createMetroraHarnessAuthority } from './harness-authority.mjs'
import type { MetroraHarnessToolRegistry } from './canonical-metrora-tools.mjs'
import { MetroraLocalLlmAdapter, harnessProviderRoute } from './harness-llm-adapter.mjs'
import { MetroraToolBridge, type MetroraHarnessToolScope, type MetroraHarnessToolSource } from './harness-tool-bridge.mjs'
import {
  projectHarnessId,
  projectHarnessRuntimeEvent,
  projectHarnessText,
  type HarnessConversation,
  type HarnessConversationInput,
  type HarnessConversationMessage,
  type HarnessConversationSummary,
  type HarnessLifecycleState,
  type HarnessRuntimeId,
  type HarnessSendMessageInput,
  type HarnessSendMessageResult,
  type MetroraHarnessRuntimeEvent,
} from './harness-runtime-types.js'

export type MetroraHarnessHostOptions = {
  sessionRoot: string
  toolSource: MetroraHarnessToolSource
  toolRegistry: MetroraHarnessToolRegistry
  llmAdapter?: LlmAdapter
  llmProviders?: readonly string[]
  onEvent?: (event: MetroraHarnessRuntimeEvent) => void
}

export type HarnessHandlerEnvelope = { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }
export type HarnessHandler = (...args: any[]) => Promise<HarnessHandlerEnvelope>

type LiveConversation = {
  id: string
  runtime: HarnessRuntimeId
  model: string
  scope: MetroraHarnessToolScope
  title: string
  handle: AgentHandle
  active: boolean
  cancelRequested: boolean
  requestId?: string
  lastFailure?: { requestId: string; question: string }
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/u

function assertConversationId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) throw new Error('Harness conversation id is invalid.')
  return value
}

function assertModel(value: unknown): string {
  if (typeof value !== 'string' || !MODEL_PATTERN.test(value)) throw new Error('Harness model is invalid.')
  return value
}

function assertRuntime(value: unknown): HarnessRuntimeId {
  if (value === 'ollama' || value === 'lmstudio' || value === 'llama-server') return value
  throw new Error('Harness local runtime is invalid.')
}

function assertQuestion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new Error('Harness question is invalid.')
  return value.trim()
}

function dateText(value: unknown, fallback: number): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return new Date(numeric).toISOString()
}

function eventTime(session: Session, fallback: number): number {
  const last = session.snapshotEvents().at(-1)
  return last && typeof last.time === 'number' && Number.isFinite(last.time) ? last.time : fallback
}

function messageText(message: { role: string; content: readonly { type: string; text?: string }[] }): string {
  return message.content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('')
}

function projectedMessages(session: Session): HarnessConversationMessage[] {
  return session.deriveMessages().flatMap((message): HarnessConversationMessage[] => {
    if (message.role === 'user' && message.source.kind === 'user') {
      const text = messageText(message)
      return text ? [{ id: String(message.id), role: 'user' as const, text: projectHarnessText(text, '') }] : []
    }
    if (message.role === 'assistant') {
      const text = messageText(message)
      return text ? [{ id: String(message.id), role: 'assistant' as const, text: projectHarnessText(text) }] : []
    }
    // Tool results, system context, and DSH-private reasoning are not a
    // renderer history surface. They remain in the durable DSH log for replay.
    return []
  })
}

function summaryFromSession(session: Session, runtime: HarnessRuntimeId, model: string, title: string): HarnessConversationSummary {
  const createdAt = session.header.createdAt
  const updatedAt = eventTime(session, createdAt)
  return {
    id: String(session.id),
    title: title || 'New chat',
    createdAt: dateText(createdAt, Date.now()),
    updatedAt: dateText(updatedAt, createdAt),
    messageCount: projectedMessages(session).length,
    model,
    runtime,
  }
}

function stateForTool(name: string): HarnessLifecycleState {
  if (name === 'subagent') return 'running-agent'
  return 'reading'
}

function retryNotice() {
  return createUserMessage({
    content: [{ type: 'text', text: 'Retry the previous failed request using the existing user request. Do not ask the user to repeat it.' }],
    source: {
      kind: 'plugin',
      plugin: 'metrora-harness',
      form: 'notice',
      summary: 'Retrying the previous failed request',
    },
  })
}

function lastFailedTurnQuestion(session: Session): string | null {
  const events = session.snapshotEvents()
  for (let endIndex = events.length - 1; endIndex >= 0; endIndex -= 1) {
    const end = events[endIndex]
    if (end.type !== 'turn/end' || end.data.reason.kind !== 'error') continue
    for (let startIndex = endIndex - 1; startIndex >= 0; startIndex -= 1) {
      const start = events[startIndex]
      if (start.type !== 'turn/start' || start.data.turn !== end.data.turn) continue
      for (let eventIndex = startIndex + 1; eventIndex < endIndex; eventIndex += 1) {
        const event = events[eventIndex]
        if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
        const text = messageText(event.data)
        if (text) return text
      }
      break
    }
  }
  return null
}

/**
 * Metrora-owned runtime adapter around the DSH substrate. This is an
 * orchestration boundary, not a second Agent/Session engine: durable state,
 * loop driving, tool dispatch, replay and cancellation all come from DSH.
 */
export class MetroraHarnessHost {
  private readonly options: MetroraHarnessHostOptions
  private readonly live = new Map<string, LiveConversation>()
  private readonly authority = createMetroraHarnessAuthority()
  private readonly ready: Promise<void>
  private ctx: Context | null = null
  private toolBridge: MetroraToolBridge | null = null
  private llmRegistration: (() => void) | null = null
  private shuttingDown = false

  constructor(options: MetroraHarnessHostOptions) {
    this.options = {
      ...options,
      sessionRoot: path.resolve(options.sessionRoot),
    }
    this.ready = this.start()
    // IPC callers receive the safe error envelope from `handlers()`. Keep a
    // failed lazy startup from becoming an unhandled rejection when no caller
    // has awaited the first operation yet.
    void this.ready.catch(() => {})
  }

  async listConversations(): Promise<HarnessConversationSummary[]> {
    await this.ready
    const persistence = this.requireContext().sessionPersistence
    const headers = await persistence.list()
    const conversations: HarnessConversationSummary[] = []
    for (const header of headers) {
      const live = this.live.get(String(header.id))
      if (live) {
        conversations.push(summaryFromSession(live.handle.agent.session, live.runtime, live.model, live.title))
        continue
      }
      try {
        const inspection = await persistence.inspect(header.id)
        const session = Session.fromRestore(header.id, inspection.events, inspection.meta, inspection.inheritedEventCount)
        conversations.push(summaryFromSession(session, this.runtimeForSession(session), this.modelForSession(session), 'New chat'))
      } catch {
        // A corrupt/foreign log is not surfaced as a raw storage error to the
        // renderer. The durable backend remains the source of truth and the
        // next explicit resume reports the safe failure envelope.
      }
    }
    return conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async getConversation(conversationId: string): Promise<HarnessConversation | null> {
    await this.ready
    const id = assertConversationId(conversationId)
    const live = this.live.get(id)
    if (live) return this.conversationFromSession(live.handle.agent.session, live.runtime, live.model, live.title)
    try {
      const inspection = await this.requireContext().sessionPersistence.inspect(SessionId(id))
      const session = Session.fromRestore(SessionId(id), inspection.events, inspection.meta, inspection.inheritedEventCount)
      return this.conversationFromSession(session, this.runtimeForSession(session), this.modelForSession(session), 'New chat')
    } catch {
      return null
    }
  }

  async createConversation(input: HarnessConversationInput): Promise<HarnessConversation> {
    await this.ready
    const normalized = this.normalizeConversationInput(input)
    const id = normalized.conversationId ?? `metrora-${randomUUID()}`
    if (this.live.has(id)) return this.getConversation(id) as Promise<HarnessConversation>
    const existing = await this.getConversation(id)
    if (existing) return existing
    const live = await this.createLiveConversation(id, normalized.runtime, normalized.model, normalized.scope, 'New chat')
    await this.requireContext().sessionPersistence.ensureMaterialized(live.handle.agent.session)
    return this.conversationFromSession(live.handle.agent.session, live.runtime, live.model, live.title)
  }

  async sendMessage(input: HarnessSendMessageInput): Promise<HarnessSendMessageResult> {
    await this.ready
    if (this.shuttingDown) throw new Error('Metrora Harness is shutting down.')
    const question = assertQuestion(input.question)
    const normalized = this.normalizeConversationInput(input)
    const id = normalized.conversationId ?? `metrora-${randomUUID()}`
    const retryRequestId = input.retryRequestId ? projectHarnessId(input.retryRequestId) : undefined
    const requestId = input.requestId ? projectHarnessId(input.requestId) : undefined
    let live = this.live.get(id)
    if (!live) {
      const existing = await this.getConversation(id)
      live = existing
        ? await this.resumeLiveConversation(id, normalized.runtime, normalized.model, normalized.scope, existing.title)
        : await this.createLiveConversation(id, normalized.runtime, normalized.model, normalized.scope, 'New chat')
    }
    if (live.active) throw new Error('Metrora Harness already has an active turn for this conversation.')
    if (retryRequestId) {
      const failedQuestion = live.lastFailure?.requestId === retryRequestId
        ? live.lastFailure.question
        : lastFailedTurnQuestion(live.handle.agent.session)
      if (!failedQuestion || failedQuestion !== question) throw new Error('Metrora Harness retry identity is stale or does not match the failed turn.')
    }
    live.scope = normalized.scope
    live.runtime = normalized.runtime
    live.model = normalized.model
    live.requestId = requestId
    live.cancelRequested = false
    live.active = true
    this.toolBridge?.setScope(id, normalized.scope)
    this.emit(id, 'thinking')
    try {
      live.handle.agent.followup(retryRequestId ? retryNotice() : createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
      await live.handle.agent.whenIdle()
      await this.requireContext().sessions.flush(live.handle.agent.session)
      const messages = projectedMessages(live.handle.agent.session)
      const message = [...messages].reverse().find(candidate => candidate.role === 'assistant')
      if (!message) {
        if (live.cancelRequested) throw this.cancellationError()
        throw new Error('Harness completed without an assistant response.')
      }
      live.title = live.title === 'New chat' ? question.slice(0, 42) : live.title
      live.lastFailure = undefined
      this.emit(id, 'preparing')
      this.emit(id, 'done')
      return { conversationId: id, message, runtime: live.runtime, model: live.model }
    } catch (error) {
      if (live.cancelRequested || this.isCancellation(error)) this.emit(id, 'cancelled')
      else {
        live.lastFailure = {
          requestId: retryRequestId ?? requestId ?? `turn-${live.handle.agent.session.snapshotEvents().length}`,
          question,
        }
        this.emit(id, 'failed')
      }
      throw error
    } finally {
      try { await this.requireContext().sessions.flush(live.handle.agent.session) } catch { /* preserve the primary turn result */ }
      live.active = false
      live.cancelRequested = false
      live.requestId = undefined
    }
  }

  async cancelConversation(conversationId: string): Promise<boolean> {
    await this.ready
    const id = assertConversationId(conversationId)
    const live = this.live.get(id)
    if (!live || !live.active) return false
    live.cancelRequested = true
    live.handle.agent.cancel({ kind: 'user' })
    return true
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    await this.ready.catch(() => {})
    for (const live of [...this.live.values()]) {
      try { live.handle.agent.cancel({ kind: 'disposed' }) } catch { /* best effort */ }
      try { await live.handle.dispose() } catch { /* best effort */ }
    }
    this.live.clear()
    this.toolBridge?.dispose()
    this.llmRegistration?.()
    if (this.ctx) await this.ctx.fiber.dispose()
    this.ctx = null
  }

  /** IPC-ready handlers; errors are already content-minimal envelopes. */
  handlers(): Record<string, HarnessHandler> {
    const safe = (run: (...args: any[]) => Promise<unknown>): HarnessHandler => async (...args) => {
      try { return { ok: true, value: await run(...args) } }
      catch (error) { return { ok: false, error: { kind: 'harness-runtime', message: projectHarnessText(error instanceof Error ? error.message : String(error)) } } }
    }
    return {
      'metrora:harnessListConversations': safe(() => this.listConversations()),
      'metrora:harnessGetConversation': safe((id: string) => this.getConversation(id)),
      'metrora:harnessCreateConversation': safe((input: HarnessConversationInput) => this.createConversation(input)),
      'metrora:harnessSendMessage': safe((input: HarnessSendMessageInput) => this.sendMessage(input)),
      'metrora:harnessCancel': safe((id: string) => this.cancelConversation(id)),
    }
  }

  private async start(): Promise<void> {
    await mkdir(this.options.sessionRoot, { recursive: true })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(JsonlSessionPersistence, { root: this.options.sessionRoot, compression: 'none', packChunks: true })
    await ctx.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: 'You are the Metrora Harness assistant. Use canonical Metrora read tools for factual answers. Never claim an unavailable or unobserved fact.',
    })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    // Recovery and compaction are DSH-owned durable mechanics. The adapter
    // supplies route policy/capacity; Metrora only projects their safe state.
    await ctx.plugin(LlmRetry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, {
      auto: true,
      thresholdRatio: 0.8,
      retainRatio: 0.16,
      maxTokens: 8_192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
    })

    // P1 mounts only the DSH orchestration substrate and bounded in-process
    // delegation. Filesystem/process/mutation packages are intentionally not
    // mounted until Metrora owns an explicit Workspace root and ACT contract.
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SpawnInProcess, { providerName: 'spawn' })

    const adapter = this.options.llmAdapter ?? new MetroraLocalLlmAdapter()
    const providers = [...(this.options.llmProviders ?? (['ollama', 'lmstudio', 'llama-server'] as const)).map(value => value.includes('metrora-local-') ? value : harnessProviderRoute(value as HarnessRuntimeId))]
    this.llmRegistration = ctx.llm.registerAdapter(providers, adapter)
    await ctx.plugin(AgentLoop, { maxParallelToolCalls: 4, agents: [] })
    await ctx.plugin(ToolSubagent, {
      provider: 'spawn',
      enableRunInBackground: false,
      maxDepth: 1,
      // Child agents inherit the parent route. The filter keeps delegation
      // bounded to factual reads; mutation/process tools remain unavailable
      // even if a child asks for them.
      toolFilter: {
        allow: [
          'subagent',
          'get_spend_snapshot', 'get_model_efficiency', 'get_quota_snapshot',
          'get_overview_snapshot', 'get_project_drivers', 'get_session_highlights',
          'get_coverage_report', 'get_bench_evidence',
        ],
      },
    })

    this.toolBridge = new MetroraToolBridge(this.options.toolSource, this.options.toolRegistry)
    this.toolBridge.register(ctx)
    ctx.on('tools/pre-execute', async execution => this.authority.decide(execution))
    ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
    ctx.on('agent/status', ({ agent, status }) => {
      const live = this.live.get(String(agent.id))
      if (!live || !live.active) return
      if (status === 'running') this.emit(live.id, 'thinking')
      else this.emit(live.id, 'preparing')
    })
    ctx.on('agent/created', ({ agent }) => {
      // DSH's supported request waterfall is the authoritative per-request
      // switch. It preserves the same Session while causing prepareCall and
      // GenerateOptions to use the current Metrora-selected route/model.
      agent.ctx.on('agent/request', async (_payload, next) => {
        const config = await next()
        const live = this.live.get(String(agent.id))
        return live
          ? { ...config, provider: harnessProviderRoute(live.runtime), model: live.model }
          : config
      })
    })
    this.ctx = ctx
  }

  private onSessionEvent(session: Session, event: SessionEvent): void {
    const live = this.live.get(String(session.id))
    if (!live || !live.active) return
    if (event.type === 'tool/call') this.emit(live.id, stateForTool(event.data.name))
    else if (event.type === 'turn/end') this.emit(live.id, 'preparing')
  }

  private async createLiveConversation(id: string, runtime: HarnessRuntimeId, model: string, scope: MetroraHarnessToolScope, title: string): Promise<LiveConversation> {
    const context = this.requireContext()
    const agent = await context.agents.create({
      sessionId: SessionId(id),
      agentOptions: { provider: harnessProviderRoute(runtime), model },
    })
    const live: LiveConversation = { id, runtime, model, scope, title, handle: agent, active: false, cancelRequested: false }
    this.live.set(id, live)
    this.toolBridge?.setScope(id, scope)
    return live
  }

  private async resumeLiveConversation(id: string, runtime: HarnessRuntimeId, model: string, scope: MetroraHarnessToolScope, title: string): Promise<LiveConversation> {
    const handle = await this.requireContext().agents.resume({
      resumeSessionId: SessionId(id),
      agentOptions: { provider: harnessProviderRoute(runtime), model },
    })
    const live: LiveConversation = { id, runtime, model, scope, title, handle, active: false, cancelRequested: false }
    this.live.set(id, live)
    this.toolBridge?.setScope(id, scope)
    return live
  }

  private normalizeConversationInput(input: HarnessConversationInput): { conversationId?: string; runtime: HarnessRuntimeId; model: string; scope: MetroraHarnessToolScope } {
    if (!input || typeof input !== 'object') throw new Error('Harness conversation input is invalid.')
    return {
      ...(input.conversationId !== undefined ? { conversationId: assertConversationId(input.conversationId) } : {}),
      runtime: assertRuntime(input.runtime),
      model: assertModel(input.model),
      scope: input.scope,
    }
  }

  private conversationFromSession(session: Session, runtime: HarnessRuntimeId, model: string, title: string): HarnessConversation {
    return { ...summaryFromSession(session, runtime, model, title), messages: projectedMessages(session) }
  }

  private modelForSession(session: Session): string {
    const header = session.requestHeader()
    const model = header?.config.model
    if (typeof model === 'string' && MODEL_PATTERN.test(model)) return model
    return 'local'
  }

  private runtimeForSession(session: Session): HarnessRuntimeId {
    // DSH stores provider route identity in the request header. The fallback is
    // the default local route and remains replaceable on an explicit resume.
    const provider = session.requestHeader()?.config.provider
    if (provider === harnessProviderRoute('lmstudio')) return 'lmstudio'
    if (provider === harnessProviderRoute('llama-server')) return 'llama-server'
    return 'ollama'
  }

  private requireContext(): Context & { sessions: SessionStore; agents: AgentRegistry; sessionPersistence: JsonlSessionPersistence; llm: LlmRuntime; tools: ToolRuntime } {
    if (!this.ctx) throw new Error('Metrora Harness is not ready.')
    return this.ctx as Context & { sessions: SessionStore; agents: AgentRegistry; sessionPersistence: JsonlSessionPersistence; llm: LlmRuntime; tools: ToolRuntime }
  }

  private emit(conversationId: string, state: HarnessLifecycleState): void {
    this.options.onEvent?.(projectHarnessRuntimeEvent({
      conversationId,
      state,
      ...(this.live.get(conversationId)?.requestId ? { requestId: this.live.get(conversationId)!.requestId } : {}),
    }))
  }

  private isCancellation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError') || /cancel|abort/i.test(error instanceof Error ? error.message : String(error))
  }

  private cancellationError(): Error {
    const error = new Error('Metrora Harness request cancelled.')
    error.name = 'AbortError'
    return error
  }
}

export function removeHarnessSessionArtifact(sessionRoot: string, header: SessionHeader): Promise<void> {
  // Kept as a narrow host-owned utility for future “remove conversation” UI:
  // callers must resolve the exact DSH JSONL location and validate containment
  // before invoking it. The current public surface intentionally has no delete
  // affordance, so normal conversation history remains recoverable.
  const root = path.resolve(sessionRoot)
  const candidate = path.resolve(root, String(header.id))
  if (!candidate.startsWith(root + path.sep)) return Promise.reject(new Error('Harness session artifact is outside the session root.'))
  return rm(candidate, { force: true })
}
