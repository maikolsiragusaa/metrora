/**
 * Product-facing projections for the Metrora Harness.
 *
 * DSH owns the durable event log and the Agent loop. These types are the
 * deliberately smaller, renderer-safe projection of that log. Provider
 * payloads, credentials, raw tool output and internal DSH objects never cross
 * this boundary.
 */

export type HarnessRuntimeId = 'ollama' | 'lmstudio' | 'llama-server'
export type HarnessHostedProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'opencode-zen'
export type HarnessRuntimeChoice = HarnessRuntimeId | 'hosted'
export type HarnessMode = 'ask' | 'plan' | 'edit' | 'build'
export type HarnessReasoningEffort = 'min' | 'low' | 'medium' | 'high' | 'max'

const HARNESS_REASONING_EFFORTS: readonly HarnessReasoningEffort[] = ['min', 'low', 'medium', 'high', 'max']

const HARNESS_PROVIDER_ROUTES: Record<HarnessRuntimeId, string> = {
  ollama: 'metrora-local-ollama',
  lmstudio: 'metrora-local-lmstudio',
  'llama-server': 'metrora-local-llama-server',
}
const HOSTED_PROVIDER_ROUTES: Record<HarnessHostedProvider, string> = {
  openai: 'metrora-hosted-openai',
  anthropic: 'metrora-hosted-anthropic',
  gemini: 'metrora-hosted-gemini',
  openrouter: 'metrora-hosted-openrouter',
  'opencode-zen': 'metrora-hosted-opencode-zen',
}

export function harnessProviderRoute(runtime: HarnessRuntimeId): string { return HARNESS_PROVIDER_ROUTES[runtime] }
export function hostedProviderRoute(provider: HarnessHostedProvider): string { return HOSTED_PROVIDER_ROUTES[provider] }

export type HarnessConformanceState =
  | 'discovered'
  | 'checking'
  | 'verified'
  | 'limited'
  | 'failed-conformance'
  | 'unavailable'

export type HarnessModelConformance = {
  state: HarnessConformanceState
  fingerprint: string | null
  toolCalling: 'verified' | 'unsupported' | 'unknown'
  reasoning: 'verified' | 'supported' | 'unsupported' | 'unknown'
  checkedAt: string | null
  detail: string | null
}

export type HarnessWorkspace = {
  id: string
  displayName: string
  relativeRoot: '.'
  available: boolean
}

export type HarnessLifecycleState =
  | 'thinking'
  | 'reasoning'
  | 'reading'
  | 'searching'
  | 'editing'
  | 'running-command'
  | 'running-agent'
  | 'waiting-approval'
  | 'preparing'
  | 'done'
  | 'cancelled'
  | 'failed'

export type HarnessToolStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'denied'
export type HarnessToolKind = 'filesystem' | 'search' | 'terminal' | 'git' | 'web' | 'metrora' | 'mcp' | 'subagent' | 'unknown'
export type HarnessRiskCategory = 'read-only' | 'workspace-mutation' | 'process' | 'git-local' | 'git-destructive' | 'git-remote' | 'network' | 'external'

export type HarnessMcpTransport = 'stdio' | 'streamable-http'
export type HarnessMcpServerConfig = {
  id: string
  serverName: string
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  cwd: string | null
  /** Non-secret explicit environment values only. Secret values use envRefs. */
  env: Record<string, string>
  /** Environment variable name → protected credential reference. */
  envRefs: Record<string, string>
} | {
  id: string
  serverName: string
  enabled: boolean
  transport: 'streamable-http'
  url: string
  /** Non-secret explicit headers only. Secret values use headerRefs. */
  headers: Record<string, string>
  /** Header name → protected credential reference. */
  headerRefs: Record<string, string>
}

export type HarnessMcpServerState = 'disabled' | 'connecting' | 'connected' | 'failed' | 'unavailable'
export type HarnessMcpServerStatus = {
  id: string
  serverName: string
  transport: HarnessMcpTransport
  enabled: boolean
  state: HarnessMcpServerState
  toolCount: number
  toolNames: string[]
  detail: string
  checkedAt: string | null
}

export type HarnessFileDiff = {
  path: string
  oldText: string | null
  newText: string
}

export type HarnessToolDetails =
  | { kind: 'read'; path: string; lines: Array<{ number: number; text: string }>; totalLines: number; truncated?: boolean }
  | { kind: 'search'; total: number; truncated: boolean; paths?: string[]; files?: Array<{ path: string; matches: Array<{ lineNumber: number; line: string }> }> }
  | { kind: 'diff'; diffs: HarnessFileDiff[] }
  | { kind: 'terminal'; output: string; exitCode?: number | null; signal?: string | null }
  | { kind: 'web'; url?: string; title?: string; excerpt?: string }

export type HarnessToolProjection = {
  callId: string
  rootCallId?: string
  parentCallId?: string
  name: string
  kind: HarnessToolKind
  source?: { kind: 'mcp'; serverName: string; toolName: string }
  status: HarnessToolStatus
  inputSummary: string
  resultSummary?: string
  path?: string
  command?: string
  exitCode?: number | null
  risk: HarnessRiskCategory
  agentId?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  details?: HarnessToolDetails
}

export type HarnessApprovalProjection = {
  approvalId: string
  callId: string | null
  toolName: string
  action: string
  workspacePath?: string
  command?: string
  risk: HarnessRiskCategory
  state: 'proposed' | 'approved' | 'denied' | 'executed' | 'failed'
  reason: string
}

export type HarnessAgentProjection = {
  agentId: string
  parentAgentId?: string
  task: string
  state: 'delegated' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: string
}

export type HarnessProcessItem =
  | { kind: 'reasoning'; id: string; text: string; state: 'streaming' | 'completed' }
  | { kind: 'tool'; item: HarnessToolProjection }
  | { kind: 'approval'; item: HarnessApprovalProjection }
  | { kind: 'agent'; item: HarnessAgentProjection }
  | { kind: 'status'; id: string; text: string }

export type MetroraHarnessRuntimeEvent = {
  conversationId: string
  state: HarnessLifecycleState
  requestId?: string
  kind?: 'lifecycle' | 'text-delta' | 'reasoning-delta' | 'tool' | 'approval' | 'agent' | 'conformance'
  text?: string
  process?: HarnessProcessItem
  conformance?: HarnessModelConformance
}

export type HarnessConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  process?: HarnessProcessItem[]
  interrupted?: boolean
}

export type HarnessConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  runtime: HarnessRuntimeChoice
  provider: HarnessHostedProvider | null
  model: string
  mode: HarnessMode
  reasoningEffort: HarnessReasoningEffort | null
  workspace: HarnessWorkspace | null
  conformance: HarnessModelConformance
}

export type HarnessConversation = HarnessConversationSummary & {
  messages: HarnessConversationMessage[]
}

export type HarnessScopeInput = {
  period: 'today' | 'week' | '30days' | 'month' | 'all' | 'lifetime'
  range: { from: string; to: string } | null
  provider: string
  projectId: string
  projectName: string
  model: string | null
}

export type HarnessConversationInput = {
  conversationId?: string
  runtime: HarnessRuntimeChoice
  provider?: HarnessHostedProvider
  model: string
  mode?: HarnessMode
  reasoningEffort?: HarnessReasoningEffort | null
  workspaceId?: string | null
  /** Main-process-only test/development seam. Renderer callers use workspaceId. */
  workspaceRoot?: string
  scope: HarnessScopeInput
}

export type HarnessSendMessageInput = HarnessConversationInput & {
  question: string
  requestId?: string
  retryRequestId?: string
}

export type HarnessSendMessageResult = {
  conversationId: string
  message: HarnessConversationMessage
  runtime: HarnessRuntimeChoice
  provider: HarnessHostedProvider | null
  model: string
}

export type HarnessRuntimeProfileV1 = {
  version: 1
  runtime: HarnessRuntimeChoice
  lastLocalRuntime: HarnessRuntimeId
  lastLocalModelByRuntime: Partial<Record<HarnessRuntimeId, string>>
  lastHostedModelByProvider: Partial<Record<HarnessHostedProvider, string>>
  llamaServerPort: number
  reasoningByModel: Record<string, HarnessReasoningEffort>
  hostedConsentByProvider: Partial<Record<HarnessHostedProvider, 'unknown' | 'accepted' | 'declined'>>
  lastUsable: { runtime: HarnessRuntimeChoice; provider: HarnessHostedProvider | null; model: string } | null
  mcpServers: HarnessMcpServerConfig[]
  ui: { showReasoning: boolean; compactProcess: boolean; density: 'comfortable' | 'compact' }
}

/** Stable preference key for one exact runtime/provider/model route. */
export function reasoningProfileKey(runtime: HarnessRuntimeChoice, provider: HarnessHostedProvider | null, model: string): string {
  return JSON.stringify([runtime, provider, model])
}

/** Read only an adapter/provider-declared exact effort list. We intentionally
 * do not infer levels from a model name or from a generic "thinking" flag. */
export function exactReasoningEfforts(value: unknown): HarnessReasoningEffort[] | undefined {
  const read = (candidate: unknown): HarnessReasoningEffort[] => {
    if (!Array.isArray(candidate)) return []
    const values = candidate.flatMap(item => {
      const raw = typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { id?: unknown }).id === 'string'
          ? (item as { id: string }).id
          : ''
      return HARNESS_REASONING_EFFORTS.includes(raw as HarnessReasoningEffort) ? [raw as HarnessReasoningEffort] : []
    })
    return [...new Set(values)]
  }
  const direct = read(value)
  if (direct.length) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  for (const key of ['efforts', 'reasoningEfforts', 'reasoning_efforts', 'supportedReasoningEfforts', 'supported_reasoning_efforts']) {
    const parsed = read(row[key])
    if (parsed.length) return parsed
  }
  return exactReasoningEfforts(row.reasoning)
}

export type HarnessLocalProbe = {
  runtime: HarnessRuntimeId
  endpoint: string
  available: boolean
  models: string[]
  modelLabels?: Record<string, string>
  detail: string
  discoveryState: 'runtime-unavailable' | 'runtime-available' | 'no-models' | 'models-discovered'
  capabilities: Array<{
    schemaVersion: 1
    runtime: HarnessRuntimeId
    modelId: string
    discovery: 'discovered'
    conversational: 'available' | 'unavailable'
    toolCall: 'supported' | 'unsupported' | 'unknown' | 'failed-conformance'
    streaming: 'supported' | 'unsupported' | 'unknown'
    reasoningEfforts?: HarnessReasoningEffort[]
    limitation: string
  }>
}

export type HarnessCredentialState = 'not-configured' | 'ready' | 'locked-unavailable' | 'invalid' | 'needs-reentry'
export type HarnessCredentialStatus = { provider: HarnessHostedProvider; state: HarnessCredentialState }
export type HarnessHostedModel = {
  id: string
  label: string
  state: 'discovered' | 'checking' | 'verified' | 'limited' | 'failed-conformance' | 'unavailable'
  limitation: string | null
  capabilities: { conversational: 'available' | 'unavailable' | 'unknown'; streaming: 'supported' | 'unsupported' | 'unknown'; toolCall: 'supported' | 'unsupported' | 'unknown' | 'failed-conformance' }
  reasoningEfforts?: HarnessReasoningEffort[]
}
export type HarnessHostedProbe = {
  provider: HarnessHostedProvider
  available: boolean
  models: HarnessHostedModel[]
  detail: string
  credentialState: HarnessCredentialState
}

const MAX_TEXT_CHARS = 32_000

function redactSensitiveText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|\b(?:file|vscode-file):\/\/[^\s"'<>|]+)/giu, '[redacted]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/giu, '[redacted]')
    .replace(/(?<![\p{L}\p{N}])(?:raw[_ -]?(?:prompt|response|source)|source[_ -]?(?:code|snippet|content))(?![\p{L}\p{N}])/giu, '[redacted]')
}

export function projectHarnessText(value: unknown, fallback = 'Harness could not produce a response.'): string {
  const raw = typeof value === 'string' && value.trim() ? value : fallback
  return redactSensitiveText(raw).slice(0, MAX_TEXT_CHARS)
}

export function projectHarnessId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/[^A-Za-z0-9._:\-]/gu, '').slice(0, 128)
}

export function projectHarnessRuntimeEvent(event: MetroraHarnessRuntimeEvent): MetroraHarnessRuntimeEvent {
  const projectDiff = (diff: HarnessFileDiff): HarnessFileDiff => ({
    path: projectHarnessText(diff.path, '[Workspace file]'),
    oldText: diff.oldText === null ? null : projectHarnessText(diff.oldText, ''),
    newText: projectHarnessText(diff.newText, ''),
  })
  const projectDetails = (details: HarnessToolDetails): HarnessToolDetails => {
    if (details.kind === 'read') return {
      kind: 'read', path: projectHarnessText(details.path, '[Workspace file]'),
      lines: details.lines.slice(0, 400).map(line => ({ number: line.number, text: projectHarnessText(line.text, '') })),
      totalLines: Math.max(0, Math.min(details.totalLines, 10_000)),
      ...(details.truncated ? { truncated: true } : {}),
    }
    if (details.kind === 'search') return {
      kind: 'search', total: Math.max(0, Math.min(details.total, 100_000)), truncated: details.truncated,
      ...(details.paths ? { paths: details.paths.slice(0, 400).map(path => projectHarnessText(path, '[Workspace file]')) } : {}),
      ...(details.files ? { files: details.files.slice(0, 200).map(file => ({ path: projectHarnessText(file.path, '[Workspace file]'), matches: file.matches.slice(0, 100).map(match => ({ lineNumber: match.lineNumber, line: projectHarnessText(match.line, '') })) })) } : {}),
    }
    if (details.kind === 'diff') return { kind: 'diff', diffs: details.diffs.slice(0, 64).map(projectDiff) }
    if (details.kind === 'terminal') return { kind: 'terminal', output: projectHarnessText(details.output, ''), ...(details.exitCode !== undefined ? { exitCode: details.exitCode } : {}), ...(details.signal ? { signal: projectHarnessText(details.signal, '') } : {}) }
    return { kind: 'web', ...(details.url ? { url: projectHarnessText(details.url, '') } : {}), ...(details.title ? { title: projectHarnessText(details.title, '') } : {}), ...(details.excerpt ? { excerpt: projectHarnessText(details.excerpt, '') } : {}) }
  }
  const projectProcess = (process: HarnessProcessItem): HarnessProcessItem => {
    if (process.kind === 'tool') return { kind: 'tool', item: {
      ...process.item,
      callId: projectHarnessId(process.item.callId),
      ...(process.item.rootCallId ? { rootCallId: projectHarnessId(process.item.rootCallId) } : {}),
      ...(process.item.parentCallId ? { parentCallId: projectHarnessId(process.item.parentCallId) } : {}),
      name: projectHarnessText(process.item.name, 'Tool'),
      inputSummary: projectHarnessText(process.item.inputSummary, 'Bounded Tool call'),
      ...(process.item.resultSummary ? { resultSummary: projectHarnessText(process.item.resultSummary, '') } : {}),
      ...(process.item.path ? { path: projectHarnessText(process.item.path, '[Workspace path]') } : {}),
      ...(process.item.command ? { command: projectHarnessText(process.item.command, '[command]') } : {}),
      ...(process.item.source ? { source: { kind: 'mcp' as const, serverName: projectHarnessText(process.item.source.serverName, 'MCP server'), toolName: projectHarnessText(process.item.source.toolName, 'Tool') } } : {}),
      ...(process.item.agentId ? { agentId: projectHarnessId(process.item.agentId) } : {}),
      ...(process.item.details ? { details: projectDetails(process.item.details) } : {}),
    } }
    if (process.kind === 'approval') return { kind: 'approval', item: {
      ...process.item, approvalId: projectHarnessId(process.item.approvalId), callId: process.item.callId ? projectHarnessId(process.item.callId) : null,
      toolName: projectHarnessText(process.item.toolName, 'Tool'), action: projectHarnessText(process.item.action, 'Approve this action.'), reason: projectHarnessText(process.item.reason, 'Metrora Shield requires approval.'),
      ...(process.item.workspacePath ? { workspacePath: projectHarnessText(process.item.workspacePath, '[Workspace path]') } : {}), ...(process.item.command ? { command: projectHarnessText(process.item.command, '[command]') } : {}),
    } }
    if (process.kind === 'agent') return { kind: 'agent', item: { ...process.item, agentId: projectHarnessId(process.item.agentId), ...(process.item.parentAgentId ? { parentAgentId: projectHarnessId(process.item.parentAgentId) } : {}), task: projectHarnessText(process.item.task, 'Delegated task'), ...(process.item.result ? { result: projectHarnessText(process.item.result, '') } : {}) } }
    if (process.kind === 'reasoning') return { kind: 'reasoning', id: projectHarnessId(process.id, 'reasoning'), text: projectHarnessText(process.text, ''), state: process.state }
    return { kind: 'status', id: projectHarnessId(process.id, 'status'), text: projectHarnessText(process.text, '') }
  }
  return {
    conversationId: projectHarnessId(event.conversationId),
    state: event.state,
    ...(event.requestId ? { requestId: projectHarnessId(event.requestId) } : {}),
    ...(event.kind ? { kind: event.kind } : {}),
    ...(event.text ? { text: projectHarnessText(event.text, '') } : {}),
    ...(event.process ? { process: projectProcess(event.process) } : {}),
    ...(event.conformance ? { conformance: { ...event.conformance, fingerprint: event.conformance.fingerprint ? projectHarnessId(event.conformance.fingerprint) : null, detail: event.conformance.detail ? projectHarnessText(event.conformance.detail, '') : null } } : {}),
  }
}
