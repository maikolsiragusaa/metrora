type RecordValue = Record<string, unknown>

export type AdvisorRuntimeMessageMode = 'native' | 'flattened'

function isRecord(value: unknown): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)
}

function messageContent(message: RecordValue): string {
  return typeof message.content === 'string' ? message.content : ''
}

function rawCalls(message: RecordValue): unknown[] {
  const value = message.toolCalls ?? message.tool_calls
  return Array.isArray(value) ? value : []
}

function callParts(value: unknown, fallbackId: string): { id: string; name: string; arguments: string } {
  if (!isRecord(value)) throw new Error('Local runtime request contains a malformed tool call.')
  const fn = isRecord(value.function) ? value.function : value
  if (typeof fn.name !== 'string' || !fn.name.trim()) throw new Error('Local runtime request contains a malformed tool call.')
  const args = fn.arguments
  const encoded = typeof args === 'string' ? args : JSON.stringify(args ?? {})
  if (typeof encoded !== 'string') throw new Error('Local runtime request contains malformed tool arguments.')
  const hasId = Object.prototype.hasOwnProperty.call(value, 'id')
  if (hasId && !validId(value.id)) throw new Error('Local runtime request contains an invalid tool-call ID.')
  const id = hasId ? value.id as string : fallbackId
  return { id, name: fn.name, arguments: encoded }
}

function nativeCallList(message: RecordValue, nextId: () => string): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
  return rawCalls(message).slice(0, 16).map((value, index) => {
    const call = callParts(value, nextId() || 'metrora_call_' + index)
    return { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }
  })
}

function flattenedMessages(messages: Array<RecordValue>): Array<RecordValue> {
  return messages.map(message => {
    if (message.role === 'tool') {
      return { role: 'user', content: 'Metrora Tool result' + (typeof message.toolName === 'string' ? ' (' + message.toolName + ')' : '') + ': ' + messageContent(message) }
    }
    if (message.role === 'assistant' && rawCalls(message).length) {
      const calls = rawCalls(message).slice(0, 16).map((value, index) => {
        const call = callParts(value, 'metrora_call_' + index)
        return call.name + ' ' + call.arguments
      }).join('; ')
      return { role: 'assistant', content: [messageContent(message), 'Metrora read request: ' + calls].filter(Boolean).join('\n') }
    }
    return { role: message.role, content: messageContent(message) }
  })
}

/**
 * Translate the semantic ledger to an OpenAI-compatible local endpoint. The
 * exact call ID from Metrora is retained; legacy raw wire-shaped test input
 * receives a bounded deterministic ID only when it omitted one.
 */
export function openAICompatibleMessages(messages: Array<Record<string, unknown>>, mode: AdvisorRuntimeMessageMode = 'native'): Array<Record<string, unknown>> {
  const normalized = messages.map(message => {
    if (!isRecord(message)) throw new Error('Local runtime request contains a malformed message.')
    return message
  })
  if (mode === 'flattened') return flattenedMessages(normalized)
  const pendingCallIds: string[] = []
  let next = 0
  const nextId = () => 'metrora_call_' + next++
  return normalized.map(message => {
    if (message.role === 'assistant' && rawCalls(message).length) {
      const toolCalls = nativeCallList(message, nextId)
      pendingCallIds.push(...toolCalls.map(call => call.id))
      return { role: 'assistant', content: messageContent(message), tool_calls: toolCalls }
    }
    if (message.role === 'tool') {
      const supplied = message.toolCallId ?? message.tool_call_id
      const toolCallId = validId(supplied) ? supplied : pendingCallIds.shift() ?? nextId()
      const index = pendingCallIds.indexOf(toolCallId)
      if (index >= 0) pendingCallIds.splice(index, 1)
      return { role: 'tool', content: messageContent(message), tool_call_id: toolCallId, ...(typeof message.toolName === 'string' ? { name: message.toolName } : {}) }
    }
    return { role: message.role, content: messageContent(message) }
  })
}

/** Ollama's native API uses the same roles but function arguments as objects. */
export function ollamaMessages(messages: Array<Record<string, unknown>>, mode: AdvisorRuntimeMessageMode = 'native'): Array<Record<string, unknown>> {
  const normalized = messages.map(message => {
    if (!isRecord(message)) throw new Error('Local runtime request contains a malformed message.')
    return message
  })
  if (mode === 'flattened') return flattenedMessages(normalized)
  let next = 0
  const nextId = () => 'metrora_call_' + next++
  return normalized.map(message => {
    if (message.role === 'assistant' && rawCalls(message).length) {
      const toolCalls = nativeCallList(message, nextId).map(call => ({
        id: call.id,
        function: {
          name: call.function.name,
          arguments: (() => {
            try {
              const parsed = JSON.parse(call.function.arguments) as unknown
              return isRecord(parsed) ? parsed : {}
            } catch {
              return {}
            }
          })(),
        },
      }))
      return { role: 'assistant', content: messageContent(message), tool_calls: toolCalls }
    }
    if (message.role === 'tool') return { role: 'tool', content: messageContent(message) }
    return { role: message.role, content: messageContent(message) }
  })
}

export function hasRuntimeToolCalls(message: Record<string, unknown>): boolean {
  return message.toolCalls !== undefined || message.tool_calls !== undefined
}

export function runtimeToolCallCount(message: Record<string, unknown>): number {
  return rawCalls(message).length
}
