import { readdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { homedir } from 'os'

import { readSessionFile } from '../fs-utils.js'
import { calculateCost, getModelCosts, getShortModelName } from '../models.js'
import { extractBashCommands } from '../bash-utils.js'
import { combineReasoningSemantics, type CacheTokenEvidence, type ReasoningTokenSemantics } from '../token-semantics.js'
import type { Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'

// Grok Build (xAI's coding CLI) stores one session per directory at
// <grok-home>/sessions/<url-encoded-cwd>/<uuid>/, where grok-home is $GROK_HOME
// or ~/.grok. Each session dir holds summary.json, signals.json, and the ACP
// log updates.jsonl.
//
// Newer Grok CLI versions append a `turn_completed` update with provider-recorded
// input/output/cache/reasoning usage. That record is the best accounting evidence
// available: Grok's input is cache-inclusive and explicitly reported reasoning is
// a subset of output; absent reasoning evidence remains unavailable.
// Older sessions only carry the running `_meta.totalTokens` curve, so the
// compaction-aware estimate below remains the compatibility path. `costUsdTicks`
// is deliberately ignored because its unit is undocumented.

const toolNameMap: Record<string, string> = {
  bash: 'Bash',
  run_terminal_command: 'Bash',
  read_file: 'Read',
  read: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  edit: 'Edit',
  list_dir: 'Glob',
  glob: 'Glob',
  grep: 'Grep',
  search: 'WebSearch',
  web_search: 'WebSearch',
  fetch: 'WebFetch',
  task: 'Agent',
  search_replace: 'Edit',
  todo_write: 'TodoWrite',
  spawn_subagent: 'Agent',
}

function defaultSessionsDir(): string {
  const home = process.env['GROK_HOME'] ?? join(homedir(), '.grok')
  return join(home, 'sessions')
}

type GrokSummary = {
  info?: { id?: string; cwd?: string }
  created_at?: string
  updated_at?: string
  last_active_at?: string
  current_model_id?: string
  session_summary?: string
  generated_title?: string
}

type GrokSignals = {
  primaryModelId?: string
  modelsUsed?: string[]
  toolsUsed?: string[]
}

async function readJson<T>(path: string): Promise<T | null> {
  const content = await readSessionFile(path)
  if (content === null) return null
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

// updates.jsonl is one ACP JSON-RPC notification per line. Streamed chunks carry
// params._meta.{totalTokens, promptId}; completed turns carry snake_case
// params.update.{prompt_id, usage}.
type GrokUpdate = {
  params?: {
    _meta?: { totalTokens?: unknown; promptId?: unknown }
    update?: {
      sessionUpdate?: unknown
      prompt_id?: unknown
      usage?: unknown
      title?: unknown
      rawInput?: { command?: unknown; subagent_type?: unknown }
    }
  }
}

type GrokUsageValues = {
  /** Canonical uncached input after provider-boundary normalization. */
  inputTokens: number
  /** Grok's provider-reported output, inclusive of reasoning. */
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Factual reasoning, bounded to output when explicitly reported. */
  reasoningTokens: number
  /** Whether this record explicitly evidenced reasoning as an output subset. */
  reasoningSemantics: ReasoningTokenSemantics
  cacheTokenEvidence: CacheTokenEvidence
  /** Input and output were both explicitly valid numeric top-level fields. */
  topLevelAccountingComplete: boolean
  /** At least one normalized accounting bucket contributes to the subtotal. */
  hasPositiveAccountingUsage: boolean
  /** Actual model ids from modelUsage, used only for session attribution. */
  modelIds: string[]
}

type GrokTokenTotals = {
  input: number
  cacheRead: number
  output: number
  cacheCreation: number
  reasoning: number
}

type GrokCompletedUsage = GrokUsageValues | null

function emptyTokenTotals(): GrokTokenTotals {
  return { input: 0, cacheRead: 0, output: 0, cacheCreation: 0, reasoning: 0 }
}

const MAX_SAFE_TOKEN_COUNT = Number.MAX_SAFE_INTEGER

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type NumericEvidence = {
  present: boolean
  valid: boolean
  value: number
}

// JSONL is third-party input. Keep the check local to this provider so bad
// usage fields become absent rather than leaking NaN, negatives, or unsafe
// arithmetic into the session aggregate. Token counts above the safe integer
// range are bounded rather than allowed to overflow later additions.
function readUsageNumber(raw: Record<string, unknown>, field: string): NumericEvidence {
  if (!Object.hasOwn(raw, field)) return { present: false, valid: false, value: 0 }
  const value = raw[field]
  const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0
  return {
    present: true,
    valid,
    value: valid ? Math.min(value, MAX_SAFE_TOKEN_COUNT) : 0,
  }
}

function addTokenCounts(left: number, right: number): number {
  if (right <= 0) return left
  if (left >= MAX_SAFE_TOKEN_COUNT - right) return MAX_SAFE_TOKEN_COUNT
  return left + right
}

function modelUsageIds(raw: Record<string, unknown>): string[] {
  const modelUsage = raw['modelUsage']
  if (!isRecord(modelUsage)) return []
  return Object.entries(modelUsage)
    .filter(([modelId, value]) => modelId.length > 0 && isRecord(value))
    .map(([modelId]) => modelId)
}

function combineCacheEvidence(values: readonly CacheTokenEvidence[]): CacheTokenEvidence {
  if (values.length === 0 || values.every(value => value === 'unavailable')) return 'unavailable'
  if (values.some(value => value === 'inconsistent')) return 'inconsistent'
  if (values.every(value => value === 'complete')) return 'complete'
  return 'partial'
}

/**
 * Normalize one provider usage object. Grok's input includes cache reads and
 * cache creation, while Metrora's ledger stores the exclusive input bucket.
 * Cache evidence is retained separately so an absent field is never silently
 * presented as a factual zero.
 */
function parseAuthoritativeUsage(raw: unknown): GrokUsageValues | null {
  if (!isRecord(raw)) return null

  const input = readUsageNumber(raw, 'inputTokens')
  const output = readUsageNumber(raw, 'outputTokens')
  const cacheRead = readUsageNumber(raw, 'cachedReadTokens')
  const cacheCreation = readUsageNumber(raw, 'cacheCreationTokens')
  const reasoning = readUsageNumber(raw, 'reasoningTokens')
  const reasoningSemantics: ReasoningTokenSemantics = output.valid && reasoning.present && reasoning.valid
    ? 'aggregate-output'
    : 'unavailable'

  const anyCachePresent = cacheRead.present || cacheCreation.present
  const invalidCacheField = (cacheRead.present && !cacheRead.valid)
    || (cacheCreation.present && !cacheCreation.valid)
  const cacheSumOverflow = cacheRead.value > MAX_SAFE_TOKEN_COUNT - cacheCreation.value
  const knownCache = cacheSumOverflow
    ? MAX_SAFE_TOKEN_COUNT
    : cacheRead.value + cacheCreation.value
  const cacheFitsInput = input.valid && !cacheSumOverflow && knownCache <= input.value

  let cacheTokenEvidence: CacheTokenEvidence
  if (!input.valid || invalidCacheField || !cacheFitsInput) {
    cacheTokenEvidence = 'inconsistent'
  } else if (!anyCachePresent) {
    cacheTokenEvidence = 'unavailable'
  } else if (cacheRead.present && cacheCreation.present) {
    cacheTokenEvidence = 'complete'
  } else {
    cacheTokenEvidence = 'partial'
  }

  // A valid cache subset remains useful when it fits, even if the other field
  // was absent or malformed. Impossible cache data is excluded so uncached
  // input can never become negative or consume another turn's budget.
  const usableCache = cacheFitsInput
  const normalizedCacheRead = usableCache && cacheRead.valid ? cacheRead.value : 0
  const normalizedCacheCreation = usableCache && cacheCreation.valid ? cacheCreation.value : 0
  const normalizedInput = input.valid
    ? Math.max(0, input.value - normalizedCacheRead - normalizedCacheCreation)
    : 0

  return {
    inputTokens: normalizedInput,
    outputTokens: output.value,
    cacheReadTokens: normalizedCacheRead,
    cacheCreationTokens: normalizedCacheCreation,
    reasoningTokens: reasoningSemantics === 'aggregate-output' ? Math.min(reasoning.value, output.value) : 0,
    reasoningSemantics,
    cacheTokenEvidence,
    topLevelAccountingComplete: input.valid && output.valid,
    hasPositiveAccountingUsage: normalizedInput > 0
      || normalizedCacheRead > 0
      || normalizedCacheCreation > 0
      || output.value > 0,
    modelIds: modelUsageIds(raw),
  }
}

function chooseAuthoritativeModel(modelIds: string[], existingModel: string): string {
  // modelUsage is attribution metadata only. Prefer an actual id that this
  // checkout can price; otherwise keep the existing summary/signals id when it
  // is priceable, then retain the first truthful actual id.
  const pricedActualModel = modelIds.find(modelId => getModelCosts(modelId) !== null)
  if (pricedActualModel) return pricedActualModel
  if (getModelCosts(existingModel) !== null) return existingModel
  return modelIds[0] ?? existingModel
}

// Single pass over updates.jsonl: retain the legacy totalTokens estimate, the
// final prompt-deduplicated completed usage records, and tool metadata.
function parseUpdates(updates: string): {
  usage: GrokTokenTotals
  modelIds: string[]
  authoritative: boolean
  costIsEstimated: boolean
  cacheTokenEvidence?: CacheTokenEvidence
  reasoningSemantics?: ReasoningTokenSemantics
  tools: string[]
  bashCommands: string[]
  subagentTypes: string[]
} {
  const turns = new Map<string, { first: number; last: number }>()
  const completedByPromptId = new Map<string, GrokCompletedUsage>()
  const completedWithoutPromptId: GrokCompletedUsage[] = []
  const streamedPromptIds = new Set<string>()
  const tools: string[] = []
  const bashCommands: string[] = []
  const subagentTypes: string[] = []
  // Compaction-aware fresh input: a large drop in totalTokens means the context
  // was compacted and rebuilt, so we sum each segment's peak rather than the
  // single global peak (which would lose everything before the last compaction).
  let prevTotal = -1
  let segmentPeak = 0
  let inputFresh = 0

  for (const line of updates.split('\n')) {
    if (!line.trim()) continue
    let params: GrokUpdate['params']
    try {
      params = (JSON.parse(line) as GrokUpdate).params
    } catch {
      continue
    }
    if (!params) continue

    const totalEvidence = readUsageNumber(params._meta ?? {}, 'totalTokens')
    const total = totalEvidence.valid ? totalEvidence.value : undefined
    if (total !== undefined) {
      if (prevTotal >= 0 && total < prevTotal * 0.5) {
        inputFresh = addTokenCounts(inputFresh, segmentPeak)
        segmentPeak = 0
      }
      if (total > segmentPeak) segmentPeak = total
      prevTotal = total

      const promptId = typeof params._meta?.promptId === 'string' && params._meta.promptId.length > 0
        ? params._meta.promptId
        : undefined
      if (promptId) {
        streamedPromptIds.add(promptId)
        const turn = turns.get(promptId)
        if (!turn) turns.set(promptId, { first: total, last: total })
        else turn.last = total
      }
    }

    const update = params.update
    if (update?.sessionUpdate === 'turn_completed') {
      const usage = parseAuthoritativeUsage(update.usage)
      const promptId = typeof update.prompt_id === 'string' && update.prompt_id.length > 0
        ? update.prompt_id
        : undefined
      // The final record for a prompt controls its authority. Store malformed
      // records too: retaining an earlier positive duplicate would turn a
      // superseded completion into false accounting evidence.
      if (promptId) completedByPromptId.set(promptId, usage)
      else completedWithoutPromptId.push(usage)
    }

    if (update?.sessionUpdate === 'tool_call' && typeof update.title === 'string') {
      tools.push(toolNameMap[update.title] ?? update.title)
      if (update.title === 'run_terminal_command' && typeof update.rawInput?.command === 'string') {
        bashCommands.push(...extractBashCommands(update.rawInput.command))
      }
      if (update.title === 'spawn_subagent' && typeof update.rawInput?.subagent_type === 'string') {
        subagentTypes.push(update.rawInput.subagent_type)
      }
    }
  }

  inputFresh = addTokenCounts(inputFresh, segmentPeak)
  let sumFirst = 0
  let estimatedOutput = 0
  for (const { first, last } of turns.values()) {
    sumFirst = addTokenCounts(sumFirst, first)
    estimatedOutput = addTokenCounts(estimatedOutput, Math.max(0, last - first))
  }
  // Fresh input (summed segment peaks) is billed once; the rest of the per-turn
  // re-sends are cache reads (Grok caches them, even though it reports nothing).
  const estimated = {
    input: inputFresh,
    cacheRead: Math.max(0, sumFirst - inputFresh),
    output: estimatedOutput,
  }

  const completed = [...completedByPromptId.values(), ...completedWithoutPromptId]
  const validCompleted = completed.filter((usage): usage is GrokUsageValues => usage !== null)
  const positiveCompleted = validCompleted.filter(usage => usage.hasPositiveAccountingUsage)
  const usageTotals = emptyTokenTotals()
  const modelIds: string[] = []
  const seenModelIds = new Set<string>()

  for (const usage of positiveCompleted) {
    addUsageToTotals(usageTotals, usage)
    for (const modelId of usage.modelIds) {
      if (seenModelIds.has(modelId)) continue
      seenModelIds.add(modelId)
      modelIds.push(modelId)
    }
  }

  // Authority is selected only after prompt-level last-write-wins
  // deduplication. modelUsage-only records cannot pass this check.
  if (positiveCompleted.length === 0 || !hasPositiveTotals(usageTotals)) {
    return {
      usage: { input: estimated.input, cacheRead: estimated.cacheRead, output: estimated.output, cacheCreation: 0, reasoning: 0 },
      modelIds: [],
      authoritative: false,
      costIsEstimated: true,
      tools,
      bashCommands,
      subagentTypes,
    }
  }

  const hasUncoveredTurn = [...streamedPromptIds].some(promptId => {
    const usage = completedByPromptId.get(promptId)
    return usage === undefined || usage === null || !usage.hasPositiveAccountingUsage
  })
  const hasIncompleteCompletedUsage = completed.some(usage =>
    usage === null
    || !usage.topLevelAccountingComplete
    || usage.cacheTokenEvidence !== 'complete'
    || !usage.hasPositiveAccountingUsage,
  )
  const cacheTokenEvidence = combineCacheEvidence(
    completed.map(usage => usage?.cacheTokenEvidence ?? 'inconsistent'),
  )

  return {
    usage: usageTotals,
    modelIds,
    authoritative: true,
    costIsEstimated: hasUncoveredTurn || hasIncompleteCompletedUsage || cacheTokenEvidence !== 'complete',
    cacheTokenEvidence,
    reasoningSemantics: combineReasoningSemantics(positiveCompleted.map(usage => usage.reasoningSemantics)),
    tools,
    bashCommands,
    subagentTypes,
  }
}

function addUsageToTotals(totals: GrokTokenTotals, usage: GrokUsageValues): void {
  // Normalize each record before summing so one malformed turn cannot consume
  // another turn's cache/input budget. Reasoning is a factual subset of the
  // provider's inclusive output and is never additive here.
  totals.input = addTokenCounts(totals.input, usage.inputTokens)
  totals.cacheRead = addTokenCounts(totals.cacheRead, usage.cacheReadTokens)
  totals.cacheCreation = addTokenCounts(totals.cacheCreation, usage.cacheCreationTokens)
  totals.output = addTokenCounts(totals.output, usage.outputTokens)
  totals.reasoning = addTokenCounts(totals.reasoning, usage.reasoningTokens)
}

function hasPositiveTotals(totals: GrokTokenTotals): boolean {
  return totals.input > 0
    || totals.cacheRead > 0
    || totals.output > 0
    || totals.cacheCreation > 0
    || totals.reasoning > 0
}

function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const dir = dirname(source.path)
      const summary = await readJson<GrokSummary>(join(dir, 'summary.json'))
      const updates = await readSessionFile(source.path)
      if (!summary || updates === null) return

      const signals = await readJson<GrokSignals>(join(dir, 'signals.json'))
      const existingModel =
        summary.current_model_id ?? signals?.primaryModelId ?? signals?.modelsUsed?.[0] ?? 'grok-build'
      const parsed = parseUpdates(updates)
      if (!hasPositiveTotals(parsed.usage)) return

      // Multi-model accounting is deliberately out of scope: modelUsage may
      // select one attribution id, but top-level totals remain the authority.
      const model = parsed.authoritative ? chooseAuthoritativeModel(parsed.modelIds, existingModel) : existingModel
      const timestamp = summary.updated_at ?? summary.last_active_at ?? summary.created_at ?? ''
      const sessionId = summary.info?.id ?? basename(dir)

      const dedupKey = `${source.provider}:${dir}:${timestamp}:${sessionId}`
      if (seenKeys.has(dedupKey)) return
      seenKeys.add(dedupKey)

      yield {
        provider: source.provider,
        model,
        inputTokens: parsed.usage.input,
        // Grok reports output inclusive of reasoning. Metrora retains that
        // provider truth and carries the per-record reasoning evidence at the
        // session boundary, so generated tokens and billable output remain the
        // reported output even when reasoning evidence is unavailable.
        outputTokens: parsed.usage.output,
        cacheCreationInputTokens: parsed.usage.cacheCreation,
        cacheReadInputTokens: parsed.usage.cacheRead,
        cachedInputTokens: parsed.usage.cacheRead,
        reasoningTokens: parsed.usage.reasoning,
        webSearchRequests: 0,
        ...(parsed.authoritative && parsed.reasoningSemantics
          ? { reasoningSemantics: parsed.reasoningSemantics }
          : {}),
        ...(parsed.authoritative && parsed.cacheTokenEvidence
          ? { cacheTokenEvidence: parsed.cacheTokenEvidence }
          : {}),
        costUSD: calculateCost(
          model,
          parsed.usage.input,
          parsed.usage.output,
          parsed.usage.cacheCreation,
          parsed.usage.cacheRead,
          0,
        ),
        costIsEstimated: parsed.costIsEstimated,
        tools: parsed.tools,
        bashCommands: parsed.bashCommands,
        subagentTypes: parsed.subagentTypes,
        timestamp,
        speed: 'standard',
        deduplicationKey: dedupKey,
        userMessage: summary.session_summary ?? summary.generated_title ?? '',
        sessionId,
        project: source.project,
        projectPath: summary.info?.cwd,
      }
    },
  }
}

async function discoverSessions(sessionsDir: string): Promise<SessionSource[]> {
  const sources: SessionSource[] = []

  let cwdDirs: string[]
  try {
    cwdDirs = await readdir(sessionsDir)
  } catch {
    return sources
  }

  for (const cwdName of cwdDirs) {
    const cwdPath = join(sessionsDir, cwdName)
    const cwdStat = await stat(cwdPath).catch(() => null)
    if (!cwdStat?.isDirectory()) continue

    let sessionDirs: string[]
    try {
      sessionDirs = await readdir(cwdPath)
    } catch {
      continue
    }

    for (const sessionName of sessionDirs) {
      const sessionPath = join(cwdPath, sessionName)
      const sessionStat = await stat(sessionPath).catch(() => null)
      if (!sessionStat?.isDirectory()) continue

      const summary = await readJson<GrokSummary>(join(sessionPath, 'summary.json'))
      if (!summary) continue

      const cwd = summary.info?.cwd ?? safeDecode(cwdName)
      sources.push({ path: join(sessionPath, 'updates.jsonl'), project: basename(cwd), provider: 'grok' })
    }
  }

  return sources
}

export function createGrokProvider(sessionsDir?: string): Provider {
  const dir = sessionsDir ?? defaultSessionsDir()

  return {
    name: 'grok',
    displayName: 'Grok Build',

    modelDisplayName(model: string): string {
      if (model.startsWith('grok-build')) return 'Grok Build'
      return getShortModelName(model)
    },

    toolDisplayName(rawTool: string): string {
      return toolNameMap[rawTool] ?? rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      return discoverSessions(dir)
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return createParser(source, seenKeys)
    },
  }
}

export const grok = createGrokProvider()
