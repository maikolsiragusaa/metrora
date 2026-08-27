import { randomUUID } from 'crypto'
import { appendFile, mkdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getConfigFilePath } from '../config.js'
import type { ActionRecord } from './types.js'

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

export async function appendRecord(actionsDir: string, record: ActionRecord): Promise<void> {
  await mkdir(actionsDir, { recursive: true })
  await appendFile(journalPath(actionsDir), JSON.stringify(record) + '\n', 'utf-8')
}

// Append-only JSONL: a status transition is a full replacement line for the
// same id, so the last line for an id wins. Returns records in creation
// (first-seen) order. Unparseable lines are skipped for legacy callers.
export async function readRecords(actionsDir: string): Promise<ActionRecord[]> {
  let raw: string
  try {
    raw = await readFile(journalPath(actionsDir), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const order: string[] = []
  const byId = new Map<string, ActionRecord>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: ActionRecord
    try {
      rec = JSON.parse(line) as ActionRecord
    } catch {
      continue
    }
    if (!rec || typeof rec.id !== 'string') continue
    if (!byId.has(rec.id)) order.push(rec.id)
    byId.set(rec.id, rec)
  }
  return order.map(id => byId.get(id)!)
}

// New controlled operations use this fail-closed reader. Existing ACT list and
// undo flows retain readRecords' compatibility behavior for old journals.
export async function readRecordHistoryStrict(actionsDir: string): Promise<ActionRecord[]> {
  let raw: string
  try {
    raw = await readFile(journalPath(actionsDir), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const history: ActionRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      throw new Error('the action journal contains corrupt JSON')
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || typeof (rec as { id?: unknown }).id !== 'string') {
      throw new Error('the action journal contains a malformed record')
    }
    history.push(rec as ActionRecord)
  }
  return history
}

export async function readRecordsStrict(actionsDir: string): Promise<ActionRecord[]> {
  const order: string[] = []
  const byId = new Map<string, ActionRecord>()
  for (const record of await readRecordHistoryStrict(actionsDir)) {
    if (!byId.has(record.id)) order.push(record.id)
    byId.set(record.id, record)
  }
  return order.map(id => byId.get(id)!)
}

const LOCK_STALE_MS = 60_000
const LOCK_REFRESH_MS = Math.floor(LOCK_STALE_MS / 3)

type LockRecord = { pid: number; token: string; at: number }

function lockPath(actionsDir: string): string {
  return join(actionsDir, '.lock')
}

async function readLockToken(lock: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(lock, 'utf8')) as Partial<LockRecord>
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null
  } catch {
    return null
  }
}

async function acquireLock(lock: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID()
    try {
      // A single wx write: the lock is never observable in an empty state, so
      // a freshly taken lock cannot be stolen as stale.
      await writeFile(lock, JSON.stringify({ pid: process.pid, token, at: Date.now() } satisfies LockRecord), { flag: 'wx' })
      return token
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
  const token = await acquireLock(lock)
  const refreshHandle = setInterval(() => {
    void (async () => {
      if (await readLockToken(lock) !== token) return
      await utimes(lock, new Date(), new Date())
    })().catch(() => undefined)
  }, LOCK_REFRESH_MS)
  refreshHandle.unref?.()
  try {
    const result = await fn()
    if (await readLockToken(lock) !== token) throw new Error('metrora action lock ownership was lost during the critical section')
    return result
  } finally {
    clearInterval(refreshHandle)
    // A stale takeover may have installed a successor lock while this holder
    // was still unwinding. Never remove a lock that no longer carries our
    // nonce.
    if (await readLockToken(lock) === token) await rm(lock, { force: true })
  }
}
