import type { OpenCodeRendererEvent } from './types'
import {
  clampText,
  isRecord,
  projectPermissionMetadata,
  projectPermissionTool,
  projectQuestions,
  redactOpenCodeText,
  relativeFile,
  safeString,
} from './projections'

function eventSessionId(properties: Record<string, unknown>, info: Record<string, unknown> = {}): string | null {
  return typeof properties.sessionID === 'string' ? properties.sessionID : typeof info.sessionID === 'string' ? info.sessionID : null
}

function stringList(value: unknown, max = 50, itemMax = 500): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => clampText(item, itemMax)).slice(0, max) : []
}

function projectPartUpdate(properties: Record<string, unknown>, workspace: string | null): OpenCodeRendererEvent | null {
  const part = isRecord(properties.part) ? properties.part : {}
  const sessionId = eventSessionId(properties)
  const partId = typeof part.id === 'string' ? part.id : null
  if (!sessionId || !partId) return null
  const messageId = safeString(part.messageID)
  if (part.type === 'text' || part.type === 'reasoning') {
    return { kind: 'message-part-updated', sessionId, messageId, partId, field: part.type, text: redactOpenCodeText(part.text) }
  }
  if (part.type === 'tool') {
    const state = isRecord(part.state) ? part.state : {}
    return { kind: 'tool', sessionId, messageId, partId, tool: clampText(safeString(part.tool, 'tool'), 120), status: clampText(safeString(state.status, 'unknown'), 80), title: typeof state.title === 'string' ? clampText(state.title, 240) : null }
  }
  if (part.type === 'agent') return { kind: 'agent', sessionId, messageId, partId, name: clampText(safeString(part.name, 'agent'), 120), description: typeof part.description === 'string' ? clampText(part.description, 500) : null }
  if (part.type === 'file' || part.type === 'patch') return { kind: 'file-edited', sessionId, file: relativeFile(workspace, part.filename ?? part.file) }
  return null
}

/** Projects only the pinned v1.18.27 global-event payload. */
export function projectOpenCodeEvent(value: unknown, workspace: string | null): OpenCodeRendererEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const properties = isRecord(value.properties) ? value.properties : {}
  const info = isRecord(properties.info) ? properties.info : {}
  const sessionId = eventSessionId(properties, info)
  switch (value.type) {
    case 'message.part.delta':
      return sessionId && typeof properties.messageID === 'string' && typeof properties.partID === 'string' && typeof properties.field === 'string' && typeof properties.delta === 'string'
        ? { kind: 'message-delta', sessionId, messageId: properties.messageID, partId: properties.partID, field: properties.field, text: redactOpenCodeText(properties.delta) }
        : null
    case 'message.part.updated':
      return projectPartUpdate(properties, workspace)
    case 'message.updated':
      return sessionId && typeof info.id === 'string'
        ? { kind: 'message-updated', sessionId, messageId: info.id, role: info.role === 'user' ? 'user' : 'assistant', finished: isRecord(info.time) && typeof info.time.completed === 'number' }
        : null
    case 'session.status':
      return sessionId ? { kind: 'session-status', sessionId, status: isRecord(properties.status) ? safeString(properties.status.type, 'unknown') : 'unknown' } : null
    case 'session.idle':
      return sessionId ? { kind: 'session-status', sessionId, status: 'idle' } : null
    case 'permission.asked':
      return sessionId && typeof properties.id === 'string'
        ? { kind: 'permission', sessionId, permissionId: properties.id, permission: clampText(safeString(properties.permission, 'permission'), 160), patterns: stringList(properties.patterns), always: stringList(properties.always), metadata: projectPermissionMetadata(properties.metadata), tool: projectPermissionTool(properties.tool) }
        : null
    case 'permission.replied':
      return sessionId && typeof properties.requestID === 'string' && (properties.reply === 'once' || properties.reply === 'always' || properties.reply === 'reject')
        ? { kind: 'permission-replied', sessionId, requestId: properties.requestID, reply: properties.reply }
        : null
    case 'question.asked':
      return sessionId && typeof properties.id === 'string'
        ? { kind: 'question-asked', sessionId, requestId: properties.id, questions: projectQuestions(properties.questions), tool: projectPermissionTool(properties.tool) }
        : null
    case 'question.replied':
      return sessionId && typeof properties.requestID === 'string' ? { kind: 'question-replied', sessionId, requestId: properties.requestID } : null
    case 'question.rejected':
      return sessionId && typeof properties.requestID === 'string' ? { kind: 'question-rejected', sessionId, requestId: properties.requestID } : null
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
      return { kind: 'diff', sessionId, files: diff.length, additions: diff.reduce((sum, file) => sum + (isRecord(file) && typeof file.additions === 'number' ? file.additions : 0), 0), deletions: diff.reduce((sum, file) => sum + (isRecord(file) && typeof file.deletions === 'number' ? file.deletions : 0), 0) }
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

export function projectOpenCodeEventForRenderer(value: unknown, workspace: string | null = null): OpenCodeRendererEvent | null {
  return projectOpenCodeEvent(value, workspace)
}
