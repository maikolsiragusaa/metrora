import type { AdvisorHostedContinuation } from './advisor-provider-contract'
import {
  MAX_TEXT_BYTES,
  MAX_TOOL_ARGUMENT_BYTES,
  TOOL_NAMES,
  byteLength,
  isRecord,
  validModel,
  validProvider,
  validRequestId,
} from './advisor-provider-contract'

const MAX_CONTINUATION_BYTES = 64 * 1024
const MAX_CONTINUATION_MESSAGES = 4
const MAX_CONTINUATION_PARTS = 32

export function validReasoningEffort(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,32}$/u.test(value)
}

function continuationPart(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'text' || value.type === 'reasoning') {
    return typeof value.text === 'string' && byteLength(value.text) <= MAX_TEXT_BYTES
      ? { type: value.type, text: value.text }
      : null
  }
  if (value.type !== 'tool-call' || !validRequestId(value.toolCallId) || typeof value.toolName !== 'string' || !TOOL_NAMES.has(value.toolName)) return null
  const input = value.input
  let normalizedInput: Record<string, unknown>
  if (isRecord(input)) normalizedInput = input
  else if (typeof input === 'string') {
    if (byteLength(input) > MAX_TOOL_ARGUMENT_BYTES) return null
    try {
      const parsed = JSON.parse(input) as unknown
      if (!isRecord(parsed)) return null
      normalizedInput = parsed
    } catch {
      return null
    }
  } else return null
  try {
    const encoded = JSON.stringify(normalizedInput)
    if (byteLength(encoded) > MAX_TOOL_ARGUMENT_BYTES) return null
  } catch {
    return null
  }
  return { type: 'tool-call', toolCallId: value.toolCallId, toolName: value.toolName, input: normalizedInput }
}

/**
 * Accept only the small continuation subset needed to replay an assistant
 * reasoning/tool turn. Provider metadata, raw chunks, and hidden payloads are
 * intentionally dropped before this value is retained or sent back.
 */
export function normalizeHostedContinuation(value: unknown): AdvisorHostedContinuation | null {
  if (!isRecord(value) || !validProvider(value.provider) || !validModel(value.model) || value.protocol !== 'openai-chat' || value.adapter !== 'ai-sdk-openai-compatible-v1' || !Array.isArray(value.responseMessages) || value.responseMessages.length > MAX_CONTINUATION_MESSAGES) return null
  const responseMessages: Record<string, unknown>[] = []
  for (const message of value.responseMessages) {
    if (!isRecord(message) || message.role !== 'assistant') return null
    const rawContent = message.content
    const parts = typeof rawContent === 'string' ? [{ type: 'text', text: rawContent }] : rawContent
    if (!Array.isArray(parts) || parts.length > MAX_CONTINUATION_PARTS) return null
    const normalizedParts = parts.map(part => continuationPart(part)).filter((part): part is Record<string, unknown> => part !== null)
    if (normalizedParts.length !== parts.length) return null
    if (!normalizedParts.some(part => part.type === 'tool-call')) continue
    responseMessages.push({ role: 'assistant', content: normalizedParts })
  }
  if (!responseMessages.length) return null
  const normalized: AdvisorHostedContinuation = {
    provider: value.provider,
    model: value.model,
    protocol: 'openai-chat',
    adapter: 'ai-sdk-openai-compatible-v1',
    responseMessages,
  }
  try {
    if (byteLength(JSON.stringify(normalized)) > MAX_CONTINUATION_BYTES) return null
  } catch {
    return null
  }
  return normalized
}
