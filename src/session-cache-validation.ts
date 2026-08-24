import { CostAssignmentV1Schema, validatedCostAssignmentMatchesUsdV1 } from './pricing/cost-assignment.js'
import { HistoricalPricingContextV1Schema } from './pricing/pricing-context.js'
import type {
  CachedCall,
  CachedFile,
  CachedTurn,
  CachedUsage,
  FileFingerprint,
  ProviderSection,
  SessionCache,
} from './session-cache.js'

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(element => typeof element === 'string')
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalNum(value: unknown): boolean {
  return value === undefined || isNum(value)
}

function isOptionalBool(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isOptionalReasoningSemantics(value: unknown): boolean {
  return value === undefined
    || value === 'separate'
    || value === 'aggregate-output'
    || value === 'unavailable'
    || value === 'mixed'
}

function isOptionalCacheTokenEvidence(value: unknown): boolean {
  return value === undefined
    || value === 'complete'
    || value === 'partial'
    || value === 'unavailable'
    || value === 'inconsistent'
}
// A plain object whose every value is a string. Used for the sidechain
// `agentSpawnLinks` map (agentId -> spawn tool_use id).
function isOptionalStringRecord(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(element => typeof element === 'string')
}

function isToolCall(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const toolCall = value as Record<string, unknown>
  return typeof toolCall['tool'] === 'string'
    && isOptionalString(toolCall['file'])
    && isOptionalString(toolCall['command'])
}

function isToolCallArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isToolCall)
}

function validateFingerprint(value: unknown): value is FileFingerprint {
  if (!value || typeof value !== 'object') return false
  const fingerprint = value as Record<string, unknown>
  const wal = fingerprint['sqliteWal']
  return isNum(fingerprint['dev']) && isNum(fingerprint['ino'])
    && isNum(fingerprint['mtimeMs']) && isNum(fingerprint['sizeBytes'])
    && (wal === undefined || (
      !!wal && typeof wal === 'object'
      && isNum((wal as Record<string, unknown>)['mtimeMs'])
      && isNum((wal as Record<string, unknown>)['sizeBytes'])
    ))
}

function validateUsage(value: unknown): value is CachedUsage {
  if (!value || typeof value !== 'object') return false
  const usage = value as Record<string, unknown>
  return isNum(usage['inputTokens']) && isNum(usage['outputTokens'])
    && isNum(usage['cacheCreationInputTokens']) && isNum(usage['cacheReadInputTokens'])
    && isNum(usage['cachedInputTokens']) && isNum(usage['reasoningTokens'])
    && isNum(usage['webSearchRequests']) && isNum(usage['cacheCreationOneHourTokens'])
}

function validateCachedCostAssignment(assignmentValue: unknown, costValue: unknown): boolean {
  if (assignmentValue === undefined) return true
  const parsed = CostAssignmentV1Schema.safeParse(assignmentValue)
  if (!parsed.success) return false
  if (parsed.data.kind === 'unavailable') return costValue === undefined
  if (typeof costValue !== 'number' || !Number.isFinite(costValue) || costValue < 0) return false
  try {
    return validatedCostAssignmentMatchesUsdV1(parsed.data, costValue)
  } catch {
    return false
  }
}

function validateCall(value: unknown): value is CachedCall {
  if (!value || typeof value !== 'object') return false
  const call = value as Record<string, unknown>
  return typeof call['provider'] === 'string'
    && typeof call['model'] === 'string'
    && isOptionalString(call['modelProvider'])
    && (call['pricingContext'] === undefined || HistoricalPricingContextV1Schema.safeParse(call['pricingContext']).success)
    && isOptionalReasoningSemantics(call['reasoningSemantics'])
    && isOptionalCacheTokenEvidence(call['cacheTokenEvidence'])
    && typeof call['deduplicationKey'] === 'string'
    && typeof call['timestamp'] === 'string'
    && (call['speed'] === 'standard' || call['speed'] === 'fast')
    && isOptionalNum(call['costUSD'])
    && isOptionalNum(call['costCorrectionUSD'])
    && isOptionalNum(call['legacyCostUSD'])
    && validateCachedCostAssignment(call['costAssignment'], call['costUSD'])
    && isOptionalBool(call['isEstimated'])
    && isOptionalNum(call['activeDurationMs'])
    && isOptionalNum(call['activeGeneratedTokens'])
    && isOptionalNum(call['toolWaitMs'])
    && isStringArray(call['tools'])
    && isStringArray(call['bashCommands'])
    && isStringArray(call['skills'])
    && (call['subagentTypes'] === undefined || isStringArray(call['subagentTypes']))
    && isOptionalString(call['project'])
    && isOptionalString(call['projectPath'])
    && isOptionalString(call['workingDirectory'])
    && isOptionalString(call['nativeMessageId'])
    && isOptionalString(call['nativeEmissionTimestamp'])
    && isOptionalBool(call['nativeSnapshotTerminal'])
    && (call['toolSequence'] === undefined || (
      Array.isArray(call['toolSequence']) && call['toolSequence'].every(isToolCallArray)
    ))
    && isOptionalNum(call['locAdded'])
    && isOptionalNum(call['locRemoved'])
    && isOptionalBool(call['interrupted'])
    && isOptionalBool(call['userModified'])
    && isOptionalNum(call['toolErrors'])
    && isOptionalNum(call['editFailed'])
    && validateUsage(call['usage'])
}

function validateTurn(value: unknown): value is CachedTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Record<string, unknown>
  return typeof turn['timestamp'] === 'string'
    && typeof turn['sessionId'] === 'string'
    && typeof turn['userMessage'] === 'string'
    && isOptionalString(turn['gitBranch'])
    && (turn['prRefs'] === undefined || isStringArray(turn['prRefs']))
    && (turn['spawnToolUseIds'] === undefined || isStringArray(turn['spawnToolUseIds']))
    && Array.isArray(turn['calls'])
    && turn['calls'].every(validateCall)
}

export function validateCachedFile(value: unknown): value is CachedFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return validateFingerprint(file['fingerprint'])
    && isOptionalNum(file['lastCompleteLineOffset'])
    && isOptionalString(file['canonicalCwd'])
    && isOptionalString(file['workingDirectory'])
    && isOptionalString(file['canonicalProjectName'])
    && isStringArray(file['mcpInventory'])
    && isOptionalString(file['title'])
    && (file['prLinks'] === undefined || isStringArray(file['prLinks']))
    && isOptionalBool(file['isSidechain'])
    && isOptionalString(file['agentType'])
    && isOptionalBool(file['failed'])
    && isOptionalString(file['parentSessionId'])
    && isOptionalStringRecord(file['agentSpawnLinks'])
    && (file['ambiguousSpawnAgentIds'] === undefined || isStringArray(file['ambiguousSpawnAgentIds']))
    && Array.isArray(file['turns'])
    && file['turns'].every(validateTurn)
}

function validateProviderSection(value: unknown): value is ProviderSection {
  if (!value || typeof value !== 'object') return false
  const section = value as Record<string, unknown>
  if (typeof section['envFingerprint'] !== 'string') return false
  if (!section['files'] || typeof section['files'] !== 'object' || Array.isArray(section['files'])) return false
  return Object.values(section['files'] as Record<string, unknown>).every(validateCachedFile)
}

export function validateSessionCache(raw: unknown, expectedVersion: number): raw is SessionCache {
  if (!raw || typeof raw !== 'object') return false
  const cache = raw as Record<string, unknown>
  if (cache['version'] !== expectedVersion) return false
  if (!cache['providers'] || typeof cache['providers'] !== 'object' || Array.isArray(cache['providers'])) return false
  return Object.values(cache['providers'] as Record<string, unknown>).every(validateProviderSection)
}
