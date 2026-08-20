import type { SqliteDatabase } from '../sqlite.js'
import type { CacheTokenEvidence } from '../token-semantics.js'

/** Attribute bag retained by the Copilot OTel SQLite reader. */
export type CopilotOtelSpanAttributes = {
  'gen_ai.operation.name'?: string
  'gen_ai.response.model'?: string
  'gen_ai.request.model'?: string
  'gen_ai.usage.input_tokens'?: number
  'gen_ai.usage.output_tokens'?: number
  'gen_ai.usage.cache_read.input_tokens'?: number
  'gen_ai.usage.cache_creation.input_tokens'?: number
  'gen_ai.usage.reasoning.output_tokens'?: number
  'gen_ai.usage.reasoning_tokens'?: number
  'gen_ai.conversation.id'?: string
  'gen_ai.agent.name'?: string
  'gen_ai.tool.name'?: string
  'gen_ai.tool.call.arguments'?: string
  'copilot_chat.parent_chat_session_id'?: string
  'github.copilot.chat.turn.id'?: string
  [key: string]: unknown
}

export type CopilotOtelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  cacheTokenEvidence: CacheTokenEvidence
  reasoningSemantics: 'aggregate-output'
}

type NumericAttributeEvidence = {
  present: boolean
  valid: boolean
  value: number
}

export function loadCopilotOtelSpanAttributes(
  db: SqliteDatabase,
  spanId: string,
): CopilotOtelSpanAttributes {
  try {
    const rows = db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM span_attributes WHERE span_id = ?`,
      [spanId],
    )
    const attrs: CopilotOtelSpanAttributes = {}
    for (const row of rows) {
      if (row.key && row.value) {
        try {
          const numeric = Number(row.value)
          attrs[row.key as keyof CopilotOtelSpanAttributes] = Number.isNaN(numeric)
            ? row.value
            : numeric
        } catch {
          attrs[row.key as keyof CopilotOtelSpanAttributes] = row.value
        }
      }
    }
    return attrs
  } catch {
    return {}
  }
}

function readNumericAttribute(attrs: CopilotOtelSpanAttributes, key: string): NumericAttributeEvidence {
  const raw = attrs[key]
  const present = raw !== undefined && raw !== null && raw !== ''
  if (!present) return { present: false, valid: false, value: 0 }

  const value = typeof raw === 'number' ? raw : Number(raw)
  const valid = Number.isFinite(value) && value >= 0
  return { present: true, valid, value: valid ? value : 0 }
}

/**
 * Normalize the verified Copilot OTel representation at the provider boundary.
 * The input field is cache-inclusive; every valid cache component known to be
 * included in it is removed, even when the other cache component is unknown.
 */
export function normalizeCopilotOtelUsage(attrs: CopilotOtelSpanAttributes): CopilotOtelUsage {
  const input = readNumericAttribute(attrs, 'gen_ai.usage.input_tokens')
  const output = readNumericAttribute(attrs, 'gen_ai.usage.output_tokens')
  const cacheRead = readNumericAttribute(attrs, 'gen_ai.usage.cache_read.input_tokens')
  const cacheCreation = readNumericAttribute(attrs, 'gen_ai.usage.cache_creation.input_tokens')

  const anyCachePresent = cacheRead.present || cacheCreation.present
  const invalidCacheField = (cacheRead.present && !cacheRead.valid) || (cacheCreation.present && !cacheCreation.valid)
  const knownCache = cacheRead.value + cacheCreation.value
  const cacheExceedsInput = input.valid && knownCache > input.value

  let cacheTokenEvidence: CacheTokenEvidence
  if (!input.valid || invalidCacheField || cacheExceedsInput) {
    cacheTokenEvidence = 'inconsistent'
  } else if (!anyCachePresent) {
    cacheTokenEvidence = 'unavailable'
  } else if (cacheRead.present && cacheCreation.present) {
    cacheTokenEvidence = 'complete'
  } else {
    cacheTokenEvidence = 'partial'
  }

  // An invalid or impossible cache component is not allowed into canonical
  // additive accounting. A valid subset remains useful when I is valid and
  // the subset fits inside I; the evidence status preserves the uncertainty.
  const canUseKnownCache = input.valid && knownCache <= input.value
  const normalizedCacheRead = canUseKnownCache ? cacheRead.value : 0
  const normalizedCacheCreation = canUseKnownCache ? cacheCreation.value : 0

  const reasoningCanonical = readNumericAttribute(attrs, 'gen_ai.usage.reasoning.output_tokens')
  const reasoningLegacy = readNumericAttribute(attrs, 'gen_ai.usage.reasoning_tokens')
  // Canonical evidence wins whenever the key is present, including an explicit
  // zero or malformed value. Legacy is only a bounded compatibility fallback.
  const reasoning = reasoningCanonical.present ? reasoningCanonical : reasoningLegacy

  return {
    inputTokens: input.valid ? input.value - normalizedCacheRead - normalizedCacheCreation : 0,
    outputTokens: output.value,
    cacheReadTokens: normalizedCacheRead,
    cacheCreationTokens: normalizedCacheCreation,
    reasoningTokens: reasoning.valid ? reasoning.value : 0,
    cacheTokenEvidence,
    reasoningSemantics: 'aggregate-output',
  }
}
