import { readFile } from 'fs/promises'
import { basename, dirname } from 'path'

import { calculateCost } from '../models.js'
import {
  COPILOT_CLI_RESUME_PROVIDER,
} from '../provider-parse-authorities.js'
import type {
  ParsedProviderCall,
  Provider,
  SessionParser,
  SessionSource,
} from './types.js'

type JsonlSource = SessionSource & { sourceType?: string }
type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function isCopilotCliJsonl(source: SessionSource): boolean {
  return (source as JsonlSource).sourceType === 'jsonl'
}

function timestampToISO(value: unknown): string {
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const ms = value < 1_000_000_000_000 ? value * 1000 : value
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function readUsage(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null
  return {
    inputTokens: numberOrZero(raw['inputTokens']),
    outputTokens: numberOrZero(raw['outputTokens']),
    cacheReadTokens: numberOrZero(raw['cacheReadTokens']),
    cacheWriteTokens: numberOrZero(raw['cacheWriteTokens']),
    reasoningTokens: numberOrZero(raw['reasoningTokens']),
  }
}

function counterReset(current: Usage, previous: Usage): boolean {
  // Copilot's shutdown input total is cache-inclusive and therefore the broadest
  // monotonic sentinel. A lower value denotes a fresh accounting epoch.
  return current.inputTokens < previous.inputTokens
}

function delta(current: Usage, previous: Usage | undefined, key: keyof Usage): number {
  return Math.max(0, current[key] - (previous?.[key] ?? 0))
}

/**
 * Supplemental parser for Copilot CLI resumed sessions.
 *
 * The canonical Copilot parser already owns assistant-message output and the
 * FIRST session.shutdown per model. Newer CLI `--resume` legs append additional
 * shutdown rows whose model totals are cumulative. The canonical parser's
 * historical dedup key intentionally collapses those rows, so this namespace
 * emits ONLY the later-leg deltas. It never duplicates the first shutdown and
 * never replaces the canonical Copilot source/cache authority.
 */
function createResumeParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      let raw: string
      try {
        raw = await readFile(source.path, 'utf-8')
      } catch {
        return
      }

      const sessionId = basename(dirname(source.path))
      const previousByModel = new Map<string, Usage>()
      const occurrencesByModel = new Map<string, number>()
      let lastEventTimestamp = ''

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let event: Record<string, unknown>
        try {
          const parsed = JSON.parse(line) as unknown
          if (!isRecord(parsed)) continue
          event = parsed
        } catch {
          continue
        }

        const eventTimestamp = timestampToISO(event['timestamp'])
        if (eventTimestamp) lastEventTimestamp = eventTimestamp
        if (event['type'] !== 'session.shutdown') continue

        const data = event['data']
        if (!isRecord(data) || !isRecord(data['modelMetrics'])) continue
        const shutdownTimestamp = eventTimestamp
          || timestampToISO(data['sessionStartTime'])
          || lastEventTimestamp

        for (const [model, metricsRaw] of Object.entries(data['modelMetrics'])) {
          if (!model || !isRecord(metricsRaw)) continue
          const usage = readUsage(metricsRaw['usage'])
          if (!usage) continue

          const occurrence = (occurrencesByModel.get(model) ?? 0) + 1
          occurrencesByModel.set(model, occurrence)
          const rawPrevious = previousByModel.get(model)
          previousByModel.set(model, usage)

          // The canonical Copilot parser owns occurrence 1. This authority only
          // recovers later resumed legs that the legacy shared dedup key drops.
          if (occurrence === 1) continue

          const previous = rawPrevious && !counterReset(usage, rawPrevious)
            ? rawPrevious
            : undefined
          const cacheReadTokens = delta(usage, previous, 'cacheReadTokens')
          const cacheWriteTokens = delta(usage, previous, 'cacheWriteTokens')
          const reasoningTokens = delta(usage, previous, 'reasoningTokens')
          const inputTokens = Math.max(
            0,
            delta(usage, previous, 'inputTokens') - cacheReadTokens - cacheWriteTokens,
          )

          // Output remains owned by assistant.message calls in the canonical
          // parser. Adding shutdown output here would double-count it.
          if (inputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0 && reasoningTokens === 0) {
            continue
          }

          const deduplicationKey = `copilot:${sessionId}:shutdown:${model}:resume:${occurrence}`
          if (seenKeys.has(deduplicationKey)) continue
          seenKeys.add(deduplicationKey)

          yield {
            provider: 'copilot',
            model,
            inputTokens,
            outputTokens: 0,
            cacheCreationInputTokens: cacheWriteTokens,
            cacheReadInputTokens: cacheReadTokens,
            cachedInputTokens: 0,
            reasoningTokens,
            webSearchRequests: 0,
            costUSD: calculateCost(model, inputTokens, 0, cacheWriteTokens, cacheReadTokens, 0),
            costIsEstimated: false,
            tools: [],
            bashCommands: [],
            timestamp: shutdownTimestamp,
            speed: 'standard',
            deduplicationKey,
            userMessage: '',
            sessionId,
            project: source.project,
          }
        }
      }
    },
  }
}

/**
 * Keep canonical Copilot discovery untouched and add a second, internal source
 * only for CLI JSONL files. The supplemental provider is deliberately absent
 * from allProviderNames(), while emitted calls remain provider='copilot'.
 */
export function withCopilotCliResumeAccounting(base: Provider): Provider {
  return {
    ...base,
    async discoverSessions(): Promise<SessionSource[]> {
      const sources = await base.discoverSessions()
      const supplemental = sources
        .filter(isCopilotCliJsonl)
        .map(source => ({ ...source, provider: COPILOT_CLI_RESUME_PROVIDER }))
      return [...sources, ...supplemental]
    },
  }
}

/** Internal durable ledger containing only resumed-shutdown deltas. */
export function createCopilotCliResumeProvider(base: Provider): Provider {
  return {
    name: COPILOT_CLI_RESUME_PROVIDER,
    displayName: base.displayName,
    durableSources: true,
    durableFreshWins: true,
    modelDisplayName: model => base.modelDisplayName(model),
    toolDisplayName: tool => base.toolDisplayName(tool),
    discoverSessions: async () => [],
    createSessionParser: (source, seenKeys) => createResumeParser(source, seenKeys),
  }
}
