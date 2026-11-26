import { readdir } from 'fs/promises'
import { basename, join } from 'path'

import { readSessionLines } from '../fs-utils.js'
import { calculateCost } from '../models.js'
import { extractBashCommands } from '../bash-utils.js'
import { safeNumber } from '../parser.js'
import type { ParsedProviderCall, SessionParser, SessionSource } from './types.js'
import {
  JOURNAL_DIRNAME,
  JOURNAL_EXTENSION,
  METADATA_FILENAME,
  isDirectory,
  isFile,
  journalSegmentTimestamp,
  normalizeContent,
  parseToolArguments,
  readJsonFile,
  resolveUnifiedModel,
  toolNameMap,
  unifiedSessionDir,
  type VibeJournalRecord,
  type VibeMetadata,
  type VibeTurnEntry,
  type VibeUnifiedCompletionPart,
} from './mistral-vibe-shared.js'

export async function discoverUnifiedJournalFiles(unifiedDir: string): Promise<string[]> {
  const files: string[] = []

  let sessionEntries: string[]
  try {
    sessionEntries = (await readdir(unifiedDir)).sort()
  } catch {
    return files
  }

  for (const sessionEntry of sessionEntries) {
    const journalDir = join(unifiedDir, sessionEntry, JOURNAL_DIRNAME)
    if (!await isDirectory(journalDir)) continue

    let journalEntries: string[]
    try {
      journalEntries = (await readdir(journalDir)).sort()
    } catch {
      continue
    }

    for (const journalEntry of journalEntries) {
      if (!journalEntry.endsWith(JOURNAL_EXTENSION)) continue
      const journalPath = join(journalDir, journalEntry)
      if (await isFile(journalPath)) files.push(journalPath)
    }
  }

  return files
}

function turnEntryText(entries: VibeTurnEntry[] | undefined): string {
  for (const entry of entries ?? []) {
    if (entry?.role !== 'user') continue
    const text = normalizeContent(entry.content).trim()
    if (text) return text.slice(0, 500)
  }
  return ''
}

function extractUnifiedTools(parts: VibeUnifiedCompletionPart[] | undefined): { tools: string[]; bashCommands: string[] } {
  const tools: string[] = []
  const bashCommands: string[] = []

  for (const part of parts ?? []) {
    if (part?.type !== 'tool_call') continue
    const rawName = part.name
    if (!rawName) continue

    const mappedName = toolNameMap[rawName] ?? rawName
    tools.push(mappedName)

    if (mappedName !== 'Bash') continue
    const args = parseToolArguments(part.arguments_json)
    const command = args['command']
    if (typeof command === 'string') bashCommands.push(...extractBashCommands(command))
  }

  return {
    tools: [...new Set(tools)],
    bashCommands: [...new Set(bashCommands)],
  }
}

export function createUnifiedParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const sessionDir = unifiedSessionDir(source.path)
      const metadata = await readJsonFile<VibeMetadata>(join(sessionDir, METADATA_FILENAME))
      if (!metadata) return

      const sessionId = metadata.session_id || basename(sessionDir)
      const model = resolveUnifiedModel(metadata)
      const fallbackTimestamp = metadata.end_time ?? metadata.start_time ?? ''
      const timestamp = await journalSegmentTimestamp(source.path, fallbackTimestamp)

      let currentUserMessage = (metadata.title ?? '').slice(0, 500)
      let turnOrdinal = 0
      let currentTurnId = `${sessionId}:turn-${turnOrdinal++}`
      let callOrdinal = 0

      for await (const line of readSessionLines(source.path)) {
        // Cheap substring gate before JSON.parse: unified journals are dominated
        // by projection/input records far larger than the usage-bearing ones.
        if (!line.includes('completion_succeeded') && !line.includes('turn/start')) continue

        let record: VibeJournalRecord
        try {
          const parsed = JSON.parse(line) as unknown
          if (!parsed || typeof parsed !== 'object') continue
          record = parsed as VibeJournalRecord
        } catch {
          continue
        }

        const payload = record.payload
        if (!payload || typeof payload !== 'object') continue

        if (record.type === 'command_reserved' && payload.method === 'turn/start') {
          const text = turnEntryText(payload.params?.entries)
          if (text) currentUserMessage = text
          currentTurnId = `${sessionId}:turn-${turnOrdinal++}`
          continue
        }

        const completion = payload.result
        if (completion?.type !== 'completion_succeeded') continue

        const usage = completion.result?.usage
        if (!usage || typeof usage !== 'object') continue

        const totalInput = safeNumber(usage.input_tokens)
        const totalOutput = safeNumber(usage.output_tokens)
        const cachedInput = safeNumber(usage.cached_input_tokens)
        const cacheCreation = safeNumber(usage.cache_write_tokens)
        const reasoningTokens = safeNumber(usage.reasoning_tokens)
        if (totalInput === 0 && totalOutput === 0) continue

        const actionId = payload.action_id ?? `seq-${record.sequence ?? callOrdinal}`
        const deduplicationKey = `mistral-vibe:${sessionId}:unified:${actionId}`
        if (seenKeys.has(deduplicationKey)) continue
        seenKeys.add(deduplicationKey)
        callOrdinal++

        // Vibe reports input_tokens inclusive of cached_input_tokens, so fresh
        // input must subtract the cached subset or the same tokens are charged
        // at both the input and the cache-read rate.
        const freshInput = Math.max(0, totalInput - cachedInput)
        const hasCacheEvidence = typeof usage.cached_input_tokens === 'number'
          && typeof usage.cache_write_tokens === 'number'
        const { tools, bashCommands } = extractUnifiedTools(completion.result?.parts)

        yield {
          provider: 'mistral-vibe',
          model,
          inputTokens: freshInput,
          outputTokens: totalOutput,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cachedInput,
          cachedInputTokens: cachedInput,
          reasoningTokens,
          webSearchRequests: 0,
          costUSD: calculateCost(model, freshInput, totalOutput, cacheCreation, cachedInput, 0),
          costIsEstimated: true,
          // Vibe reports reasoning inside output_tokens (total_tokens is input +
          // output), so reasoning is observed for breakdowns but never re-billed.
          reasoningSemantics: 'aggregate-output',
          usageEvidence: 'complete',
          cacheTokenEvidence: hasCacheEvidence ? 'complete' : 'partial',
          tools,
          bashCommands,
          timestamp,
          speed: 'standard',
          deduplicationKey,
          turnId: currentTurnId,
          userMessage: currentUserMessage,
          sessionId,
        }
      }
    },
  }
}
