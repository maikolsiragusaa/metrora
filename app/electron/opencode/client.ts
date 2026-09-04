import type {
  Agent,
  Message,
  OpencodeClient,
  OpencodeClientConfig,
  Part,
  Provider,
  ProviderAuthAuthorization,
  Session,
} from '@opencode-ai/sdk/v2' with { "resolution-mode": "import" }

import { OpenCodeError, type OpenCodeConversationMessage, type OpenCodeProvider, type OpenCodeProviderAuthAuthorization, type OpenCodeProviderAuthMethods, type OpenCodeSession, type OpenCodeTools, type OpenCodeWorkspaceInfo, type OpenCodeAgent, type OpenCodeMcpServer } from './types'
import { projectAgent, projectMessage, projectProvider, projectProviderAuth, projectSession, isRecord, clampText, safeString } from './projections'

export type OpenCodeClientConfig = OpencodeClientConfig & { directory?: string }
export type OpenCodeClientFactory = (config: OpenCodeClientConfig) => OpencodeClient
export type OpenCodeCall = <T>(operation: () => Promise<{ data?: T; error?: unknown }>) => Promise<T>

type DirectoryQuery = { directory?: string }
type MessageEnvelope = { info: Message | Record<string, unknown>; parts: Array<Part | Record<string, unknown>> }

export function directoryQuery(directory: string | null): DirectoryQuery {
  return directory ? { directory } : {}
}

export async function createOfficialOpenCodeClient(config: OpenCodeClientConfig, fetchImpl: typeof fetch): Promise<OpencodeClient> {
  const sdk = await import('@opencode-ai/sdk/v2')
  return sdk.createOpencodeClient({ ...config, fetch: request => fetchImpl(request) })
}

export async function listSessions(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<OpenCodeSession[]> {
  const data = await call(() => client.session.list(directoryQuery(directory), { throwOnError: true }))
  return (data as Array<Session | Record<string, unknown>>).map(projectSession)
}

export async function createSession(client: OpencodeClient, directory: string | null, title: string | undefined, call: OpenCodeCall): Promise<OpenCodeSession> {
  const data = await call(() => client.session.create({ ...directoryQuery(directory), ...(title ? { title } : {}) }, { throwOnError: true }))
  return projectSession(data as Session)
}

export async function getMessages(client: OpencodeClient, directory: string | null, sessionID: string, workspace: string | null, call: OpenCodeCall): Promise<OpenCodeConversationMessage[]> {
  const data = await call(() => client.session.messages({ ...directoryQuery(directory), sessionID }, { throwOnError: true }))
  return (data as MessageEnvelope[]).map(value => projectMessage(value, workspace))
}

export async function prompt(client: OpencodeClient, directory: string, sessionID: string, request: { text: string; model?: { providerID: string; modelID: string }; agent?: string; variant?: string }, signal: AbortSignal, workspace: string | null, call: OpenCodeCall): Promise<OpenCodeConversationMessage> {
  const data = await call(() => client.session.prompt({
    directory,
    sessionID,
    parts: [{ type: 'text', text: request.text }],
    ...(request.model ? { model: request.model } : {}),
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.variant ? { variant: request.variant } : {}),
  }, { signal, throwOnError: true }))
  return projectMessage(data as MessageEnvelope, workspace)
}

export async function abortSession(client: OpencodeClient, directory: string, sessionID: string, call: OpenCodeCall): Promise<boolean> {
  return Boolean(await call(() => client.session.abort({ directory, sessionID }, { throwOnError: true })))
}

export async function listProviders(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<OpenCodeProvider[]> {
  const data = await call(() => client.provider.list(directoryQuery(directory), { throwOnError: true })) as { all: Array<Provider | Record<string, unknown>>; connected: string[] }
  const connected = new Set(Array.isArray(data.connected) ? data.connected : [])
  return (data.all ?? []).map(value => projectProvider(value, connected))
}

export async function listProviderAuth(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<OpenCodeProviderAuthMethods> {
  const data = await call(() => client.provider.auth(directoryQuery(directory), { throwOnError: true }))
  return projectProviderAuth(data)
}

function secret(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) throw new OpenCodeError('bad-args', 'OpenCode provider credential is invalid')
  return value
}

export async function setProviderApiKey(client: OpencodeClient, providerID: string, value: unknown, call: OpenCodeCall): Promise<boolean> {
  return Boolean(await call(() => client.auth.set({ providerID, auth: { type: 'api', key: secret(value) } }, { throwOnError: true })))
}

export async function providerOAuthAuthorize(client: OpencodeClient, directory: string | null, providerID: string, method: number, inputs: Record<string, string>, call: OpenCodeCall): Promise<OpenCodeProviderAuthAuthorization> {
  const data = await call(() => client.provider.oauth.authorize({ ...directoryQuery(directory), providerID, method, inputs }, { throwOnError: true }))
  const authorization = data as ProviderAuthAuthorization
  return { url: authorization.url, method: authorization.method, instructions: clampText(authorization.instructions, 2_000) }
}

export async function providerOAuthCallback(client: OpencodeClient, directory: string | null, providerID: string, method: number, code: unknown, call: OpenCodeCall): Promise<boolean> {
  const value = code === undefined || code === null ? undefined : secret(code)
  return Boolean(await call(() => client.provider.oauth.callback({ ...directoryQuery(directory), providerID, method, ...(value ? { code: value } : {}) }, { throwOnError: true })))
}

export async function listAgents(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<OpenCodeAgent[]> {
  const data = await call(() => client.app.agents(directoryQuery(directory), { throwOnError: true }))
  return (data as Array<Agent | Record<string, unknown>>).map(projectAgent)
}

export async function listTools(client: OpencodeClient, directory: string | null, call: OpenCodeCall, signal?: AbortSignal): Promise<OpenCodeTools> {
  const data = await call(() => client.tool.ids(directoryQuery(directory), { ...(signal ? { signal } : {}), throwOnError: true }))
  const ids = (Array.isArray(data) ? data : []).filter(id => typeof id === 'string').map(id => id.slice(0, 160))
  return { ids, customToolRegistered: false }
}

export async function getWorkspaceInfo(client: OpencodeClient, directory: string | null, workspace: string | null, call: OpenCodeCall): Promise<OpenCodeWorkspaceInfo> {
  const pathInfo = await call(() => client.path.get(directoryQuery(directory), { throwOnError: true })) as { directory?: string; worktree?: string }
  const vcs = await call(() => client.vcs.get(directoryQuery(directory), { throwOnError: true })).catch(() => ({ branch: '' })) as { branch?: string }
  const files = await call(() => client.file.status(directoryQuery(directory), { throwOnError: true })).catch(() => []) as unknown[]
  return { directory: workspace ?? (typeof pathInfo.directory === 'string' ? pathInfo.directory : null), worktree: typeof pathInfo.worktree === 'string' ? pathInfo.worktree : null, branch: typeof vcs.branch === 'string' && vcs.branch ? clampText(vcs.branch, 200) : null, changedFiles: Array.isArray(files) ? files.length : 0 }
}

export async function listMcp(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<OpenCodeMcpServer[]> {
  const data = await call(() => client.mcp.status(directoryQuery(directory), { throwOnError: true })) as Record<string, unknown>
  return Object.entries(data ?? {}).map(([id, raw]) => {
    const item = isRecord(raw) ? raw : {}
    const status = item.status
    return { id: clampText(id, 160), status: status === 'connected' || status === 'disabled' || status === 'failed' || status === 'needs_auth' || status === 'needs_client_registration' ? status : 'unknown', error: typeof item.error === 'string' ? clampText(item.error, 500) : null }
  })
}

export async function permissionList(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<unknown[]> {
  return await call(() => client.permission.list(directoryQuery(directory), { throwOnError: true })) as unknown[]
}

export async function permissionReply(client: OpencodeClient, directory: string, requestID: string, reply: 'once' | 'always' | 'reject', call: OpenCodeCall): Promise<boolean> {
  return Boolean(await call(() => client.permission.reply({ directory, requestID, reply }, { throwOnError: true })))
}

export async function questionList(client: OpencodeClient, directory: string | null, call: OpenCodeCall): Promise<unknown[]> {
  return await call(() => client.question.list(directoryQuery(directory), { throwOnError: true })) as unknown[]
}

export async function questionReply(client: OpencodeClient, directory: string, requestID: string, answers: string[][], call: OpenCodeCall): Promise<boolean> {
  return Boolean(await call(() => client.question.reply({ directory, requestID, answers }, { throwOnError: true })))
}

export async function questionReject(client: OpencodeClient, directory: string, requestID: string, call: OpenCodeCall): Promise<boolean> {
  return Boolean(await call(() => client.question.reject({ directory, requestID }, { throwOnError: true })))
}
