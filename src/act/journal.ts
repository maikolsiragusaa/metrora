import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getConfigFilePath } from '../config.js'
import type { JournalRecordV1 } from './core-compatibility-types.js'

// Actions live beside config.json under the same Metrora home dir; reuse the
// config resolver rather than inventing a second location.
export function defaultActionsDir(): string {
  return join(dirname(getConfigFilePath()), 'actions')
}

export function journalPath(actionsDir: string): string {
  return join(actionsDir, 'journal.jsonl')
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

export async function appendRecord(actionsDir: string, record: JournalRecordV1): Promise<void> {
  await mkdir(actionsDir, { recursive: true })
  await appendFile(journalPath(actionsDir), JSON.stringify(record) + '\n', 'utf-8')
}

// Legacy append-only JSONL: a status flip is a full replacement line for the
// same id, so the last line for an id wins. This forgiving reader remains for
// legacy list/undo compatibility; controlled ACT reads use the strict reader.
export async function readRecords(actionsDir: string): Promise<JournalRecordV1[]> {
  let raw: string
  try {
    raw = await readFile(journalPath(actionsDir), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const order: string[] = []
  const byId = new Map<string, JournalRecordV1>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: JournalRecordV1
    try {
      rec = JSON.parse(line) as JournalRecordV1
    } catch {
      continue
    }
    if (!rec || typeof rec.id !== 'string') continue
    if (!byId.has(rec.id)) order.push(rec.id)
    byId.set(rec.id, rec)
  }
  return order.map(id => byId.get(id)!)
}
/**
 * Controlled ACT operations cannot use the legacy journal's forgiving parser.
 * Every non-empty line is parsed and must at least be an object with an id;
 * the operation parser performs the stricter schema and lifecycle checks.
 */
export async function readRecordHistoryStrict(actionsDir: string): Promise<unknown[]> {
  let raw: string
  try {
    raw = await readFile(journalPath(actionsDir), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const records: unknown[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('ACT journal is corrupt: malformed JSON')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { id?: unknown }).id !== 'string') {
      throw new Error('ACT journal is corrupt: record identity is malformed')
    }
    records.push(value)
  }
  return records
}

const LOCK_STALE_MS = 60_000

function lockPath(actionsDir: string): string {
  return join(actionsDir, '.lock')
}

async function acquireLock(lock: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // A single wx write: the lock is never observable in an empty state, so
      // a freshly taken lock cannot be stolen as stale.
      await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' })
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let mtimeMs: number
      try {
        mtimeMs = (await stat(lock)).mtimeMs
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr
        continue // holder released between write and stat; retry
      }
      if (Date.now() - mtimeMs <= LOCK_STALE_MS) {
        throw new Error('another metrora action is in progress (lock held); retry shortly')
      }
      await rm(lock, { force: true })
    }
  }
  throw new Error('could not acquire the metrora action lock')
}

export async function withLock<T>(actionsDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(actionsDir, { recursive: true })
  const lock = lockPath(actionsDir)
  await acquireLock(lock)
  try {
    return await fn()
  } finally {
    await rm(lock, { force: true })
  }
}
