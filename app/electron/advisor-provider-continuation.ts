import type {
  AdvisorHostedContinuationReference,
  AdvisorHostedProviderId,
} from './advisor-provider-contract'
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

export const HOSTED_CONTINUATION_ADAPTER = 'ai-sdk-openai-compatible-v1' as const
export const MAX_HOSTED_CONTINUATION_PAYLOAD_BYTES = 64 * 1024
export const MAX_HOSTED_CONTINUATION_MESSAGES = 4
export const MAX_HOSTED_CONTINUATION_PARTS = 32

/** Main-process-only payload. Never add this shape to a renderer/IPC contract. */
export type AdvisorHostedContinuationPayload = {
  readonly provider: AdvisorHostedProviderId
  readonly model: string
  readonly protocol: 'openai-chat'
  readonly adapter: typeof HOSTED_CONTINUATION_ADAPTER
  readonly responseMessages: readonly Record<string, unknown>[]
}

export function validReasoningEffort(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,32}$/u.test(value)
}

function validContinuationReferenceKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === 5 && keys.every(key => key === 'id' || key === 'provider' || key === 'model' || key === 'protocol' || key === 'adapter')
}

/**
 * Parse the only continuation shape allowed through IPC. In particular, a
 * responseMessages/providerMetadata field makes the value invalid instead of
 * being silently copied or stripped at the boundary.
 */
export function normalizeHostedContinuationReference(value: unknown): AdvisorHostedContinuationReference | null {
  if (!isRecord(value) || !validContinuationReferenceKeys(value) || !validRequestId(value.id) || !validProvider(value.provider) || !validModel(value.model) || value.protocol !== 'openai-chat' || value.adapter !== HOSTED_CONTINUATION_ADAPTER) return null
  return {
    id: value.id,
    provider: value.provider,
    model: value.model,
    protocol: 'openai-chat',
    adapter: HOSTED_CONTINUATION_ADAPTER,
  }
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
    if (!encoded || byteLength(encoded) > MAX_TOOL_ARGUMENT_BYTES) return null
  } catch {
    return null
  }
  return { type: 'tool-call', toolCallId: value.toolCallId, toolName: value.toolName, input: normalizedInput }
}

/**
 * Accept only the small continuation subset needed to replay an assistant
 * reasoning/tool turn. Provider metadata, raw chunks, and hidden payloads are
 * intentionally dropped before this value is retained in Electron memory.
 */
export function normalizeHostedContinuationPayload(value: unknown): AdvisorHostedContinuationPayload | null {
  if (!isRecord(value) || !validProvider(value.provider) || !validModel(value.model) || value.protocol !== 'openai-chat' || value.adapter !== HOSTED_CONTINUATION_ADAPTER || !Array.isArray(value.responseMessages) || value.responseMessages.length > MAX_HOSTED_CONTINUATION_MESSAGES) return null
  const responseMessages: Record<string, unknown>[] = []
  for (const message of value.responseMessages) {
    if (!isRecord(message) || message.role !== 'assistant') return null
    const rawContent = message.content
    const parts = typeof rawContent === 'string' ? [{ type: 'text', text: rawContent }] : rawContent
    if (!Array.isArray(parts) || parts.length > MAX_HOSTED_CONTINUATION_PARTS) return null
    const normalizedParts = parts.map(part => continuationPart(part)).filter((part): part is Record<string, unknown> => part !== null)
    if (normalizedParts.length !== parts.length) return null
    if (!normalizedParts.some(part => part.type === 'tool-call')) continue
    responseMessages.push({ role: 'assistant', content: normalizedParts })
  }
  if (!responseMessages.length) return null
  const normalized: AdvisorHostedContinuationPayload = {
    provider: value.provider,
    model: value.model,
    protocol: 'openai-chat',
    adapter: HOSTED_CONTINUATION_ADAPTER,
    responseMessages,
  }
  try {
    if (byteLength(JSON.stringify(normalized)) > MAX_HOSTED_CONTINUATION_PAYLOAD_BYTES) return null
  } catch {
    return null
  }
  return normalized
}
