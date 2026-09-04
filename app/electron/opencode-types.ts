export const OPENCODE_VERSION = '1.18.27' as const
export const OPENCODE_COMMIT = 'b04697366f05419e9bd7a92f841813dd976161c9' as const
export const OPENCODE_CUSTOM_TOOL_ID = 'metrora_usage_snapshot' as const

export type OpenCodeEngineState = 'idle' | 'starting' | 'ready' | 'stopping' | 'unavailable'

export type OpenCodeEngineStatus = {
  state: OpenCodeEngineState
  version: typeof OPENCODE_VERSION
  commit: typeof OPENCODE_COMMIT
  workspace: string | null
  customToolRegistered: boolean | null
  detail: string | null
  acpAvailable: boolean
}

export type OpenCodeModelVariant = {
  id: string
  label: string
}

export type OpenCodeModel = {
  id: string
  providerID: string
  name: string
  reasoning: boolean
  toolCall: boolean
  variants: OpenCodeModelVariant[]
}

export type OpenCodeProvider = {
  id: string
  name: string
  source: string
  connected: boolean
  models: OpenCodeModel[]
}

export type OpenCodeAgent = {
  name: string
  description: string | null
  mode: 'subagent' | 'primary' | 'all'
  builtIn: boolean
  model: { providerID: string; modelID: string } | null
  permission: { edit: string; bash: string }
}

export type OpenCodeSession = {
  id: string
  title: string
  directory: string
  parentID: string | null
  createdAt: number
  updatedAt: number
}

export type OpenCodeConversationPart = {
  id: string
  type: 'text' | 'reasoning' | 'tool' | 'subtask' | 'agent' | 'file' | 'patch' | 'step' | 'retry'
  text?: string
  tool?: string
  status?: string
  title?: string
  output?: string
  name?: string
  files?: string[]
}

export type OpenCodeConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  text: string
  model: { providerID: string; modelID: string } | null
  agent: string | null
  cost: number | null
  tokens: { input: number; output: number; reasoning: number } | null
  parts: OpenCodeConversationPart[]
}

export type OpenCodeRendererEvent =
  | { kind: 'message-delta'; sessionId: string; messageId: string; partId: string; text: string }
  | { kind: 'message-updated'; sessionId: string; messageId: string; role: 'user' | 'assistant'; finished: boolean }
  | { kind: 'tool'; sessionId: string; messageId: string; partId: string; tool: string; status: string; title: string | null }
  | { kind: 'agent'; sessionId: string; messageId: string; partId: string; name: string; description: string | null }
  | { kind: 'session-status'; sessionId: string; status: string }
  | { kind: 'permission'; sessionId: string; permissionId: string; type: string; title: string; pattern: string | null }
  | { kind: 'file-edited'; sessionId: string | null; file: string }
  | { kind: 'todo'; sessionId: string; pending: number; inProgress: number; completed: number }
  | { kind: 'diff'; sessionId: string; files: number; additions: number; deletions: number }
  | { kind: 'vcs'; branch: string | null }
  | { kind: 'error'; sessionId: string | null; message: string }

export type OpenCodeWorkspaceInfo = {
  directory: string | null
  worktree: string | null
  branch: string | null
  changedFiles: number
}

export type OpenCodeMcpServer = {
  id: string
  status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration' | 'unknown'
  error: string | null
}

export type OpenCodeTools = {
  ids: string[]
  customToolRegistered: boolean
}

export type OpenCodeModelRef = {
  providerID: string
  modelID: string
}

export type OpenCodePromptRequest = {
  requestId: string
  sessionId: string
  text: string
  model?: OpenCodeModelRef
  agent?: string
  variant?: string
}

export type OpenCodeLocalProviderConfig = {
  port: number
  modelId: string
}
