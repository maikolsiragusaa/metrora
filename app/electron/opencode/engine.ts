import { randomBytes } from 'node:crypto'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

import type { OpencodeClient } from '@opencode-ai/sdk/v2' with { "resolution-mode": "import" }

import { projectOpenCodeEvent } from './events'
import {
  abortSession,
  createOfficialOpenCodeClient,
  createSession,
  getMessages,
  getWorkspaceInfo,
  listAgents,
  listMcp,
  listProviderAuth,
  listProviders,
  listSessions,
  listTools,
  permissionList,
  permissionReply,
  prompt,
  providerOAuthAuthorize,
  providerOAuthCallback,
  questionList,
  questionReject,
  questionReply,
  setProviderApiKey,
  type OpenCodeCall,
  type OpenCodeClientConfig,
  type OpenCodeClientFactory,
} from './client'
import { freeLoopbackPort, isDirectory, loadLocalProvider, LOOPBACK_HOST, persistLocalProvider, runtimePaths, writeRuntimeFiles, writeUsageSnapshot, type OpenCodeRuntimePaths } from './config'
import { clampText, isRecord, projectMetroraUsageSnapshot, projectPermissionMetadata, projectPermissionTool, projectQuestions, relativeFile, safeId, safeOptionalId, safeString, MAX_TEXT, SAFE_ID } from './projections'
import {
  OPENCODE_COMMIT,
  OPENCODE_CUSTOM_TOOL_ID,
  OPENCODE_VERSION,
  OpenCodeError,
  type OpenCodeAgent,
  type OpenCodeConversationMessage,
  type OpenCodeEngineState,
  type OpenCodeEngineStatus,
  type OpenCodeLocalProviderConfig,
  type OpenCodeMcpServer,
  type OpenCodeModelRef,
  type OpenCodeProvider,
  type OpenCodeProviderAuthAuthorization,
  type OpenCodeProviderAuthMethods,
  type OpenCodePromptRequest,
  type OpenCodeRendererEvent,
  type OpenCodeSession,
  type OpenCodeTools,
  type OpenCodeWorkspaceInfo,
} from './types'

const HEALTH_TIMEOUT_MS = 12_000
const HEALTH_POLL_MS = 100
const STOP_TIMEOUT_MS = 1_500

type ChildLike = Pick<ChildProcess, 'stdout' | 'stderr' | 'pid' | 'once' | 'kill'>
type SpawnProcess = (file: string, args: string[], options: SpawnOptions) => ChildLike
type FetchImpl = typeof fetch
type Flight = { controller: AbortController; sessionId: string }

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
  createClient?: OpenCodeClientFactory
  now?: () => number
  readUsageSnapshot?: () => Promise<unknown>
  acquirePort?: () => Promise<number>
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'opencode.exe' : 'opencode'
}

export function resolveOpenCodeExecutable(options: Pick<OpenCodeRuntimeOptions, 'appPath' | 'resourcesPath' | 'isPackaged' | 'platform' | 'arch' | 'executableOverride'>): string | null {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const name = executableName(platform)
  const override = options.executableOverride ?? process.env.METRORA_OPENCODE_BIN
  const candidates = override ? [override] : [
    path.join(options.resourcesPath, 'opencode', OPENCODE_VERSION, `${platform}-${arch}`, name),
    path.join(options.appPath, 'build', 'opencode', OPENCODE_VERSION, `${platform}-${arch}`, name),
  ]
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue
    try { if (statSync(candidate).isFile()) return candidate } catch { /* staging is optional in source checkouts */ }
  }
  return null
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function authInputs(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new OpenCodeError('bad-args', 'OpenCode OAuth inputs are invalid')
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (!SAFE_ID.test(key) || typeof item !== 'string' || item.length > 4_096) throw new OpenCodeError('bad-args', 'OpenCode OAuth input is invalid')
    result[key] = item
  }
  return result
}

function authMethod(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new OpenCodeError('bad-args', 'OpenCode auth method is invalid')
  return value
}

function questionAnswers(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length > 20) throw new OpenCodeError('bad-args', 'OpenCode question answers are invalid')
  return value.map(answer => {
    if (!Array.isArray(answer) || answer.length > 50) throw new OpenCodeError('bad-args', 'OpenCode question answer is invalid')
    return answer.map(item => {
      if (typeof item !== 'string' || item.length > 4_000) throw new OpenCodeError('bad-args', 'OpenCode question answer is invalid')
      return item
    })
  })
}

export class OpenCodeEngine {
  private readonly options: OpenCodeRuntimeOptions
  private readonly spawnProcess: SpawnProcess
  private readonly fetchImpl: FetchImpl
  private readonly createClient: OpenCodeClientFactory | null
  private readonly now: () => number
  private readonly listeners = new Set<(event: OpenCodeRendererEvent) => void>()
  private readonly flights = new Map<string, Flight>()
  private readonly paths: OpenCodeRuntimePaths
  private state: OpenCodeEngineState = 'idle'
  private detail: string | null = null
  private customToolRegistered: boolean | null = null
  private child: ChildLike | null = null
  private client: OpencodeClient | null = null
  private eventAbort: AbortController | null = null
  private startupAbort: AbortController | null = null
  private startPromise: Promise<OpenCodeEngineStatus> | null = null
  private workspacePath: string | null
  private localProvider: OpenCodeLocalProviderConfig | null = null

  constructor(options: OpenCodeRuntimeOptions) {
    this.options = options
    this.spawnProcess = options.spawnProcess ?? ((file, args, spawnOptions) => nodeSpawn(file, args, spawnOptions))
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.createClient = options.createClient ?? null
    this.now = options.now ?? (() => Date.now())
    this.workspacePath = options.workspacePath ?? null
    this.paths = runtimePaths(options.userDataPath)
  }

  onEvent(listener: (event: OpenCodeRendererEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(): OpenCodeEngineStatus {
    return { state: this.state, version: OPENCODE_VERSION, commit: OPENCODE_COMMIT, workspace: this.workspacePath, customToolRegistered: this.customToolRegistered, detail: this.detail, acpAvailable: this.child !== null }
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
    for (const flight of this.flights.values()) flight.controller.abort()
    this.flights.clear()
    this.client = null
    const child = this.child
    this.child = null
    if (child) await new Promise<void>(resolve => {
      let settled = false
      const finish = () => { if (!settled) { settled = true; resolve() } }
      child.once('exit', finish)
      try { child.kill() } catch { finish() }
      setTimeout(finish, STOP_TIMEOUT_MS)
    })
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
    await persistLocalProvider(this.paths.localProviderPath, this.localProvider)
    return this.restart()
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    return listSessions(await this.requireClient(), this.workspacePath, this.call.bind(this))
  }

  async createSession(title?: unknown): Promise<OpenCodeSession> {
    const value = typeof title === 'string' && title.trim() ? clampText(title.trim(), 200) : undefined
    return createSession(await this.requireClient(), this.workspacePath, value, this.call.bind(this))
  }

  async getMessages(sessionIdValue: unknown): Promise<OpenCodeConversationMessage[]> {
    const sessionId = safeId(sessionIdValue, 'OpenCode session id')
    return getMessages(await this.requireClient(), this.workspacePath, sessionId, this.workspacePath, this.call.bind(this))
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
    const directory = this.requiredDirectory()
    const controller = new AbortController()
    this.flights.set(request.requestId, { controller, sessionId: request.sessionId })
    try {
      return await prompt(client, directory, request.sessionId, request, controller.signal, this.workspacePath, this.call.bind(this))
    } catch (error) {
      if (controller.signal.aborted) throw new OpenCodeError('cancelled', 'OpenCode request cancelled')
      throw error
    } finally {
      if (this.flights.get(request.requestId)?.controller === controller) this.flights.delete(request.requestId)
    }
  }

  async cancel(requestIdValue: unknown): Promise<boolean> {
    const requestId = safeId(requestIdValue, 'OpenCode request id')
    const flight = this.flights.get(requestId)
    if (!flight) return false
    flight.controller.abort()
    const client = this.client
    const directory = this.workspacePath
    if (client && directory) {
      try { await abortSession(client, directory, flight.sessionId, this.call.bind(this)) } catch { /* request cancellation remains local and best effort */ }
    }
    return true
  }

  async listProviders(): Promise<OpenCodeProvider[]> {
    return listProviders(await this.requireClient(), this.workspacePath, this.call.bind(this))
  }

  async listProviderAuth(): Promise<OpenCodeProviderAuthMethods> {
    return listProviderAuth(await this.requireClient(), this.workspacePath, this.call.bind(this))
  }

  async setProviderApiKey(providerIdValue: unknown, keyValue: unknown): Promise<boolean> {
    const providerId = safeId(providerIdValue, 'OpenCode provider id')
    return setProviderApiKey(await this.requireClient(), providerId, keyValue, this.call.bind(this))
  }

  async providerOAuthAuthorize(providerIdValue: unknown, methodValue: unknown, inputsValue: unknown): Promise<OpenCodeProviderAuthAuthorization> {
    return providerOAuthAuthorize(await this.requireClient(), this.workspacePath, safeId(providerIdValue, 'OpenCode provider id'), authMethod(methodValue), authInputs(inputsValue), this.call.bind(this))
  }

  async providerOAuthCallback(providerIdValue: unknown, methodValue: unknown, codeValue: unknown): Promise<boolean> {
    const result = await providerOAuthCallback(await this.requireClient(), this.workspacePath, safeId(providerIdValue, 'OpenCode provider id'), authMethod(methodValue), codeValue, this.call.bind(this))
    return result
  }

  async listAgents(): Promise<OpenCodeAgent[]> {
    return listAgents(await this.requireClient(), this.workspacePath, this.call.bind(this))
  }

  async listTools(): Promise<OpenCodeTools> {
    return this.listToolsFromClient(await this.requireClient())
  }

  async getWorkspaceInfo(): Promise<OpenCodeWorkspaceInfo> {
    return getWorkspaceInfo(await this.requireClient(), this.workspacePath, this.workspacePath, this.call.bind(this))
  }

  async listMcp(): Promise<OpenCodeMcpServer[]> {
    return listMcp(await this.requireClient(), this.workspacePath, this.call.bind(this))
  }

  async permissionReply(sessionIdValue: unknown, permissionIdValue: unknown, responseValue: unknown): Promise<boolean> {
    safeId(sessionIdValue, 'OpenCode session id')
    const requestId = safeId(permissionIdValue, 'OpenCode permission id')
    if (responseValue !== 'once' && responseValue !== 'always' && responseValue !== 'reject') throw new OpenCodeError('bad-args', 'OpenCode permission response is invalid')
    return permissionReply(await this.requireClient(), this.requiredDirectory(), requestId, responseValue, this.call.bind(this))
  }

  async questionReply(requestIdValue: unknown, answersValue: unknown): Promise<boolean> {
    const requestId = safeId(requestIdValue, 'OpenCode question id')
    return questionReply(await this.requireClient(), this.requiredDirectory(), requestId, questionAnswers(answersValue), this.call.bind(this))
  }

  async questionReject(requestIdValue: unknown): Promise<boolean> {
    return questionReject(await this.requireClient(), this.requiredDirectory(), safeId(requestIdValue, 'OpenCode question id'), this.call.bind(this))
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
      this.localProvider = await loadLocalProvider(this.paths.localProviderPath)
      await writeRuntimeFiles(this.paths, this.localProvider)
      const port = this.options.acquirePort ? await this.options.acquirePort() : await freeLoopbackPort()
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new OpenCodeError('runtime', 'OpenCode loopback port allocation failed')
      const username = 'metrora'
      const password = randomBytes(32).toString('hex')
      const auth = basicAuth(username, password)
      const serverUrl = `http://${LOOPBACK_HOST}:${port}`
      const child = this.spawnProcess(executable, ['serve', `--hostname=${LOOPBACK_HOST}`, `--port=${port}`], {
        cwd: this.workspacePath ?? this.options.appPath,
        env: { ...process.env, OPENCODE_SERVER_USERNAME: username, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_DIR: this.paths.runtimeDir, METRORA_USAGE_SNAPSHOT_FILE: this.paths.snapshotPath },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
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
      void this.syncPendingRequests()
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
      }
      await sleep(HEALTH_POLL_MS)
    }
    throw new OpenCodeError('timeout', 'OpenCode server did not become healthy.')
  }

  private async makeClient(config: OpenCodeClientConfig): Promise<OpencodeClient> {
    if (this.createClient) return this.createClient(config)
    return createOfficialOpenCodeClient(config, this.fetchImpl)
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
          const projected = projectOpenCodeEvent(event.payload ?? item, this.workspacePath)
          if (projected) this.publish(projected)
        }
      } catch {
        if (!controller.signal.aborted && this.state === 'ready') this.detail = 'OpenCode event stream disconnected; session APIs remain available.'
      }
    })()
  }

  private async syncPendingRequests(): Promise<void> {
    const client = this.client
    if (!client || this.state !== 'ready') return
    try {
      const [permissions, questions] = await Promise.all([permissionList(client, this.workspacePath, this.call.bind(this)), questionList(client, this.workspacePath, this.call.bind(this))])
      for (const request of permissions) this.publish({ kind: 'permission', ...this.projectPermissionRequest(request) })
      for (const request of questions) this.publish({ kind: 'question-asked', ...this.projectQuestionRequest(request) })
    } catch { /* event replay is best effort; official list endpoints remain available */ }
  }

  private projectPermissionRequest(value: unknown): Omit<Extract<OpenCodeRendererEvent, { kind: 'permission' }>, 'kind'> {
    const item = isRecord(value) ? value : {}
    return { sessionId: safeString(item.sessionID), permissionId: safeString(item.id), permission: clampText(safeString(item.permission, 'permission'), 160), patterns: Array.isArray(item.patterns) ? item.patterns.filter((entry): entry is string => typeof entry === 'string').map(entry => clampText(entry, 500)).slice(0, 50) : [], always: Array.isArray(item.always) ? item.always.filter((entry): entry is string => typeof entry === 'string').map(entry => clampText(entry, 500)).slice(0, 50) : [], metadata: projectPermissionMetadata(item.metadata), tool: projectPermissionTool(item.tool) }
  }

  private projectQuestionRequest(value: unknown): Omit<Extract<OpenCodeRendererEvent, { kind: 'question-asked' }>, 'kind'> {
    const item = isRecord(value) ? value : {}
    return { sessionId: safeString(item.sessionID), requestId: safeString(item.id), questions: projectQuestions(item.questions), tool: projectPermissionTool(item.tool) }
  }

  private publish(event: OpenCodeRendererEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* one renderer listener must not stop OpenCode */ }
    }
  }

  private async listToolsFromClient(client: OpencodeClient, signal?: AbortSignal): Promise<OpenCodeTools> {
    const data = await listTools(client, this.workspacePath, this.call.bind(this), signal)
    const customToolRegistered = data.ids.includes(OPENCODE_CUSTOM_TOOL_ID)
    this.customToolRegistered = customToolRegistered
    return { ids: data.ids, customToolRegistered }
  }

  private async requireClient(): Promise<OpencodeClient> {
    if (this.state !== 'ready' || !this.client) {
      const status = await this.start()
      if (status.state !== 'ready' || !this.client) throw new OpenCodeError('unavailable', status.detail ?? 'OpenCode is unavailable.')
    }
    return this.client
  }

  private requiredDirectory(): string {
    if (!this.workspacePath) throw new OpenCodeError('workspace-required', 'Choose an OpenCode workspace first.')
    return this.workspacePath
  }

  private modelRef(value: unknown): OpenCodeModelRef {
    if (!isRecord(value)) throw new OpenCodeError('bad-args', 'OpenCode model is invalid')
    return { providerID: safeId(value.providerID, 'OpenCode provider id'), modelID: safeId(value.modelID, 'OpenCode model id') }
  }

  private async call<T>(operation: Parameters<OpenCodeCall>[0]): Promise<T> {
    try {
      const result = await operation()
      if (result && 'data' in result && result.data !== undefined) return result.data as T
      throw new OpenCodeError('api', 'OpenCode returned no data.')
    } catch (error) {
      if (error instanceof OpenCodeError) throw error
      const message = isRecord(error) && isRecord(error.data) && typeof error.data.message === 'string' ? error.data.message : error instanceof Error ? error.message : 'OpenCode request failed.'
      throw new OpenCodeError('api', clampText(message, 1_000))
    }
  }

  private async refreshUsageSnapshot(): Promise<void> {
    let value: unknown = { available: false, detail: 'Metrora usage snapshot is unavailable.' }
    try { value = this.options.readUsageSnapshot ? await this.options.readUsageSnapshot() : value } catch { /* the custom tool reports unavailable */ }
    await writeUsageSnapshot(this.paths, projectMetroraUsageSnapshot(value, new Date(this.now()).toISOString()))
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
    'metrora:opencodeListProviderAuth': run(() => engine.listProviderAuth()),
    'metrora:opencodeSetProviderApiKey': run((providerId, key) => engine.setProviderApiKey(providerId, key)),
    'metrora:opencodeProviderOAuthAuthorize': run((providerId, method, inputs) => engine.providerOAuthAuthorize(providerId, method, inputs)),
    'metrora:opencodeProviderOAuthCallback': run((providerId, method, code) => engine.providerOAuthCallback(providerId, method, code)),
    'metrora:opencodeListAgents': run(() => engine.listAgents()),
    'metrora:opencodeListTools': run(() => engine.listTools()),
    'metrora:opencodeGetWorkspace': run(() => engine.getWorkspaceInfo()),
    'metrora:opencodeGetMcp': run(() => engine.listMcp()),
    'metrora:opencodePermissionReply': run((sessionId, permissionId, response) => engine.permissionReply(sessionId, permissionId, response)),
    'metrora:opencodeQuestionReply': run((requestId, answers) => engine.questionReply(requestId, answers)),
    'metrora:opencodeQuestionReject': run(requestId => engine.questionReject(requestId)),
    'metrora:opencodeConfigureLocal': run(value => engine.configureLocalProvider(value)),
  }
}
