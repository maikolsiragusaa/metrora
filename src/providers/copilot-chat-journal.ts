import { basename } from 'path'

import { readSessionFile } from '../fs-utils.js'
import { calculateCost } from '../models.js'
import {
  COPILOT_CHAT_JOURNAL_PROVIDER,
} from '../provider-parse-authorities.js'
import type { ParsedProviderCall, Provider, SessionParser, SessionSource } from './types.js'

type JournalPathSegment = string | number

type ChatSessionSource = SessionSource & {
  sourceType?: string
}

type JournalRequest = Record<string, unknown>

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function isChatSessionSource(source: SessionSource): source is ChatSessionSource {
  return (source as ChatSessionSource).sourceType === 'chatsession'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function createObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>
}

function parsePath(raw: unknown, fallback?: readonly JournalPathSegment[]): JournalPathSegment[] | null {
  const value = raw === undefined ? fallback : raw
  if (!Array.isArray(value)) return null

  const path: JournalPathSegment[] = []
  for (const segment of value) {
    if (typeof segment === 'number') {
      if (!Number.isInteger(segment) || segment < 0) return null
      path.push(segment)
      continue
    }
    if (typeof segment === 'string') {
      if (FORBIDDEN_PATH_KEYS.has(segment)) return null
      path.push(segment)
      continue
    }
    return null
  }
  return path
}

function getValue(container: object, segment: JournalPathSegment): unknown {
  return (container as Record<string, unknown>)[String(segment)]
}

function setValue(container: object, segment: JournalPathSegment, value: unknown): void {
  ;(container as Record<string, unknown>)[String(segment)] = value
}

function containerFor(segment: JournalPathSegment): unknown[] | Record<string, unknown> {
  return typeof segment === 'number' ? [] : createObject()
}

function ensureParent(root: object, path: readonly JournalPathSegment[]): object | null {
  let current: object = root
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index]!
    const nextSegment = path[index + 1]!
    let child = getValue(current, segment)
    if (!isContainer(child)) {
      child = containerFor(nextSegment)
      setValue(current, segment, child)
    }
    current = child
  }
  return current
}

function applySet(root: unknown, path: readonly JournalPathSegment[], value: unknown): unknown {
  if (path.length === 0) return value
  const working = isContainer(root) ? root : createObject()
  const parent = ensureParent(working, path)
  if (!parent) return working
  setValue(parent, path[path.length - 1]!, value)
  return working
}

function applyDelete(root: unknown, path: readonly JournalPathSegment[]): unknown {
  if (path.length === 0) return undefined
  const working = isContainer(root) ? root : createObject()
  const parent = ensureParent(working, path)
  if (!parent) return working
  // VS Code's ObjectMutationLog applies Delete as a property assignment to
  // undefined rather than an array splice. Mirror that replay contract.
  setValue(parent, path[path.length - 1]!, undefined)
  return working
}

function applyPush(
  root: unknown,
  path: readonly JournalPathSegment[],
  values: unknown[] | undefined,
  startIndex: number | undefined,
): unknown {
  const working = isContainer(root) ? root : createObject()
  if (path.length === 0) {
    if (!Array.isArray(working)) return working
    if (startIndex !== undefined) working.length = startIndex
    if (values?.length) working.push(...values)
    return working
  }

  const parent = ensureParent(working, path)
  if (!parent) return working
  const key = path[path.length - 1]!
  const existing = getValue(parent, key)
  const array = Array.isArray(existing) ? existing : []
  if (startIndex !== undefined) array.length = startIndex
  if (values?.length) array.push(...values)
  setValue(parent, key, array)
  return working
}

/**
 * Replays VS Code's ObjectMutationLog format used by chatSessions JSONL files.
 * Entry kinds mirror the upstream writer: Initial=0, Set=1, Push/splice=2,
 * Delete=3. In particular, kind=2's optional `i` truncates the target array
 * before pushing replacement entries; treating it as append-only preserves
 * stale request versions and loses the final accounting state.
 */
export function replayCopilotChatJournal(content: string): unknown {
  let root: unknown = createObject()

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try {
      entry = JSON.parse(line) as unknown
    } catch {
      continue
    }
    if (!isRecord(entry)) continue

    const kind = entry['kind']
    if (kind === 0) {
      root = entry['v']
      continue
    }

    if (kind === 1) {
      const path = parsePath(entry['k'])
      if (path) root = applySet(root, path, entry['v'])
      continue
    }

    if (kind === 2) {
      const path = parsePath(entry['k'], ['requests'])
      if (!path) continue
      const rawIndex = entry['i']
      const startIndex = typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0
        ? rawIndex
        : undefined
      const values = Array.isArray(entry['v']) ? entry['v'] : undefined
      root = applyPush(root, path, values, startIndex)
      continue
    }

    if (kind === 3) {
      const path = parsePath(entry['k'])
      if (path) root = applyDelete(root, path)
    }
  }

  return root
}

function finiteNonNegative(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined
}

function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function timestampToIso(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return timestampToIso(Number(trimmed))
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString()
}

function requestMetadata(request: JournalRequest): Record<string, unknown> {
  const result = request['result']
  if (!isRecord(result)) return createObject()
  return isRecord(result['metadata']) ? result['metadata'] : createObject()
}

function requestModel(request: JournalRequest, metadata: Record<string, unknown>): string {
  const resolved = readString(metadata['resolvedModel'])
  if (resolved) return resolved
  const modelId = readString(request['modelId'])
  return modelId.replace(/^copilot\//, '') || 'unknown'
}

function reasoningTokens(metadata: Record<string, unknown>): number {
  const rounds = metadata['toolCallRounds']
  if (!Array.isArray(rounds)) return 0

  let total = 0
  for (const round of rounds) {
    if (!isRecord(round)) continue
    const thinking = round['thinking']
    if (!isRecord(thinking)) continue
    const tokens = finiteNonNegative(thinking['tokens'])
    if (tokens !== undefined) total += tokens
  }
  return total
}

function requestTools(metadata: Record<string, unknown>, provider: Provider): string[] {
  const rounds = metadata['toolCallRounds']
  if (!Array.isArray(rounds)) return []

  const names = new Set<string>()
  const add = (raw: unknown): void => {
    const name = readString(raw)
    if (name) names.add(provider.toolDisplayName(name))
  }
  const inspect = (record: Record<string, unknown>): void => {
    add(record['toolName'])
    add(record['name'])
    add(record['tool'])
  }

  for (const round of rounds) {
    if (!isRecord(round)) continue
    inspect(round)
    for (const key of ['tools', 'toolCalls', 'toolRequests']) {
      const values = round[key]
      if (!Array.isArray(values)) continue
      for (const value of values) {
        if (typeof value === 'string') add(value)
        else if (isRecord(value)) inspect(value)
      }
    }
  }
  return [...names]
}

function createChatJournalParser(
  source: SessionSource,
  seenKeys: Set<string>,
  provider: Provider,
): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const content = await readSessionFile(source.path)
      if (!content) return

      const replayed = replayCopilotChatJournal(content)
      if (!isRecord(replayed)) return

      const sessionId = readString(replayed['sessionId']) || basename(source.path, '.jsonl')
      const sessionCreatedAt = timestampToIso(replayed['creationDate'])
      const requests = Array.isArray(replayed['requests']) ? replayed['requests'] : []

      for (let index = 0; index < requests.length; index++) {
        const raw = requests[index]
        if (!isRecord(raw)) continue
        const metadata = requestMetadata(raw)

        // VS Code's current persistence schema writes these two usage values on
        // the request itself. Older journals may only carry the metadata copies.
        // Presence, including an explicit zero, is authoritative over fallback.
        const inputTokens = finiteNonNegative(raw['promptTokens'])
          ?? finiteNonNegative(metadata['promptTokens'])
          ?? 0
        const outputTokens = finiteNonNegative(raw['completionTokens'])
          ?? finiteNonNegative(metadata['outputTokens'])
          ?? 0
        const reasoning = reasoningTokens(metadata)

        if (inputTokens === 0 && outputTokens === 0 && reasoning === 0) continue

        const requestId = readString(raw['requestId']) || `request-${index}`
        const deduplicationKey = `copilot-chatsession:${sessionId}:${requestId}`
        if (seenKeys.has(deduplicationKey)) continue
        seenKeys.add(deduplicationKey)

        const model = requestModel(raw, metadata)
        const timestamp = timestampToIso(raw['timestamp']) || sessionCreatedAt
        if (!timestamp) continue
        const costUSD = calculateCost(model, inputTokens, outputTokens + reasoning, 0, 0, 0)

        yield {
          provider: 'copilot',
          sessionId,
          project: source.project,
          model,
          inputTokens,
          outputTokens,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: reasoning,
          webSearchRequests: 0,
          costUSD,
          tools: requestTools(metadata, provider),
          bashCommands: [],
          timestamp,
          speed: 'standard',
          deduplicationKey,
          userMessage: '',
        }
      }
    },
  }
}

/**
 * Decorates Copilot discovery so current VS Code chat journals are routed into
 * their own cache namespace. Those journals are authoritative snapshots of the
 * replayed mutation log, unlike Copilot's durable/prunable sources: when a
 * present journal changes, its cached calls must be replaced rather than kept
 * monotonically. The parser override is retained for direct/unit use.
 */
export function withCopilotChatJournalAccounting(provider: Provider): Provider {
  return {
    ...provider,
    async discoverSessions(): Promise<SessionSource[]> {
      const sources = await provider.discoverSessions()
      return sources.map(source => isChatSessionSource(source)
        ? { ...source, provider: COPILOT_CHAT_JOURNAL_PROVIDER }
        : source)
    },
    createSessionParser(source, seenKeys, dateRange) {
      if (isChatSessionSource(source)) {
        return createChatJournalParser(source, seenKeys, provider)
      }
      return provider.createSessionParser(source, seenKeys, dateRange)
    },
  }
}

/**
 * Internal parser authority for the remapped chat-journal sources. It is not
 * part of provider discovery or the public --provider surface; `copilot`
 * discovery emits these sources and the parser registry resolves this internal
 * name. Non-durable semantics make a changed journal replace its prior snapshot.
 */
export function createCopilotChatJournalProvider(provider: Provider): Provider {
  return {
    ...provider,
    name: COPILOT_CHAT_JOURNAL_PROVIDER,
    durableSources: false,
    async discoverSessions(): Promise<SessionSource[]> {
      return []
    },
    createSessionParser(source, seenKeys): SessionParser {
      return createChatJournalParser(source, seenKeys, provider)
    },
  }
}
