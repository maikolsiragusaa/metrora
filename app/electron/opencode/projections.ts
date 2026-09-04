import path from 'node:path'

import type { Agent, Message, Model, Part, Provider, Session } from '@opencode-ai/sdk/v2' with { "resolution-mode": "import" }

import { OpenCodeError } from './types'
import type {
  OpenCodeAgent,
  OpenCodeConversationMessage,
  OpenCodeConversationPart,
  OpenCodeModel,
  OpenCodeModelRef,
  OpenCodePermissionMetadata,
  OpenCodePermissionTool,
  OpenCodeProvider,
  OpenCodeProviderAuthMethod,
  OpenCodeProviderAuthMethods,
  OpenCodeQuestion,
  OpenCodeSession,
} from './types'

export const MAX_TEXT = 100_000
export const MAX_RENDERER_TEXT = 4_000
export const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/u

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new OpenCodeError('bad-args', `${label} is invalid`)
  return value
}

export function safeOptionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return safeId(value, label)
}

export function clampText(value: string, max = MAX_RENDERER_TEXT): string {
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

export function redactSnapshotValue(value: unknown, key = ''): unknown {
  if (SNAPSHOT_SECRET_KEY.test(key) || SNAPSHOT_PATH_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return clampText(value, 1_000)
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactSnapshotValue(item))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, redactSnapshotValue(childValue, childKey)]))
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  return undefined
}

export function projectMetroraUsageSnapshot(value: unknown, generatedAt = new Date().toISOString()): Record<string, unknown> {
  return { schemaVersion: 'metrora.usage-snapshot.v1', generatedAt, source: 'Metrora canonical status snapshot', data: redactSnapshotValue(value) }
}

export function relativeFile(workspace: string | null, value: unknown): string {
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

export function projectModel(providerID: string, modelID: string, value: Model | Record<string, unknown>): OpenCodeModel {
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

export function projectProvider(value: Provider | Record<string, unknown>, connected: Set<string>): OpenCodeProvider {
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

function projectAuthPrompt(value: unknown): OpenCodeProviderAuthMethod['prompts'][number] | null {
  if (!isRecord(value) || (value.type !== 'text' && value.type !== 'select') || typeof value.key !== 'string' || typeof value.message !== 'string') return null
  if (value.type === 'text') return { type: 'text', key: clampText(value.key, 120), message: clampText(value.message, 240), placeholder: typeof value.placeholder === 'string' ? clampText(value.placeholder, 160) : null }
  const options = Array.isArray(value.options) ? value.options.map(option => {
    const item = isRecord(option) ? option : {}
    return { label: clampText(safeString(item.label), 160), value: clampText(safeString(item.value), 160), hint: typeof item.hint === 'string' ? clampText(item.hint, 240) : null }
  }).filter(option => option.label && option.value).slice(0, 50) : []
  return { type: 'select', key: clampText(value.key, 120), message: clampText(value.message, 240), options }
}

export function projectProviderAuth(value: unknown): OpenCodeProviderAuthMethods {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([providerID, methods]) => [
    clampText(providerID, 120),
    (Array.isArray(methods) ? methods : []).map(method => {
      const item = isRecord(method) ? method : {}
      const prompts = Array.isArray(item.prompts) ? item.prompts.map(projectAuthPrompt).filter((prompt): prompt is OpenCodeProviderAuthMethod['prompts'][number] => Boolean(prompt)).slice(0, 20) : []
      return { type: item.type === 'oauth' ? 'oauth' : 'api', label: clampText(safeString(item.label, item.type === 'oauth' ? 'OAuth' : 'API key'), 200), prompts } as OpenCodeProviderAuthMethod
    }).slice(0, 20),
  ]))
}

export function projectAgent(value: Agent | Record<string, unknown>): OpenCodeAgent {
  const agent = value as Record<string, unknown>
  const permission = isRecord(agent.permission) ? agent.permission : {}
  const model = isRecord(agent.model) ? agent.model : null
  return {
    name: safeString(agent.name, 'agent').slice(0, 120),
    description: typeof agent.description === 'string' ? clampText(agent.description, 500) : null,
    mode: agent.mode === 'subagent' || agent.mode === 'primary' || agent.mode === 'all' ? agent.mode : 'all',
    builtIn: Boolean(agent.builtIn),
    model: model && typeof model.providerID === 'string' && typeof model.modelID === 'string' ? { providerID: model.providerID, modelID: model.modelID } : null,
    permission: { edit: safeString(permission.edit, 'ask'), bash: safeString(permission.bash, 'ask') },
  }
}

export function projectSession(value: Session | Record<string, unknown>): OpenCodeSession {
  const session = value as Record<string, unknown>
  const time = isRecord(session.time) ? session.time : {}
  const model = isRecord(session.model) && typeof session.model.providerID === 'string' && typeof session.model.id === 'string'
    ? { providerID: session.model.providerID, modelID: session.model.id }
    : null
  return {
    id: safeString(session.id),
    title: clampText(safeString(session.title, 'Untitled session'), 240),
    directory: safeString(session.directory),
    parentID: typeof session.parentID === 'string' ? session.parentID : null,
    createdAt: typeof time.created === 'number' ? time.created : 0,
    updatedAt: typeof time.updated === 'number' ? time.updated : 0,
    model,
    variant: isRecord(session.model) && typeof session.model.variant === 'string' ? safeId(session.model.variant, 'OpenCode variant') : null,
    agent: typeof session.agent === 'string' ? clampText(session.agent, 120) : null,
  }
}

export function projectPart(value: Part | Record<string, unknown>, workspace: string | null): OpenCodeConversationPart | null {
  const part = value as Record<string, unknown>
  const id = safeString(part.id, 'part')
  const type = safeString(part.type)
  if (type === 'text' || type === 'reasoning') return { id, type, text: redactOpenCodeText(part.text, MAX_RENDERER_TEXT) }
  if (type === 'tool') {
    const state = isRecord(part.state) ? part.state : {}
    const status = safeString(state.status, 'unknown')
    return { id, type: 'tool', tool: clampText(safeString(part.tool, 'tool'), 120), status, title: typeof state.title === 'string' ? clampText(state.title, 240) : undefined, output: status === 'completed' ? redactOpenCodeText(state.output, 2_000) : undefined }
  }
  if (type === 'subtask') return { id, type: 'subtask', name: clampText(safeString(part.agent, 'subagent'), 120), text: clampText(safeString(part.description), 500) }
  if (type === 'agent') return { id, type: 'agent', name: clampText(safeString(part.name, 'agent'), 120) }
  if (type === 'file') return { id, type: 'file', text: relativeFile(workspace, part.filename ?? (isRecord(part.source) ? part.source.path : undefined)) }
  if (type === 'patch') return { id, type: 'patch', files: Array.isArray(part.files) ? part.files.map(file => relativeFile(workspace, file)).slice(0, 50) : [] }
  if (type === 'step-start' || type === 'step-finish' || type === 'compaction') return { id, type: 'step', text: type }
  if (type === 'retry') return { id, type: 'retry', text: 'OpenCode retrying the provider request.' }
  return null
}

function messageText(parts: OpenCodeConversationPart[]): string {
  return parts.filter(part => part.type === 'text' || part.type === 'reasoning').map(part => part.text ?? '').filter(Boolean).join('\n\n')
}

export function projectMessage(value: { info: Message | Record<string, unknown>; parts: Array<Part | Record<string, unknown>> }, workspace: string | null): OpenCodeConversationMessage {
  const info = value.info as Record<string, unknown>
  const time = isRecord(info.time) ? info.time : {}
  const parts = value.parts.map(part => projectPart(part, workspace)).filter((part): part is OpenCodeConversationPart => Boolean(part))
  const model = isRecord(info.model) && typeof info.model.providerID === 'string' && typeof info.model.modelID === 'string'
    ? { providerID: info.model.providerID, modelID: info.model.modelID }
    : typeof info.providerID === 'string' && typeof info.modelID === 'string' ? { providerID: info.providerID, modelID: info.modelID } : null
  const tokens = isRecord(info.tokens) ? info.tokens : null
  return {
    id: safeString(info.id),
    role: info.role === 'user' ? 'user' : 'assistant',
    createdAt: typeof time.created === 'number' ? time.created : 0,
    text: messageText(parts),
    model,
    variant: typeof info.variant === 'string' ? safeId(info.variant, 'OpenCode variant') : null,
    agent: typeof info.agent === 'string' ? clampText(info.agent, 120) : typeof info.mode === 'string' ? clampText(info.mode, 120) : null,
    cost: typeof info.cost === 'number' ? info.cost : null,
    tokens: tokens && typeof tokens.input === 'number' && typeof tokens.output === 'number' ? { input: tokens.input, output: tokens.output, reasoning: typeof tokens.reasoning === 'number' ? tokens.reasoning : 0 } : null,
    parts,
  }
}

export function projectPermissionMetadata(value: unknown): OpenCodePermissionMetadata {
  const projected = redactSnapshotValue(value)
  return isRecord(projected) ? projected : {}
}

export function projectPermissionTool(value: unknown): OpenCodePermissionTool | null {
  if (!isRecord(value) || typeof value.messageID !== 'string' || typeof value.callID !== 'string') return null
  return { messageId: safeString(value.messageID).slice(0, 256), callId: safeString(value.callID).slice(0, 256) }
}

export function projectQuestions(value: unknown): OpenCodeQuestion[] {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    const question = isRecord(item) ? item : {}
    const options = Array.isArray(question.options) ? question.options.map(option => {
      const choice = isRecord(option) ? option : {}
      return { label: clampText(safeString(choice.label), 160), description: clampText(safeString(choice.description), 500) }
    }).filter(option => option.label).slice(0, 50) : []
    return { question: clampText(safeString(question.question), 1_000), header: clampText(safeString(question.header, 'OpenCode question'), 120), options, multiple: Boolean(question.multiple), custom: Boolean(question.custom) }
  }).filter(item => item.question && item.options.length > 0).slice(0, 20)
}
