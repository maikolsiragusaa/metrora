import { readdir } from 'fs/promises'
import { join } from 'path'

import { isSqliteAvailable, openDatabase, blobToText, type SqliteDatabase } from '../sqlite.js'
import { sanitize } from './session-message.js'
import {
  validateSchemaDetailed,
  type SessionRow,
  type SqliteProviderConfig,
} from './sqlite-session-parser.js'
import type { SessionSource } from './types.js'

/**
 * Enumerate root sessions for a SQLite provider. Discovery opens each
 * database once; parsing may then share that database snapshot across all
 * virtual roots through the provider-specific shared parser.
 */
export async function discoverSqliteSessions(
  config: SqliteProviderConfig,
): Promise<SessionSource[]> {
  if (!isSqliteAvailable()) return []

  let dbPaths: string[]
  try {
    const entries = await readdir(config.dbDir)
    dbPaths = entries
      .filter((file) => file.startsWith(config.dbFilePrefix) && file.endsWith('.db'))
      .map((file) => join(config.dbDir, file))
  } catch {
    return []
  }

  if (dbPaths.length === 0) return []

  const sessions: SessionSource[] = []
  for (const dbPath of dbPaths) {
    let db: SqliteDatabase
    try {
      db = openDatabase(dbPath)
    } catch {
      continue
    }

    try {
      const schema = validateSchemaDetailed(db)
      if (!schema.ok) continue

      const rows = db.query<SessionRow>(
        'SELECT id, CAST(directory AS BLOB) AS directory, CAST(title AS BLOB) AS title, time_created FROM session WHERE parent_id IS NULL ORDER BY time_created DESC',
      )

      for (const row of rows) {
        const dir = blobToText(row.directory)
        const title = blobToText(row.title)
        sessions.push({
          path: dbPath + ':' + row.id,
          project: dir ? sanitize(dir) : sanitize(title),
          provider: config.providerName,
        })
      }
    } catch {
      // Skip a database that races rotation or has an unreadable schema.
    } finally {
      db.close()
    }
  }

  return sessions
}
