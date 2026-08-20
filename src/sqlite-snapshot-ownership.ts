import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { basename, join } from 'node:path'

const SNAPSHOT_OWNER_FILE = '.owner.json'
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000

type SnapshotOwner = {
  pid: number
  token: string
  createdAtMs: number
}

export function writeSnapshotOwner(directory: string): string {
  const owner: SnapshotOwner = {
    pid: process.pid,
    token: randomUUID(),
    createdAtMs: Date.now(),
  }
  const stagedPath = join(directory, `${SNAPSHOT_OWNER_FILE}.copying`)
  fs.writeFileSync(stagedPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(stagedPath, join(directory, SNAPSHOT_OWNER_FILE))
  return owner.token
}

function readSnapshotOwner(directory: string): SnapshotOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(join(directory, SNAPSHOT_OWNER_FILE), 'utf8')) as Partial<SnapshotOwner>
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.token !== 'string' ||
      parsed.token.length === 0 ||
      typeof parsed.createdAtMs !== 'number' ||
      !Number.isFinite(parsed.createdAtMs)
    ) return null
    return {
      pid: parsed.pid,
      token: parsed.token,
      createdAtMs: parsed.createdAtMs,
    }
  } catch {
    return null
  }
}

function isSnapshotOwnerAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined
    return code !== 'ESRCH'
  }
}

export function cleanupStaleSnapshots(root: string, prefix: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  const cutoff = Date.now() - SNAPSHOT_STALE_MS
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const directory = join(root, entry.name)
    try {
      if (fs.statSync(directory).mtimeMs < cutoff) {
        const owner = readSnapshotOwner(directory)
        if (owner === null || isSnapshotOwnerAlive(owner.pid)) continue
        fs.rmSync(directory, { recursive: true, force: true })
      }
    } catch {
      // A concurrent reader or a platform file lock owns the directory.
    }
  }
}

export function cleanupSnapshotDirectory(
  directory: string | undefined,
  prefix: string,
  ownerToken?: string,
): void {
  if (!directory || !basename(directory).startsWith(prefix)) return
  if (ownerToken !== undefined) {
    const owner = readSnapshotOwner(directory)
    if (owner === null || owner.token !== ownerToken) return
  }
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // Close remains safe if a platform briefly holds a snapshot-side handle;
    // the bounded stale cleanup handles the remaining owned directory later.
  }
}
