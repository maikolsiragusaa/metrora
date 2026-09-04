import { randomBytes } from 'node:crypto'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  Agent,
  Config,
  Message,
  Model,
  OpencodeClient,
  OpencodeClientConfig,
  Part,
  Provider,
  Session,
} from '@opencode-ai/sdk' with { "resolution-mode": "import" }

import {
  OPENCODE_COMMIT,
  OPENCODE_CUSTOM_TOOL_ID,
  OPENCODE_VERSION,
  type OpenCodeAgent,
  type OpenCodeConversationMessage,
  type OpenCodeConversationPart,
  type OpenCodeEngineState,
  type OpenCodeEngineStatus,
  type OpenCodeLocalProviderConfig,
  type OpenCodeMcpServer,
  type OpenCodeModel,
  type OpenCodeModelRef,
  type OpenCodeProvider,
  type OpenCodePromptRequest,
  type OpenCodeRendererEvent,
  type OpenCodeSession,
  type OpenCodeTools,
  type OpenCodeWorkspaceInfo,
} from './opencode-types'
import { OPENCODE_USAGE_TOOL_SOURCE } from './opencode-tool'

const LOOPBACK_HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 12_000
const HEALTH_POLL_MS = 100
const STOP_TIMEOUT_MS = 1_500
const MAX_TEXT = 100_000
const MAX_RENDERER_TEXT = 4_000
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u

type ChildLike = Pick<ChildProcess, 'stdout' | 'stderr' | 'pid' | 'once' | 'kill'>
type SpawnProcess = (file: string, args: string[], options: SpawnOptions) => ChildLike
type FetchImpl = typeof fetch
type ClientConfig = OpencodeClientConfig & { directory?: string }
type ClientFactory = (config: ClientConfig) => OpencodeClient

export type OpenCodeRuntimeOptions = {
  appPath: string
  resourcesPath: string
  userDataPath: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  arch?: string
  workspacePath?: string | null
  executableOverride?: string | null
  spawnProcess?: SpawnProcess
  fetchImpl?: FetchImpl
  createClient?: ClientFactory
  now?: () => number
  readUsageSnapshot?: () => Promise<unknown>
  acquirePort?: () => Promise<number>
}

type LocalProviderState = OpenCodeLocalProviderConfig

export class OpenCodeError extends Error {
  constructor(public readonly kind: string, message: string) {
    super(message)
    this.name = 'OpenCodeError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new OpenCodeError('bad-args', `${label} is invalid`)
  return value
}

function safeOptionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return safeId(value, label)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function clampText(value: string, max = MAX_RENDERER_TEXT): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/giu, '[redacted]')
    .replace(/(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|\b(?:file|vscode-file):\/\/[^\s"'<>|]+)/giu, '[redacted]')
    .replace(/(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)|source[_ -]?(?:code|snippet|content))(?![\p{L}\p{N}])/giu, '[redacted]')
    .slice(0, max)
}

export function redactOpenCodeText(value: unknown, max = MAX_RENDERER_TEXT): string {
  return clampText(safeString(value), max)
}

const SNAPSHOT_SECRET_KEY = /(?:api.?key|access.?token|auth|credential|password|secret|private.?key|authorization|bearer)/iu
const SNAPSHOT_PATH_KEY = /^(?:path|directory|cwd|root|worktree|config|state)$/iu

function redactSnapshotValue(value: unknown, key = ''): unknown {
  if (SNAPSHOT_SECRET_KEY.test(key) || SNAPSHOT_PATH_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return clampText(value, 1_000)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactSnapshotValue(item))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, redactSnapshotValue(childValue, childKey)]))
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  return undefined
}

export function projectMetroraUsageSnapshot(value: unknown, generatedAt = new Date().toISOString()): Record<string, unknown> {
  return {
    schemaVersion: 'metrora.usage-snapshot.v1',
    generatedAt,
    source: 'Metrora canonical status snapshot',
    data: redactSnapshotValue(value),
  }
}

function relativeFile(workspace: string | null, value: unknown): string {
  const raw = safeString(value, 'file')
  if (!workspace || !path.isAbsolute(raw)) return clampText(raw, 240)
  const relative = path.relative(workspace, raw)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '[outside workspace]'
  return clampText(relative.replaceAll('\\', '/'), 240)
}

function pickVariants(model: Model | Record<string, unknown>): Array<{ id: string; label: string }> {
  const variants = (model as Record<string, unknown>).variants
  if (!isRecord(variants)) return []
  return Object.keys(variants).filter(key => SAFE_ID.test(key)).map(id => ({ id, label: id }))
}

function projectModel(providerID: string, modelID: string, value: Model | Record<string, unknown>): OpenCodeModel {
  const model = value as Record<string, unknown>
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {}
  return {
    id: modelID,
    providerID,
    name: safeString(model.name, modelID).slice(0, 200),
    reasoning: Boolean(model.reasoning ?? capabilities.reasoning),
    toolCall: Boolean(model.tool_call ?? capabilities.toolcall),
    variants: pickVariants(value),
  }
}

function projectProvider(value: Provider | Record<string, unknown>, connected: Set<string>): OpenCodeProvider {
  const provider = value as Record<string, unknown>
  const id = safeString(provider.id, 'provider').slice(0, 120)
  const models = isRecord(provider.models) ? provider.models : {}
  return {
    id,
    name: safeString(provider.name, id).slice(0, 200),
    source: safeString(provider.source, 'unknown').slice(0, 80),
    connected: connected.has(id),
    models: Object.entries(models).map(([modelID, model]) => projectModel(id, modelID, model as Record<string, unknown>)),
  }
}

function projectAgent(value: Agent | Record<string, unknown>): OpenCodeAgent {
  const agent = value as Record<string, unknown>
  const permission = isRecord(agent.permission) ? agent.permission : {}
  const model = isRecord(agent.model) ? agent.model : null
  return {
    name: safeString(agent.name, 'agent').slice(0, 120),
    description: typeof agent.description === 'string' ? clampText(agent.description, 500) : null,
    mode: agent.mode === 'subagent' || agent.mode === 'primary' || agent.mode === 'all' ? agent.mode : 'all',
    builtIn: Boolean(agent.builtIn),
    model: model && typeof model.providerID === 'string' && typeof model.modelID === 'string'
      ? { providerID: model.providerID, modelID: model.modelID }
      : null,
    permission: { edit: safeString(permission.edit, 'ask'), bash: safeString(permission.bash, 'ask') },
  }
}

function projectSession(value: Session | Record<string, unknown>): OpenCodeSession {
  const session = value as Record<string, unknown>
  const time = isRecord(session.time) ? session.time : {}
  return {
    id: safeString(session.id),
    title: clampText(safeString(session.title, 'Untitled session'), 240),
    directory: safeString(session.directory),
    parentID: typeof session.parentID === 'string' ? session.parentID : null,
    createdAt: typeof time.created === 'number' ? time.created : 0,
    updatedAt: typeof time.updated === 'number' ? time.updated : 0,
  }
}

function projectPart(value: Part | Record<string, unknown>, workspace: string | null): OpenCodeConversationPart | null {
  const part = value as Record<string, unknown>
  const id = safeString(part.id, 'part')
  const type = safeString(part.type)
  if (type === 'text' || type === 'reasoning') return { id, type, text: redactOpenCodeText(part.text, MAX_RENDERER_TEXT) }
  if (type === 'tool') {
    const state = isRecord(part.state) ? part.state : {}
    const status = safeString(state.status, 'unknown')
    return {
      id,
      type: 'tool',
      tool: clampText(safeString(part.tool, 'tool'), 120),
      status,
      title: typeof state.title === 'string' ? clampText(state.title, 240) : undefined,
      output: status === 'completed' ? redactOpenCodeText(state.output, 2_000) : undefined,
    }
  }
  if (type === 'subtask') return { id, type: 'subtask', name: clampText(safeString(part.agent, 'subagent'), 120), text: clampText(safeString(part.description), 500) }
  if (type === 'agent') return { id, type: 'agent', name: clampText(safeString(part.name, 'agent'), 120) }
  if (type === 'file') return { id, type: 'file', text: relativeFile(workspace, part.filename ?? (isRecord(part.source) ? part.source.path : undefined)) }
  if (type === 'patch') {
    const files = Array.isArray(part.files) ? part.files.map(file => relativeFile(workspace, file)).slice(0, 50) : []
    return { id, type: 'patch', files }
  }
  if (type === 'step-start' || type === 'step-finish' || type === 'compaction') return { id, type: 'step', text: type }
  if (type === 'retry') return { id, type: 'retry', text: 'OpenCode retrying the provider request.' }
  return null
}

function messageText(parts: OpenCodeConversationPart[]): string {
  return parts.filter(part => part.type === 'text' || part.type === 'reasoning').map(part => part.text ?? '').filter(Boolean).join('\n\n')
}

function projectMessage(value: { info: Message | Record<string, unknown>; parts: Array<Part | Record<string, unknown>> }, workspace: string | null): OpenCodeConversationMessage {
  const info = value.info as Record<string, unknown>
  const time = isRecord(info.time) ? info.time : {}
  const parts = value.parts.map(part => projectPart(part, workspace)).filter((part): part is OpenCodeConversationPart => Boolean(part))
  const model = isRecord(info.model)
    ? { providerID: safeString(info.model.providerID), modelID: safeString(info.model.modelID) }
    : typeof info.providerID === 'string' && typeof info.modelID === 'string'
      ? { providerID: info.providerID, modelID: info.modelID }
      : null
  const tokens = isRecord(info.tokens) ? info.tokens : null
  return {
    id: safeString(info.id),
    role: info.role === 'user' ? 'user' : 'assistant',
    createdAt: typeof time.created === 'number' ? time.created : 0,
    text: messageText(parts),
    model,
    agent: typeof info.agent === 'string' ? clampText(info.agent, 120) : typeof info.mode === 'string' ? clampText(info.mode, 120) : null,
    cost: typeof info.cost === 'number' ? info.cost : null,
    tokens: tokens && typeof tokens.input === 'number' && typeof tokens.output === 'number'
      ? { input: tokens.input, output: tokens.output, reasoning: typeof tokens.reasoning === 'number' ? tokens.reasoning : 0 }
      : null,
    parts,
  }
}

function eventSessionId(properties: Record<string, unknown>): string | null {
  return typeof properties.sessionID === 'string' ? properties.sessionID : null
}

function projectEvent(value: unknown, workspace: string | null): OpenCodeRendererEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const properties = isRecord(value.properties) ? value.properties : {}
  const info = isRecord(properties.info) ? properties.info : {}
  const sessionId = eventSessionId(properties) ?? (typeof info.sessionID === 'string' ? info.sessionID : null)
  switch (value.type) {
    case 'message.part.updated': {
      const part = isRecord(properties.part) ? properties.part : {}
      if (!sessionId || typeof part.id !== 'string') return null
      if ((part.type === 'text' || part.type === 'reasoning') && typeof properties.delta === 'string') {
        return { kind: 'message-delta', sessionId, messageId: safeString(part.messageID), partId: part.id, text: redactOpenCodeText(properties.delta) }
      }
      if (part.type === 'tool') {
        const state = isRecord(part.state) ? part.state : {}
        return { kind: 'tool', sessionId, messageId: safeString(part.messageID), partId: part.id, tool: clampText(safeString(part.tool, 'tool'), 120), status: safeString(state.status, 'unknown'), title: typeof state.title === 'string' ? clampText(state.title, 240) : null }
      }
      if (part.type === 'agent') return { kind: 'agent', sessionId, messageId: safeString(part.messageID), partId: part.id, name: clampText(safeString(part.name, 'agent'), 120), description: typeof part.description === 'string' ? clampText(part.description, 500) : null }
      return null
    }
    case 'message.updated': {
      if (!sessionId || typeof info.id !== 'string') return null
      return { kind: 'message-updated', sessionId, messageId: info.id, role: info.role === 'user' ? 'user' : 'assistant', finished: typeof info.time === 'object' && Boolean((info.time as Record<string, unknown>)?.completed) }
    }
    case 'session.status':
      return sessionId ? { kind: 'session-status', sessionId, status: isRecord(properties.status) ? safeString(properties.status.type, 'unknown') : 'unknown' } : null
    case 'session.idle':
      return sessionId ? { kind: 'session-status', sessionId, status: 'idle' } : null
    case 'permission.updated':
      return sessionId && typeof properties.id === 'string'
        ? { kind: 'permission', sessionId, permissionId: properties.id, type: clampText(safeString(properties.type, 'permission'), 100), title: clampText(safeString(properties.title, 'OpenCode permission request'), 300), pattern: properties.pattern === undefined ? null : redactOpenCodeText(Array.isArray(properties.pattern) ? properties.pattern.join(', ') : properties.pattern, 300) }
        : null
    case 'file.edited':
      return { kind: 'file-edited', sessionId, file: relativeFile(workspace, properties.file) }
    case 'todo.updated': {
      if (!sessionId) return null
      const todos = Array.isArray(properties.todos) ? properties.todos : []
      const counts = todos.reduce((result, todo) => {
        const status = isRecord(todo) ? safeString(todo.status) : ''
        if (status === 'in_progress') result.inProgress++
        else if (status === 'completed') result.completed++
        else result.pending++
        return result
      }, { pending: 0, inProgress: 0, completed: 0 })
      return { kind: 'todo', sessionId, ...counts }
    }
    case 'session.diff': {
      if (!sessionId) return null
      const diff = Array.isArray(properties.diff) ? properties.diff : []
      return {
        kind: 'diff',
        sessionId,
        files: diff.length,
        additions: diff.reduce((sum, file) => sum + (isRecord(file) && typeof file.additions === 'number' ? file.additions : 0), 0),
        deletions: diff.reduce((sum, file) => sum + (isRecord(file) && typeof file.deletions === 'number' ? file.deletions : 0), 0),
      }
    }
    case 'vcs.branch.updated':
      return { kind: 'vcs', branch: typeof properties.branch === 'string' ? clampText(properties.branch, 200) : null }
    case 'session.error': {
      const error = isRecord(properties.error) ? properties.error : {}
      const data = isRecord(error.data) ? error.data : {}
      return { kind: 'error', sessionId, message: clampText(safeString(data.message, safeString(error.name, 'OpenCode session error')), 1_000) }
    }
    default:
      return null
  }
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'opencode.exe' : 'opencode'
}

export function resolveOpenCodeExecutable(options: Pick<OpenCodeRuntimeOptions, 'appPath' | 'resourcesPath' | 'isPackaged' | 'platform' | 'arch' | 'executableOverride'>): string | null {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const name = executableName(platform)
  const override = options.executableOverride ?? process.env.METRORA_OPENCODE_BIN
  const candidates = override
    ? [override]
    : [
        path.join(options.resourcesPath, 'opencode', OPENCODE_VERSION, `${platform}-${arch}`, name),
        path.join(options.appPath, 'build', 'opencode', OPENCODE_VERSION, `${platform}-${arch}`, name),
      ]
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue
    try {
      const result = statSync(candidate)
      if (result.isFile()) return candidate
    } catch { /* staged binary is optional in source checkouts */ }
  }
  return null
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function asConfig(value: Record<string, unknown>): Config {
  return value as Config
}

function localProviderConfig(state: LocalProviderState): Record<string, unknown> {
  return {
    'llama.cpp': {
      npm: '@ai-sdk/openai-compatible',
      name: 'llama-server (local)',
      options: { baseURL: `http://${LOOPBACK_HOST}:${state.port}/v1` },
      models: {
        [state.modelId]: {
          name: `${state.modelId} (local)`,
          limit: { context: 128_000, output: 65_536 },
        },
      },
    },
  }
}

async function isDirectory(value: string): Promise<boolean> {
  try { return (await stat(value)).isDirectory() } catch { return false }
}

async function freeLoopbackPort(): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

export class OpenCodeEngine {
  private readonly options: OpenCodeRuntimeOptions
  private readonly spawnProcess: SpawnProcess
  private readonly fetchImpl: FetchImpl
  private readonly createClient: ClientFactory | null
  private readonly now: () => number
  private readonly listeners = new Set<(event: OpenCodeRendererEvent) => void>()
  private state: OpenCodeEngineState = 'idle'
  private detail: string | null = null
  private customToolRegistered: boolean | null = null
  private child: ChildLike | null = null
  private client: OpencodeClient | null = null
  private eventAbort: AbortController | null = null
  private startupAbort: AbortController | null = null
  private startPromise: Promise<OpenCodeEngineStatus> | null = null
  private workspacePath: string | null
  private localProvider: LocalProviderState | null = null
  private readonly runtimeDir: string
  private readonly configPath: string
  private readonly snapshotPath: string
  private readonly localProviderPath: string
  private readonly flights = new Map<string, AbortController>()

  constructor(options: OpenCodeRuntimeOptions) {
    this.options = options
    this.spawnProcess = options.spawnProcess ?? ((file, args, spawnOptions) => nodeSpawn(file, args, spawnOptions))
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.createClient = options.createClient ?? null
    this.now = options.now ?? (() => Date.now())
    this.workspacePath = options.workspacePath ?? null
    this.runtimeDir = path.join(options.userDataPath, 'opencode-engine', OPENCODE_VERSION)
    this.configPath = path.join(this.runtimeDir, 'opencode.json')
    this.snapshotPath = path.join(this.runtimeDir, 'metrora-usage-snapshot.json')
    this.localProviderPath = path.join(this.runtimeDir, 'local-provider.json')
  }

  onEvent(listener: (event: OpenCodeRendererEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(): OpenCodeEngineStatus {
    return {
      state: this.state,
      version: OPENCODE_VERSION,
      commit: OPENCODE_COMMIT,
      workspace: this.workspacePath,
      customToolRegistered: this.customToolRegistered,
      detail: this.detail,
      acpAvailable: this.child !== null,
    }
  }

  async setWorkspace(value: unknown): Promise<OpenCodeEngineStatus> {
    if (typeof value !== 'string' || !path.isAbsolute(value) || !(await isDirectory(value))) throw new OpenCodeError('bad-args', 'OpenCode workspace must be an existing directory')
    this.workspacePath = path.normalize(value)
    return this.status()
  }

  async start(): Promise<OpenCodeEngineStatus> {
    if (this.state === 'ready') return this.status()
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async restart(): Promise<OpenCodeEngineStatus> {
    await this.stop()
    return this.start()
  }

  async stop(): Promise<void> {
    this.startupAbort?.abort()
    if (this.startPromise) {
      try { await this.startPromise } catch { /* stop the child if startup got as far as spawning it */ }
    }
    if (!this.child && this.state === 'idle') return
    this.state = 'stopping'
    this.eventAbort?.abort()
    this.eventAbort = null
    for (const controller of this.flights.values()) controller.abort()
    this.flights.clear()
    this.client = null
    const child = this.child
    this.child = null
    if (child) {
      await new Promise<void>(resolve => {
        let settled = false
        const finish = () => { if (!settled) { settled = true; resolve() } }
        child.once('exit', finish)
        try { child.kill() } catch { finish() }
        setTimeout(finish, STOP_TIMEOUT_MS)
      })
    }
    this.state = 'idle'
    this.detail = null
    this.customToolRegistered = null
  }

  async configureLocalProvider(input: unknown): Promise<OpenCodeEngineStatus> {
    if (!isRecord(input)) throw new OpenCodeError('bad-args', 'Local provider configuration is invalid')
    const port = typeof input.port === 'number' ? input.port : NaN
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new OpenCodeError('bad-args', 'Local provider port is invalid')
    const modelId = safeId(input.modelId, 'Local provider model id')
    this.localProvider = { port, modelId }
    await mkdir(this.runtimeDir, { recursive: true })
    await writeFile(this.localProviderPath, JSON.stringify(this.localProvider, null, 2), 'utf8')
    return this.restart()
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const client = await this.requireClient()
    const data = await this.call(() => client.session.list({ query: this.directoryQuery(), throwOnError: true }))
    return (data as Array<Session | Record<string, unknown>>).map(projectSession)
  }

  async createSession(title?: unknown): Promise<OpenCodeSession> {
    const client = await this.requireClient()
    const value = typeof title === 'string' && title.trim() ? clampText(title.trim(), 200) : undefined
    const data = await this.call(() => client.session.create({ query: this.requiredDirectoryQuery(), body: value ? { title: value } : undefined, throwOnError: true }))
    return projectSession(data as Session)
  }

  async getMessages(sessionIdValue: unknown): Promise<OpenCodeConversationMessage[]> {
    const sessionId = safeId(sessionIdValue, 'OpenCode session id')
    const client = await this.requireClient()
    const data = await this.call(() => client.session.messages({ path: { id: sessionId }, query: this.requiredDirectoryQuery(), throwOnError: true }))
    return (data as Array<{ info: Message | Record<string, unknown>; parts: Array<Part | Record<string, unknown>> }>).map(value => projectMessage(value, this.workspacePath))
  }

  async prompt(input: unknown): Promise<OpenCodeConversationMessage | null> {
    if (!isRecord(input)) throw new OpenCodeError('bad-args', 'OpenCode prompt is invalid')
    const request: OpenCodePromptRequest = {
      requestId: safeId(input.requestId, 'OpenCode request id'),
      sessionId: safeId(input.sessionId, 'OpenCode session id'),
      text: typeof input.text === 'string' ? input.text : '',
      ...(input.model ? { model: this.modelRef(input.model) } : {}),
      ...(safeOptionalId(input.agent, 'OpenCode agent') ? { agent: safeOptionalId(input.agent, 'OpenCode agent') } : {}),
      ...(safeOptionalId(input.variant, 'OpenCode variant') ? { variant: safeOptionalId(input.variant, 'OpenCode variant') } : {}),
    }
    if (!request.text.trim() || request.text.length > MAX_TEXT) throw new OpenCodeError('bad-args', 'OpenCode prompt text is empty or too long')
    if (this.flights.has(request.requestId)) throw new OpenCodeError('request-in-flight', 'OpenCode request is already running')
    await this.refreshUsageSnapshot()
    const client = await this.requireClient()
    const controller = new AbortController()
    this.flights.set(request.requestId, controller)
    try {
      const body: Record<string, unknown> = {
        parts: [{ type: 'text', text: request.text }],
        ...(request.model ? { model: request.model } : {}),
        ...(request.agent ? { agent: request.agent } : {}),
        // v1.18.27 accepts variant at runtime although the generated v1 SDK
        // declaration predates this field. It is passed through unchanged.
        ...(request.variant ? { variant: request.variant } : {}),
      }
      const data = await this.call(() => client.session.prompt({
        path: { id: request.sessionId },
        query: this.requiredDirectoryQuery(),
        body,
        signal: controller.signal,
        throwOnError: true,
      } as never))
      const result = data as { info: Message | Record<string, unknown>; parts: Array<Part | Record<string, unknown>> }
      return projectMessage(result, this.workspacePath)
    } catch (error) {
      if (controller.signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode request cancelled')
      throw error
    } finally {
      if (this.flights.get(request.requestId) === controller) this.flights.delete(request.requestId)
    }
  }

  async cancel(requestIdValue: unknown): Promise<boolean> {
    const requestId = safeId(requestIdValue, 'OpenCode request id')
    const controller = this.flights.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async listProviders(): Promise<OpenCodeProvider[]> {
    const client = await this.requireClient()
    const data = await this.call(() => client.provider.list({ query: this.directoryQuery(), throwOnError: true })) as { all: Array<Provider | Record<string, unknown>>; connected: string[] }
    const connected = new Set(Array.isArray(data.connected) ? data.connected : [])
    return (data.all ?? []).map(value => projectProvider(value, connected))
  }

  async listAgents(): Promise<OpenCodeAgent[]> {
    const client = await this.requireClient()
    const data = await this.call(() => client.app.agents({ query: this.directoryQuery(), throwOnError: true }))
    return (data as Array<Agent | Record<string, unknown>>).map(projectAgent)
  }

  async listTools(): Promise<OpenCodeTools> {
    const client = await this.requireClient()
    return this.listToolsFromClient(client)
  }

  private async listToolsFromClient(client: OpencodeClient, signal?: AbortSignal): Promise<OpenCodeTools> {
    const data = await this.call(() => client.tool.ids({ query: this.directoryQuery(), ...(signal ? { signal } : {}), throwOnError: true })) as string[]
    const ids = Array.isArray(data) ? data.filter(id => typeof id === 'string').map(id => id.slice(0, 160)) : []
    const customToolRegistered = ids.includes(OPENCODE_CUSTOM_TOOL_ID)
    this.customToolRegistered = customToolRegistered
    return { ids, customToolRegistered }
  }

  async getWorkspaceInfo(): Promise<OpenCodeWorkspaceInfo> {
    const client = await this.requireClient()
    const pathInfo = await this.call(() => client.path.get({ query: this.directoryQuery(), throwOnError: true })) as { directory?: string; worktree?: string }
    const vcs = await this.call(() => client.vcs.get({ query: this.directoryQuery(), throwOnError: true })).catch(() => ({ branch: '' })) as { branch?: string }
    const files = await this.call(() => client.file.status({ query: this.directoryQuery(), throwOnError: true })).catch(() => []) as unknown[]
    return {
      directory: this.workspacePath ?? (typeof pathInfo.directory === 'string' ? pathInfo.directory : null),
      worktree: typeof pathInfo.worktree === 'string' ? pathInfo.worktree : null,
      branch: typeof vcs.branch === 'string' && vcs.branch ? clampText(vcs.branch, 200) : null,
      changedFiles: Array.isArray(files) ? files.length : 0,
    }
  }

  async listMcp(): Promise<OpenCodeMcpServer[]> {
    const client = await this.requireClient()
    const data = await this.call(() => client.mcp.status({ query: this.directoryQuery(), throwOnError: true })) as Record<string, unknown>
    return Object.entries(data ?? {}).map(([id, raw]) => {
      const item = isRecord(raw) ? raw : {}
      const status = item.status
      return {
        id: clampText(id, 160),
        status: status === 'connected' || status === 'disabled' || status === 'failed' || status === 'needs_auth' || status === 'needs_client_registration' ? status : 'unknown',
        error: typeof item.error === 'string' ? clampText(item.error, 500) : null,
      }
    })
  }

  async permissionReply(sessionIdValue: unknown, permissionIdValue: unknown, responseValue: unknown): Promise<boolean> {
    const sessionId = safeId(sessionIdValue, 'OpenCode session id')
    const permissionID = safeId(permissionIdValue, 'OpenCode permission id')
    if (responseValue !== 'once' && responseValue !== 'always' && responseValue !== 'reject') throw new OpenCodeError('bad-args', 'OpenCode permission response is invalid')
    const client = await this.requireClient()
    return Boolean(await this.call(() => client.postSessionIdPermissionsPermissionId({ path: { id: sessionId, permissionID }, query: this.requiredDirectoryQuery(), body: { response: responseValue }, throwOnError: true })))
  }

  private async startInternal(): Promise<OpenCodeEngineStatus> {
    const startupAbort = new AbortController()
    this.startupAbort = startupAbort
    this.state = 'starting'
    this.detail = null
    this.customToolRegistered = null
    try {
      const executable = resolveOpenCodeExecutable(this.options)
      if (!executable) {
        this.state = 'unavailable'
        this.detail = `OpenCode ${OPENCODE_VERSION} is not staged for this platform.`
        return this.status()
      }
      await this.loadLocalProvider()
      await this.writeRuntimeFiles()
      const port = this.options.acquirePort ? await this.options.acquirePort() : await freeLoopbackPort()
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new OpenCodeError('runtime', 'OpenCode loopback port allocation failed')
      const username = 'metrora'
      const password = randomBytes(32).toString('hex')
      const auth = basicAuth(username, password)
      const serverUrl = `http://${LOOPBACK_HOST}:${port}`
      const child = this.spawnProcess(executable, ['serve', `--hostname=${LOOPBACK_HOST}`, `--port=${port}`], {
        cwd: this.workspacePath ?? this.options.appPath,
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_DIR: this.runtimeDir,
          METRORA_USAGE_SNAPSHOT_FILE: this.snapshotPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      // Drain child output without forwarding it to the renderer or logs. The
      // server receives credentials through its environment only, and a noisy
      // provider/tool error must never fill a pipe or disclose a secret.
      child.stdout?.resume()
      child.stderr?.resume()
      this.child = child
      let exited = false
      const onExit = () => {
        exited = true
        if (this.child !== child || this.state === 'stopping' || this.state === 'idle') return
        this.child = null
        this.client = null
        this.state = 'unavailable'
        this.customToolRegistered = null
        this.detail = 'The bundled OpenCode server stopped.'
      }
      child.once('exit', onExit)
      child.once('error', onExit)
      const version = await this.waitForHealth(serverUrl, auth, () => exited, startupAbort.signal)
      if (version !== OPENCODE_VERSION) throw new OpenCodeError('version-mismatch', `OpenCode reported version ${version || 'unknown'}; expected ${OPENCODE_VERSION}.`)
      this.client = await this.makeClient({ baseUrl: serverUrl, headers: { Authorization: auth }, ...(this.workspacePath ? { directory: this.workspacePath } : {}) })
      const tools = await this.listToolsFromClient(this.client, startupAbort.signal)
      if (!tools.customToolRegistered) throw new OpenCodeError('custom-tool', `OpenCode did not register ${OPENCODE_CUSTOM_TOOL_ID}.`)
      this.state = 'ready'
      this.detail = null
      this.startEventStream()
      return this.status()
    } catch (error) {
      this.client = null
      const child = this.child
      this.child = null
      try { child?.kill() } catch { /* best effort */ }
      this.state = 'unavailable'
      this.detail = error instanceof OpenCodeError ? error.message : 'OpenCode could not be started.'
      this.customToolRegistered = null
      return this.status()
    } finally {
      if (this.startupAbort === startupAbort) this.startupAbort = null
    }
  }

  private async waitForHealth(url: string, auth: string, hasExited: () => boolean, signal: AbortSignal): Promise<string> {
    const deadline = this.now() + HEALTH_TIMEOUT_MS
    while (this.now() < deadline) {
      if (signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode startup cancelled.')
      if (hasExited()) throw new OpenCodeError('runtime', 'OpenCode server exited during startup.')
      try {
        const response = await this.fetchImpl(`${url}/global/health`, { headers: { Authorization: auth }, signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]) })
        if (response.ok) {
          const value = await response.json() as { healthy?: boolean; version?: string }
          if (value.healthy === true) return safeString(value.version)
        }
      } catch {
        if (signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode startup cancelled.')
        // The server may still be binding its loopback listener.
      }
      await sleep(HEALTH_POLL_MS)
    }
    throw new OpenCodeError('timeout', 'OpenCode server did not become healthy.')
  }

  private async makeClient(config: ClientConfig): Promise<OpencodeClient> {
    if (this.createClient) return this.createClient(config)
    const sdk = await import('@opencode-ai/sdk')
    return sdk.createOpencodeClient({ ...config, fetch: request => this.fetchImpl(request) })
  }

  private startEventStream(): void {
    const client = this.client
    if (!client) return
    this.eventAbort?.abort()
    const controller = new AbortController()
    this.eventAbort = controller
    void (async () => {
      try {
        const result = await client.global.event({ signal: controller.signal, sseMaxRetryAttempts: 1 })
        for await (const item of result.stream) {
          if (controller.signal.aborted) return
          const event = item as unknown as { directory?: string; payload?: unknown }
          if (event.directory && this.workspacePath && path.normalize(event.directory) !== path.normalize(this.workspacePath)) continue
          const projected = projectEvent(event.payload ?? item, this.workspacePath)
          if (projected) for (const listener of this.listeners) {
            try { listener(projected) } catch { /* one renderer listener must not stop the stream */ }
          }
        }
      } catch {
        if (!controller.signal.aborted && this.state === 'ready') {
          this.detail = 'OpenCode event stream disconnected; session APIs remain available.'
        }
      }
    })()
  }

  private async requireClient(): Promise<OpencodeClient> {
    if (this.state !== 'ready' || !this.client) {
      const status = await this.start()
      if (status.state !== 'ready' || !this.client) throw new OpenCodeError('unavailable', status.detail ?? 'OpenCode is unavailable.')
    }
    return this.client
  }

  private directoryQuery(): { directory?: string } {
    return this.workspacePath ? { directory: this.workspacePath } : {}
  }

  private requiredDirectoryQuery(): { directory: string } {
    if (!this.workspacePath) throw new OpenCodeError('workspace-required', 'Choose an OpenCode workspace first.')
    return { directory: this.workspacePath }
  }

  private modelRef(value: unknown): OpenCodeModelRef {
    if (!isRecord(value)) throw new OpenCodeError('bad-args', 'OpenCode model is invalid')
    return { providerID: safeId(value.providerID, 'OpenCode provider id'), modelID: safeId(value.modelID, 'OpenCode model id') }
  }

  private async call<T>(operation: () => Promise<{ data?: T; error?: unknown }>): Promise<T> {
    try {
      const result = await operation()
      if (result && 'data' in result && result.data !== undefined) return result.data
      throw new OpenCodeError('api', 'OpenCode returned no data.')
    } catch (error) {
      if (error instanceof OpenCodeError) throw error
      const message = isRecord(error) && isRecord(error.data) && typeof error.data.message === 'string'
        ? error.data.message
        : error instanceof Error ? error.message : 'OpenCode request failed.'
      throw new OpenCodeError('api', clampText(message, 1_000))
    }
  }

  private async writeRuntimeFiles(): Promise<void> {
    const toolsDir = path.join(this.runtimeDir, 'tools')
    const nodeModulesDir = path.join(this.runtimeDir, 'node_modules')
    await mkdir(toolsDir, { recursive: true })
    // OpenCode's official config loader starts a background npm reify for every
    // config directory and waits for it before discovering custom tools. The
    // Metrora tool is dependency-free plain ESM, so seed the private runtime
    // manifest/lock and an empty node_modules sentinel to keep startup offline
    // and deterministic without modifying the user's OpenCode configuration.
    const runtimePackage = {
      name: 'metrora-opencode-runtime',
      version: '1.0.0',
      private: true,
      dependencies: { '@opencode-ai/plugin': OPENCODE_VERSION },
    }
    const runtimeLock = {
      name: runtimePackage.name,
      version: runtimePackage.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { dependencies: runtimePackage.dependencies } },
    }
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(path.join(this.runtimeDir, 'package.json'), JSON.stringify(runtimePackage, null, 2), 'utf8')
    await writeFile(path.join(this.runtimeDir, 'package-lock.json'), JSON.stringify(runtimeLock, null, 2), 'utf8')
    const config: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      share: 'disabled',
      autoupdate: false,
      logLevel: 'ERROR',
      ...(this.localProvider ? { provider: localProviderConfig(this.localProvider) } : {}),
    }
    await writeFile(this.configPath, JSON.stringify(asConfig(config), null, 2), 'utf8')
    await writeFile(path.join(toolsDir, `${OPENCODE_CUSTOM_TOOL_ID}.js`), OPENCODE_USAGE_TOOL_SOURCE, 'utf8')
  }

  private async loadLocalProvider(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.localProviderPath, 'utf8')) as unknown
      if (isRecord(value) && typeof value.port === 'number' && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65_535 && typeof value.modelId === 'string' && SAFE_ID.test(value.modelId)) this.localProvider = { port: value.port, modelId: value.modelId }
    } catch { /* first launch has no local provider override */ }
  }

  private async refreshUsageSnapshot(): Promise<void> {
    let value: unknown = { available: false, detail: 'Metrora usage snapshot is unavailable.' }
    try { value = this.options.readUsageSnapshot ? await this.options.readUsageSnapshot() : value } catch { /* custom tool reports unavailable */ }
    await mkdir(this.runtimeDir, { recursive: true })
    await writeFile(this.snapshotPath, JSON.stringify(projectMetroraUsageSnapshot(value, new Date(this.now()).toISOString())), 'utf8')
  }
}

export function createOpenCodeBridgeHandlers(engine: OpenCodeEngine): Record<string, (...args: any[]) => Promise<{ ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }>> {
  const run = (operation: (...args: any[]) => Promise<unknown>) => async (...args: any[]) => {
    try { return { ok: true, value: await operation(...args) } as const }
    catch (error) {
      if (error instanceof OpenCodeError) return { ok: false, error: { kind: error.kind, message: error.message } } as const
      return { ok: false, error: { kind: 'runtime', message: 'OpenCode request failed.' } } as const
    }
  }
  return {
    'metrora:opencodeStatus': async () => ({ ok: true, value: engine.status() }),
    'metrora:opencodeStart': run(() => engine.start()),
    'metrora:opencodeRestart': run(() => engine.restart()),
    'metrora:opencodeSetWorkspace': run(value => engine.setWorkspace(value)),
    'metrora:opencodeListSessions': run(() => engine.listSessions()),
    'metrora:opencodeCreateSession': run(title => engine.createSession(title)),
    'metrora:opencodeGetMessages': run(sessionId => engine.getMessages(sessionId)),
    'metrora:opencodePrompt': run(value => engine.prompt(value)),
    'metrora:opencodeCancel': run(requestId => engine.cancel(requestId)),
    'metrora:opencodeListProviders': run(() => engine.listProviders()),
    'metrora:opencodeListAgents': run(() => engine.listAgents()),
    'metrora:opencodeListTools': run(() => engine.listTools()),
    'metrora:opencodeGetWorkspace': run(() => engine.getWorkspaceInfo()),
    'metrora:opencodeGetMcp': run(() => engine.listMcp()),
    'metrora:opencodePermissionReply': run((sessionId, permissionId, response) => engine.permissionReply(sessionId, permissionId, response)),
    'metrora:opencodeConfigureLocal': run(value => engine.configureLocalProvider(value)),
  }
}

export function projectOpenCodeEventForRenderer(value: unknown, workspace: string | null = null): OpenCodeRendererEvent | null {
  return projectEvent(value, workspace)
}
