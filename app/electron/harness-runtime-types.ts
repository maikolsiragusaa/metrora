/**
 * Main-process boundary types for the Metrora Harness runtime.
 *
 * These are deliberately product-facing projections. Upstream runtime events,
 * provider payloads, tool arguments, and session paths never cross this
 * boundary as-is.
 */

export type HarnessRuntimeId = 'ollama' | 'lmstudio' | 'llama-server'

export type HarnessLifecycleState =
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'running-agent'
  | 'waiting-approval'
  | 'preparing'
  | 'done'
  | 'cancelled'
  | 'failed'

export type MetroraHarnessRuntimeEvent = {
  conversationId: string
  state: HarnessLifecycleState
  requestId?: string
}

export type HarnessConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type HarnessConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  model: string
  runtime: HarnessRuntimeId
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
  runtime: HarnessRuntimeId
  model: string
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
  runtime: HarnessRuntimeId
  model: string
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
  return value.replace(/[^A-Za-z0-9._:-]/gu, '').slice(0, 128)
}

export function projectHarnessRuntimeEvent(event: MetroraHarnessRuntimeEvent): MetroraHarnessRuntimeEvent {
  return {
    conversationId: projectHarnessId(event.conversationId),
    state: event.state,
    ...(event.requestId ? { requestId: projectHarnessId(event.requestId) } : {}),
  }
}
