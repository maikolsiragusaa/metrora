import type { ReasoningTokenSemantics } from './model-projection-types'
import type { ReasoningMix } from './types'

export type SessionRow = {
  sessionId: string
  /** Provider + exact id + project/source authority; never raw id alone. */
  sessionKey?: string
  // Captured human title (src/sessions-report.ts). Empty string when the
  // transcript produced none; optional so older CLIs that predate the field
  // render unchanged (the row falls back to the project as its primary label).
  title?: string
  project: string
  provider: string
  models: string[]
  cost: number
  savingsUSD: number
  calls: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
  reasoningSemantics?: ReasoningTokenSemantics
  reasoningMix?: ReasoningMix
  startedAt: string
  endedAt: string
  durationMs: number
}

export type ModelStats = {
  model: string
  presentationIdentity?: string
  calls: number
  cost: number
  outputTokens: number
  reasoningTokens?: number
  additiveReasoningTokens?: number
  reasoningSemantics?: ReasoningTokenSemantics
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTurns: number
  editTurns: number
  oneShotTurns: number
  retries: number
  selfCorrections: number
  editCost: number
  firstSeen: string
  lastSeen: string
}
