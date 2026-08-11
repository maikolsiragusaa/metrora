import { classifyTurn } from './classifier.js'
import type { CachedTurn } from './session-cache.js'
import type { ClassifiedTurn, DateRange, ParsedApiCall, ParsedTurn } from './types.js'

export function callIsInDateRange(call: Pick<ParsedApiCall, 'timestamp'>, dateRange: DateRange): boolean {
  const timestampMs = Date.parse(call.timestamp)
  if (!Number.isFinite(timestampMs)) return false
  return timestampMs >= dateRange.start.getTime() && timestampMs <= dateRange.end.getTime()
}

export function sliceParsedTurnToDateRange(turn: ParsedTurn, dateRange: DateRange): ParsedTurn | null {
  const assistantCalls = turn.assistantCalls.filter(call => callIsInDateRange(call, dateRange))
  if (assistantCalls.length === 0) return null
  if (assistantCalls.length === turn.assistantCalls.length) return turn
  return { ...turn, assistantCalls }
}

export function sliceClassifiedTurnToDateRange(turn: ClassifiedTurn, dateRange: DateRange): ClassifiedTurn | null {
  const sliced = sliceParsedTurnToDateRange(turn, dateRange)
  return sliced ? classifyTurn(sliced) : null
}

export function sliceCachedTurnToDateRange(turn: CachedTurn, dateRange: DateRange): CachedTurn | null {
  const calls = turn.calls.filter(call => callIsInDateRange(call, dateRange))
  if (calls.length === 0) return null
  if (calls.length === turn.calls.length) return turn
  return { ...turn, calls }
}
