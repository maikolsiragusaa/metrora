/**
 * Small provider-neutral contracts for one bounded Metrora agent turn.
 *
 * The loop owns the ledger and lifecycle. Provider adapters only translate
 * these normalized entries to their wire format; they never become tool or
 * evidence authority.
 */

export type MetroraAgentToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type MetroraAgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: readonly MetroraAgentToolCall[]
  toolCallId?: string
  toolName?: string
}

export type MetroraAgentModelStep = {
  kind: 'final-text' | 'tool-calls'
  content: string
  calls: readonly MetroraAgentToolCall[]
  streamed?: boolean
}

export type MetroraAgentToolResult = {
  content: string
  evidence?: unknown
  evidenceStatus?: 'usable' | 'partial' | 'unavailable'
  unavailable?: boolean
}

export type MetroraAgentLoopBounds = {
  /** Maximum provider/model completions in one turn. */
  maxSteps: number
  /** Maximum model-requested calls accepted from one completion. */
  maxCallsPerStep: number
  /** Maximum canonical reads dispatched in one turn, including a baseline. */
  maxCallsPerTurn: number
  /** Maximum model steps which may contain tool calls. */
  maxToolRounds: number
  /** Maximum concurrently dispatched read calls. Sequential is the default. */
  maxParallelToolCalls: number
  /** One deadline covers model calls, reads, and final continuation. */
  turnTimeoutMs: number
  /** Maximum bytes for one model/tool content value. */
  maxContentBytes: number
  /** Maximum entries retained in the in-memory turn ledger. */
  maxLedgerMessages: number
}

export type MetroraAgentLoopEventType =
  | 'turn-started'
  | 'model-started'
  | 'model-completed'
  | 'tool-queued'
  | 'tool-started'
  | 'tool-completed'
  | 'tool-unavailable'
  | 'tool-failed'
  | 'turn-completed'
  | 'turn-failed'
  | 'turn-cancelled'
  | 'turn-timeout'

export type MetroraAgentLoopEvent = {
  type: MetroraAgentLoopEventType
  turnId: string
  step?: number
  tool?: string
  callId?: string
  detail?: string
  at: string
}

export type MetroraAgentLoopStatus = 'completed' | 'failed' | 'cancelled' | 'timeout' | 'limit'

export type MetroraAgentLoopResult = {
  status: MetroraAgentLoopStatus
  finalText: string
  streamed: boolean
  evidence: unknown[]
  ledger: readonly MetroraAgentMessage[]
  modelSteps: number
  toolCalls: number
  toolRounds: number
  diagnostics: readonly string[]
}

export type MetroraAgentModelContext = {
  readonly ledger: readonly MetroraAgentMessage[]
  readonly tools: readonly unknown[]
  readonly step: number
  readonly signal: AbortSignal
}

export type MetroraAgentToolValidation =
  | { ok: true; call: MetroraAgentToolCall }
  | { ok: false; diagnostic: string; detail?: string }

export type MetroraAgentLoopOptions = {
  turnId?: string
  now?: () => string
  signal?: AbortSignal
  bounds: MetroraAgentLoopBounds
  ledger: readonly MetroraAgentMessage[]
  tools: readonly unknown[]
  /** Controller-authorized minimum reads, not model-authored capabilities. */
  requiredToolCalls?: readonly MetroraAgentToolCall[]
  /** True only when the initial ledger already contains usable canonical evidence. */
  requiredEvidenceReady?: boolean
  complete: (context: MetroraAgentModelContext) => Promise<MetroraAgentModelStep>
  validateToolCall?: (call: MetroraAgentToolCall) => MetroraAgentToolValidation
  executeTool: (call: MetroraAgentToolCall, signal: AbortSignal) => Promise<MetroraAgentToolResult>
  onEvent?: (event: MetroraAgentLoopEvent) => void
  cancelModel?: () => void
}
