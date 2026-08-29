import { calculateCost } from '../models.js'
import { isSqliteAvailable, getSqliteLoadError, openDatabase, blobToText, isSqliteBusyError, type SqliteDatabase } from '../sqlite.js'
import {
  fingerprintSourceFileSync,
  isSQLiteSourcePath,
  sourcePathCandidates,
} from '../sqlite-source-fingerprint.js'
import { traceReconciliation } from '../reconciliation-diagnostics.js'
import { buildAssistantCall, parseTimestamp, sanitize, type MessageData, type PartData } from './session-message.js'
import type {
  SessionSource,
  SessionParser,
  ParsedProviderCall,
} from './types.js'

type MessageRow = {
  session_id: string
  id: string
  time_created: number
  data: Uint8Array | string
}

type PartRow = {
  message_id: string
  data: Uint8Array | string
}

export type SessionRow = {
  id: string
  parent_id?: string | null
  directory: Uint8Array | string | null
  title: Uint8Array | string | null
  time_created: number
}

type SessionTokenRow = {
  cost?: number
  tokens_input?: number
  tokens_output?: number
  tokens_reasoning?: number
  tokens_cache_read?: number
  tokens_cache_write?: number
  model_id?: string
}

function tryQuerySessionTokens(db: SqliteDatabase, sessionId: string): {
  cost: number; input: number; output: number; reasoning: number
  cacheRead: number; cacheWrite: number; model: string | undefined
} | null {
  try {
    const rows = db.query<SessionTokenRow>(
      `SELECT cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model_id FROM session WHERE id = ?`,
      [sessionId],
    )
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      cost: r.cost ?? 0,
      input: r.tokens_input ?? 0,
      output: r.tokens_output ?? 0,
      reasoning: r.tokens_reasoning ?? 0,
      cacheRead: r.tokens_cache_read ?? 0,
      cacheWrite: r.tokens_cache_write ?? 0,
      model: r.model_id ?? undefined,
    }
  } catch {
    return null
  }
}

export type SchemaCheckResult = { ok: true } | { ok: false; missing: string[] }

export function validateSchemaDetailed(db: SqliteDatabase): SchemaCheckResult {
  const required = ['session', 'message', 'part']
  const missing: string[] = []
  for (const table of required) {
    try {
      db.query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table} LIMIT 1`)
    } catch (err) {
      if (isSqliteBusyError(err)) throw err
      missing.push(table)
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

const warnedSchemas = new Map<string, Set<string>>()

function warnUnrecognizedSchemaOnce(providerLabel: string, missing: string[]): void {
  const providerSet = warnedSchemas.get(providerLabel) ?? new Set()
  const key = missing.slice().sort().join(',')
  if (providerSet.has(key)) return
  providerSet.add(key)
  warnedSchemas.set(providerLabel, providerSet)
  process.stderr.write(
    `metrora: ${providerLabel} database is missing expected tables (${missing.join(', ')}). ` +
    `Run ${providerLabel} once to apply migrations, or report at https://github.com/maikolsiragusaa/metrora/issues if this persists.\n`
  )
}

type SharedSessionRow = SessionRow & {
  parent_id: string | null
}

type SharedPartRow = PartRow & {
  id: string
}

type SharedSqliteCacheEntry = {
  fingerprintKey: string
  callsByRoot: Map<string, ParsedProviderCall[]>
}

function sqliteSourceIdentity(sourcePath: string): { dbPath: string; sessionId: string } | null {
  const dbPath = sourcePathCandidates(sourcePath).find(candidate => isSQLiteSourcePath(candidate))
  if (!dbPath) return null

  const suffix = sourcePath.slice(dbPath.length)
  if (suffix.startsWith(':') || suffix.startsWith('#')) {
    const sessionId = suffix.slice(1)
    return sessionId.length > 0 ? { dbPath, sessionId } : null
  }

  return null
}

function sharedFingerprintKey(path: string): string {
  const fingerprint = fingerprintSourceFileSync(path)
  if (!fingerprint) return 'missing'
  const wal = fingerprint.sqliteWal
  return [
    fingerprint.dev,
    fingerprint.ino,
    fingerprint.mtimeMs,
    fingerprint.sizeBytes,
    wal?.mtimeMs ?? '',
    wal?.sizeBytes ?? '',
  ].join(':')
}

function rootIdBySession(rows: readonly SharedSessionRow[]): (sessionId: string) => string | null {
  const byId = new Map(rows.map(row => [row.id, row]))
  const memo = new Map<string, string | null>()

  return (sessionId: string): string | null => {
    const known = memo.get(sessionId)
    if (known !== undefined || memo.has(sessionId)) return known ?? null

    const visited: string[] = []
    const visiting = new Set<string>()
    let current = sessionId
    let root: string | null = null

    while (true) {
      const resolved = memo.get(current)
      if (resolved !== undefined || memo.has(current)) {
        root = resolved ?? null
        break
      }

      const row = byId.get(current)
      if (!row || visiting.has(current)) {
        root = null
        break
      }

      visiting.add(current)
      visited.push(current)
      if (row.parent_id === null) {
        root = current
        break
      }
      current = row.parent_id
    }

    for (const id of visited) memo.set(id, root)
    return root
  }
}

function parseAllSqliteSessions(
  db: SqliteDatabase,
  config: SqliteProviderConfig,
): Map<string, ParsedProviderCall[]> | null {
  const schema = validateSchemaDetailed(db)
  if (!schema.ok) {
    warnUnrecognizedSchemaOnce(config.displayName, schema.missing)
    return null
  }

  const sessions = db.query<SharedSessionRow>(
    'SELECT id, parent_id, CAST(directory AS BLOB) AS directory, CAST(title AS BLOB) AS title, time_created FROM session',
  )
  const rootForSession = rootIdBySession(sessions)
  const roots = new Set(sessions.filter(row => row.parent_id === null).map(row => row.id))
  const callsByRoot = new Map<string, ParsedProviderCall[]>()
  const messageCountByRoot = new Map<string, number>()
  const firstMessageTimeByRoot = new Map<string, number>()
  const parseFailCountByRoot = new Map<string, number>()
  const roleSkipCountByRoot = new Map<string, number>()

  const messages = db.query<MessageRow>(
    'SELECT session_id, id, time_created, CAST(data AS BLOB) AS data FROM message ORDER BY time_created ASC, id ASC',
  )
  const parts = db.query<SharedPartRow>(
    'SELECT message_id, id, CAST(data AS BLOB) AS data FROM part ORDER BY message_id, id',
  )

  const partsByMsg = new Map<string, PartData[]>()
  for (const part of parts) {
    try {
      const parsed = JSON.parse(blobToText(part.data)) as PartData
      const list = partsByMsg.get(part.message_id) ?? []
      list.push(parsed)
      partsByMsg.set(part.message_id, list)
    } catch {
      // Skip corrupt part data, matching the per-root parser.
    }
  }

  const currentUserMessageBySession = new Map<string, string>()
  for (const msg of messages) {
    const root = rootForSession(msg.session_id)
    if (!root || !roots.has(root)) continue

    messageCountByRoot.set(root, (messageCountByRoot.get(root) ?? 0) + 1)
    if (!firstMessageTimeByRoot.has(root)) firstMessageTimeByRoot.set(root, msg.time_created)

    let data: MessageData
    try {
      data = JSON.parse(blobToText(msg.data)) as MessageData
    } catch {
      parseFailCountByRoot.set(root, (parseFailCountByRoot.get(root) ?? 0) + 1)
      continue
    }

    if (data.role === 'user') {
      const textParts = (partsByMsg.get(msg.id) ?? [])
        .filter(part => part.type === 'text')
        .map(part => part.text ?? '')
        .filter(Boolean)
      if (textParts.length > 0) currentUserMessageBySession.set(msg.session_id, textParts.join(' '))
      continue
    }

    if (data.role !== 'assistant' && data.role !== 'model') {
      roleSkipCountByRoot.set(root, (roleSkipCountByRoot.get(root) ?? 0) + 1)
      continue
    }

    const dedupKey = config.providerName + ':' + msg.session_id + ':' + msg.id
    const call = buildAssistantCall({
      providerName: config.providerName,
      dedupKey,
      sessionId: root,
      data,
      parts: partsByMsg.get(msg.id) ?? [],
      timeCreatedMs: msg.time_created,
      userMessage: currentUserMessageBySession.get(msg.session_id) ?? '',
    })
    if (!call) continue

    const calls = callsByRoot.get(root) ?? []
    calls.push(call)
    callsByRoot.set(root, calls)
  }

  // The historical parser emits one root-level aggregate only when an entire
  // root subtree has messages but no parseable assistant calls. Preserve that
  // fallback while building all roots in one database pass.
  for (const root of roots) {
    if ((messageCountByRoot.get(root) ?? 0) === 0 || (callsByRoot.get(root)?.length ?? 0) > 0) continue

    const sessionTokens = tryQuerySessionTokens(db, root)
    if (!sessionTokens || !(
      sessionTokens.cost > 0 ||
      sessionTokens.input > 0 ||
      sessionTokens.output > 0 ||
      sessionTokens.reasoning > 0 ||
      sessionTokens.cacheRead > 0 ||
      sessionTokens.cacheWrite > 0
    )) {
      if (process.env['METRORA_VERBOSE'] === '1') {
        process.stderr.write(
          'metrora: ' + config.displayName + ' session ' + root + ' has ' +
          (messageCountByRoot.get(root) ?? 0) + ' messages (' +
          (parseFailCountByRoot.get(root) ?? 0) + ' unparseable, ' +
          (roleSkipCountByRoot.get(root) ?? 0) + ' non-user/assistant roles) ' +
          'but yielded 0 calls. Parts: ' + parts.length + '.\n',
        )
      }
      continue
    }

    const dedupKey = config.providerName + ':' + root + ':session-level'
    const model = sessionTokens.model ?? 'unknown'
    let costUSD = calculateCost(model, sessionTokens.input, sessionTokens.output, sessionTokens.cacheWrite, sessionTokens.cacheRead, 0)
    if (costUSD === 0 && sessionTokens.cost > 0) costUSD = sessionTokens.cost
    callsByRoot.set(root, [{
      provider: config.providerName,
      model,
      inputTokens: sessionTokens.input,
      outputTokens: sessionTokens.output,
      cacheCreationInputTokens: sessionTokens.cacheWrite,
      cacheReadInputTokens: sessionTokens.cacheRead,
      cachedInputTokens: sessionTokens.cacheRead,
      reasoningTokens: sessionTokens.reasoning,
      webSearchRequests: 0,
      costUSD,
      tools: [],
      bashCommands: [],
      timestamp: parseTimestamp(firstMessageTimeByRoot.get(root) ?? 0),
      speed: 'standard',
      deduplicationKey: dedupKey,
      userMessage: '',
      sessionId: root,
    }])
  }

  return callsByRoot
}

export type SqliteProviderConfig = {
  providerName: string
  displayName: string
  dbDir: string
  dbFilePrefix: string
}

/**
 * Create a parser factory for SQLite providers whose source list contains
 * multiple virtual roots in one database. The cache is process-local and
 * WAL-aware: one safe snapshot/query serves every root until the database
 * fingerprint changes. Existing virtual source paths and cache identities are
 * intentionally preserved.
 */
export function createSharedSqliteSessionParser(
  config: SqliteProviderConfig,
): (source: SessionSource, seenKeys: Set<string>) => SessionParser {
  const parsedDatabases = new Map<string, SharedSqliteCacheEntry>()
  const failedDatabases = new Map<string, string>()
  const reportedCacheHits = new Set<string>()

  return (source: SessionSource, seenKeys: Set<string>): SessionParser => ({
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      if (!isSqliteAvailable()) {
        process.stderr.write(getSqliteLoadError() + '\n')
        return
      }

      const identity = sqliteSourceIdentity(source.path)
      if (!identity) return

      const fingerprintKey = sharedFingerprintKey(identity.dbPath)
      const knownFailure = failedDatabases.get(identity.dbPath)
      if (knownFailure === fingerprintKey) {
        throw new Error('shared SQLite database parse failed at its current fingerprint')
      }
      if (knownFailure !== undefined) failedDatabases.delete(identity.dbPath)
      let entry = parsedDatabases.get(identity.dbPath)
      const cacheHit = entry?.fingerprintKey === fingerprintKey

      if (!cacheHit) {
        let db: SqliteDatabase
        try {
          db = openDatabase(identity.dbPath)
        } catch (err) {
          if (fingerprintKey === 'missing') {
            process.stderr.write('metrora: cannot open ' + config.displayName + ' database\n')
            return
          }
          failedDatabases.set(identity.dbPath, fingerprintKey)
          process.stderr.write('metrora: cannot open ' + config.displayName + ' database; prior evidence was retained\n')
          throw err
        }

        try {
          const callsByRoot = parseAllSqliteSessions(db, config)
          if (!callsByRoot) {
            failedDatabases.set(identity.dbPath, fingerprintKey)
            throw new Error('shared SQLite database schema is not recognized')
          }
          entry = { fingerprintKey, callsByRoot }
          parsedDatabases.set(identity.dbPath, entry)
          traceReconciliation('sqlite-shared-parse', {
            provider: config.providerName,
            cache: 'miss',
            rootCount: callsByRoot.size,
            callCount: [...callsByRoot.values()].reduce((total, calls) => total + calls.length, 0),
          })
        } catch (err) {
          failedDatabases.set(identity.dbPath, fingerprintKey)
          process.stderr.write('metrora: cannot parse ' + config.displayName + ' database; prior evidence was retained\n')
          throw err
        } finally {
          db.close()
        }
      }

      if (!entry) return
      if (cacheHit) {
        const hitKey = identity.dbPath + ':' + fingerprintKey
        if (!reportedCacheHits.has(hitKey)) {
          reportedCacheHits.add(hitKey)
          traceReconciliation('sqlite-shared-parse', {
            provider: config.providerName,
            cache: 'hit',
            rootCount: entry.callsByRoot.size,
            callCount: [...entry.callsByRoot.values()].reduce((total, calls) => total + calls.length, 0),
          })
        }
      }

      for (const call of entry.callsByRoot.get(identity.sessionId) ?? []) {
        if (seenKeys.has(call.deduplicationKey)) continue
        seenKeys.add(call.deduplicationKey)
        yield call
      }
    },
  })
}

export function createSqliteSessionParser(
  source: SessionSource,
  seenKeys: Set<string>,
  config: SqliteProviderConfig,
): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      if (!isSqliteAvailable()) {
        process.stderr.write(getSqliteLoadError() + '\n')
        return
      }

      const segments = source.path.split(':')
      const sessionId = segments[segments.length - 1]!
      const dbPath = segments.slice(0, -1).join(':')

      let db: SqliteDatabase
      try {
        db = openDatabase(dbPath)
      } catch (err) {
        process.stderr.write(`metrora: cannot open ${config.displayName} database: ${err instanceof Error ? err.message : err}\n`)
        return
      }

      try {
        const schema = validateSchemaDetailed(db)
        if (!schema.ok) {
          warnUnrecognizedSchemaOnce(config.displayName, schema.missing)
          return
        }

        const messages = db.query<MessageRow>(
          `WITH RECURSIVE session_tree(id) AS (
            SELECT id FROM session WHERE id = ?
            UNION
            SELECT child.id
            FROM session child
            JOIN session_tree parent ON child.parent_id = parent.id
          )
          SELECT session_id, id, time_created, CAST(data AS BLOB) AS data
          FROM message
          WHERE session_id IN (SELECT id FROM session_tree)
          ORDER BY time_created ASC, id ASC`,
          [sessionId],
        )

        const parts = db.query<PartRow>(
          `WITH RECURSIVE session_tree(id) AS (
            SELECT id FROM session WHERE id = ?
            UNION
            SELECT child.id
            FROM session child
            JOIN session_tree parent ON child.parent_id = parent.id
          )
          SELECT message_id, CAST(data AS BLOB) AS data
          FROM part
          WHERE session_id IN (SELECT id FROM session_tree)
          ORDER BY message_id, id`,
          [sessionId],
        )

        const partsByMsg = new Map<string, PartData[]>()
        for (const part of parts) {
          try {
            const parsed = JSON.parse(blobToText(part.data)) as PartData
            const list = partsByMsg.get(part.message_id) ?? []
            list.push(parsed)
            partsByMsg.set(part.message_id, list)
          } catch {
            // skip corrupt part data
          }
        }

        const currentUserMessageBySession = new Map<string, string>()
        let yieldCount = 0
        let parseFailCount = 0
        let roleSkipCount = 0

        for (const msg of messages) {
          let data: MessageData
          try {
            data = JSON.parse(blobToText(msg.data)) as MessageData
          } catch {
            parseFailCount++
            continue
          }

          if (data.role === 'user') {
            const textParts = (partsByMsg.get(msg.id) ?? [])
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .filter(Boolean)
            if (textParts.length > 0) {
              currentUserMessageBySession.set(msg.session_id, textParts.join(' '))
            }
            continue
          }

          if (data.role !== 'assistant' && data.role !== 'model') {
            if (data.role !== 'user') roleSkipCount++
            continue
          }

          const dedupKey = `${config.providerName}:${msg.session_id}:${msg.id}`
          if (seenKeys.has(dedupKey)) continue

          const call = buildAssistantCall({
            providerName: config.providerName,
            dedupKey,
            sessionId,
            data,
            parts: partsByMsg.get(msg.id) ?? [],
            timeCreatedMs: msg.time_created,
            userMessage: currentUserMessageBySession.get(msg.session_id) ?? '',
          })
          if (!call) continue

          seenKeys.add(dedupKey)
          yieldCount++
          yield call
        }

        if (yieldCount === 0 && messages.length > 0) {
          const sessionTokens = tryQuerySessionTokens(db, sessionId)
          if (sessionTokens && (
            sessionTokens.cost > 0 ||
            sessionTokens.input > 0 ||
            sessionTokens.output > 0 ||
            sessionTokens.reasoning > 0 ||
            sessionTokens.cacheRead > 0 ||
            sessionTokens.cacheWrite > 0
          )) {
            const dedupKey = `${config.providerName}:${sessionId}:session-level`
            if (!seenKeys.has(dedupKey)) {
              seenKeys.add(dedupKey)
              const model = sessionTokens.model ?? 'unknown'
              let costUSD = calculateCost(model, sessionTokens.input, sessionTokens.output, sessionTokens.cacheWrite, sessionTokens.cacheRead, 0)
              if (costUSD === 0 && sessionTokens.cost > 0) costUSD = sessionTokens.cost
              yield {
                provider: config.providerName,
                model,
                inputTokens: sessionTokens.input,
                outputTokens: sessionTokens.output,
                cacheCreationInputTokens: sessionTokens.cacheWrite,
                cacheReadInputTokens: sessionTokens.cacheRead,
                cachedInputTokens: sessionTokens.cacheRead,
                reasoningTokens: sessionTokens.reasoning,
                webSearchRequests: 0,
                costUSD,
                tools: [],
                bashCommands: [],
                timestamp: parseTimestamp(messages[0]!.time_created),
                speed: 'standard',
                deduplicationKey: dedupKey,
                userMessage: '',
                sessionId,
              }
              yieldCount++
            }
          }

          if (yieldCount === 0 && process.env['METRORA_VERBOSE'] === '1') {
            process.stderr.write(
              `metrora: ${config.displayName} session ${sessionId} has ${messages.length} messages ` +
              `(${parseFailCount} unparseable, ${roleSkipCount} non-user/assistant roles) ` +
              `but yielded 0 calls. Parts: ${parts.length}.\n`
            )
          }
        }
      } finally {
        db.close()
      }
    },
  }
}

