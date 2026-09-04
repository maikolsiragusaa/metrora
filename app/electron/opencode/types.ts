export const OPENCODE_VERSION = '1.18.27' as const
export const OPENCODE_COMMIT = 'b04697366f05419e9bd7a92f841813dd976161c9' as const
export const OPENCODE_CUSTOM_TOOL_ID = 'metrora_usage_snapshot' as const

export class OpenCodeError extends Error {
  constructor(public readonly kind: string, message: string) {
    super(message)
    this.name = 'OpenCodeError'
  }
}

export type OpenCodeEngineState = 'idle' | 'starting' | 'ready' | 'stopping' | 'unavailable'
export type OpenCodeEngineStatus = { state: OpenCodeEngineState; version: typeof OPENCODE_VERSION; commit: typeof OPENCODE_COMMIT; workspace: string | null; customToolRegistered: boolean | null; detail: string | null; acpAvailable: boolean }
export type OpenCodeModelVariant = { id: string; label: string }
export type OpenCodeModel = { id: string; providerID: string; name: string; reasoning: boolean; toolCall: boolean; variants: OpenCodeModelVariant[] }
export type OpenCodeProvider = { id: string; name: string; source: string; connected: boolean; models: OpenCodeModel[] }

export type OpenCodeProviderAuthPrompt =
  | { type: 'text'; key: string; message: string; placeholder: string | null }
  | { type: 'select'; key: string; message: string; options: Array<{ label: string; value: string; hint: string | null }> }
export type OpenCodeProviderAuthMethod = { type: 'oauth' | 'api'; label: string; prompts: OpenCodeProviderAuthPrompt[] }
export type OpenCodeProviderAuthMethods = Record<string, OpenCodeProviderAuthMethod[]>
export type OpenCodeProviderAuthAuthorization = { url: string; method: 'auto' | 'code'; instructions: string }

export type OpenCodeAgent = { name: string; description: string | null; mode: 'subagent' | 'primary' | 'all'; builtIn: boolean; model: { providerID: string; modelID: string } | null; permission: { edit: string; bash: string } }
export type OpenCodeModelRef = { providerID: string; modelID: string }
export type OpenCodeSession = { id: string; title: string; directory: string; parentID: string | null; createdAt: number; updatedAt: number; model: OpenCodeModelRef | null; variant: string | null; agent: string | null }

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
export type OpenCodeConversationMessage = { id: string; role: 'user' | 'assistant'; createdAt: number; text: string; model: OpenCodeModelRef | null; variant: string | null; agent: string | null; cost: number | null; tokens: { input: number; output: number; reasoning: number } | null; parts: OpenCodeConversationPart[] }

export type OpenCodePermissionMetadata = Record<string, unknown>
export type OpenCodePermissionTool = { messageId: string; callId: string }
export type OpenCodeQuestionOption = { label: string; description: string }
export type OpenCodeQuestion = { question: string; header: string; options: OpenCodeQuestionOption[]; multiple: boolean; custom: boolean }
export type OpenCodeRendererEvent =
  | { kind: 'message-delta'; sessionId: string; messageId: string; partId: string; field: string; text: string }
  | { kind: 'message-part-updated'; sessionId: string; messageId: string; partId: string; field: 'text' | 'reasoning'; text: string }
  | { kind: 'message-updated'; sessionId: string; messageId: string; role: 'user' | 'assistant'; finished: boolean }
  | { kind: 'tool'; sessionId: string; messageId: string; partId: string; tool: string; status: string; title: string | null }
  | { kind: 'agent'; sessionId: string; messageId: string; partId: string; name: string; description: string | null }
  | { kind: 'session-status'; sessionId: string; status: string }
  | { kind: 'permission'; sessionId: string; permissionId: string; permission: string; patterns: string[]; always: string[]; metadata: OpenCodePermissionMetadata; tool: OpenCodePermissionTool | null }
  | { kind: 'permission-replied'; sessionId: string; requestId: string; reply: 'once' | 'always' | 'reject' }
  | { kind: 'question-asked'; sessionId: string; requestId: string; questions: OpenCodeQuestion[]; tool: OpenCodePermissionTool | null }
  | { kind: 'question-replied'; sessionId: string; requestId: string }
  | { kind: 'question-rejected'; sessionId: string; requestId: string }
  | { kind: 'file-edited'; sessionId: string | null; file: string }
  | { kind: 'todo'; sessionId: string; pending: number; inProgress: number; completed: number }
  | { kind: 'diff'; sessionId: string; files: number; additions: number; deletions: number }
  | { kind: 'vcs'; branch: string | null }
  | { kind: 'error'; sessionId: string | null; message: string }

export type OpenCodeWorkspaceInfo = { directory: string | null; worktree: string | null; branch: string | null; changedFiles: number }
export type OpenCodeMcpServer = { id: string; status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration' | 'unknown'; error: string | null }
export type OpenCodeTools = { ids: string[]; customToolRegistered: boolean }
export type OpenCodePromptRequest = { requestId: string; sessionId: string; text: string; model?: OpenCodeModelRef; agent?: string; variant?: string }
export type OpenCodeLocalProviderConfig = { port: number; modelId: string }
