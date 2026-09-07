import { openDatabase, type SqliteDatabase } from '../sqlite.js'
import { traceReconciliation } from '../reconciliation-diagnostics.js'
import type { ParsedProviderCall } from './types.js'

export type SharedSqliteCacheEntry = {
  fingerprintKey: string
  callsByRoot: Map<string, ParsedProviderCall[]>
}

export type SharedSqliteCacheLoadOptions = {
  dbPath: string
  fingerprintKey: string
  providerName: string
  displayName: string
  parse: (db: SqliteDatabase) => Map<string, ParsedProviderCall[]> | null
  failedDatabases: Map<string, string>
  parsedDatabases: Map<string, SharedSqliteCacheEntry>
}

export function loadSharedSqliteCacheEntry(
  options: SharedSqliteCacheLoadOptions,
): SharedSqliteCacheEntry {
  const parseStartedAt = performance.now()
  let db: SqliteDatabase
  try {
    db = openDatabase(options.dbPath)
  } catch (error) {
    options.failedDatabases.set(options.dbPath, options.fingerprintKey)
    process.stderr.write('metrora: cannot open ' + options.displayName + ' database; prior evidence was retained\n')
    throw error
  }

  try {
    const callsByRoot = options.parse(db)
    if (!callsByRoot) {
      options.failedDatabases.set(options.dbPath, options.fingerprintKey)
      throw new Error('shared SQLite database schema is not recognized')
    }

    const entry = { fingerprintKey: options.fingerprintKey, callsByRoot }
    options.parsedDatabases.set(options.dbPath, entry)
    traceReconciliation('sqlite-shared-parse', {
      provider: options.providerName,
      cache: 'miss',
      rootCount: callsByRoot.size,
      callCount: [...callsByRoot.values()].reduce((total, calls) => total + calls.length, 0),
      elapsedMs: Math.round(performance.now() - parseStartedAt),
    })
    return entry
  } catch (error) {
    options.failedDatabases.set(options.dbPath, options.fingerprintKey)
    process.stderr.write('metrora: cannot parse ' + options.displayName + ' database; prior evidence was retained\n')
    throw error
  } finally {
    db.close()
  }
}
