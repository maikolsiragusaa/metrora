import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getMetroraCacheDir } from './product-paths.js'

const MANIFEST_VERSION = 1
const MANIFEST_FILE = 'opencode-daily-invalidations.v1.json'
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

type Manifest = {
  version: typeof MANIFEST_VERSION
  days: string[]
}

type TimestampedTurn = { timestamp: string }

const pending = new Set<string>()

function manifestPath(): string {
  return join(getMetroraCacheDir(), MANIFEST_FILE)
}

function turnDayKey(timestamp: string): string | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return DATE_KEY_RE.test(key) ? key : null
}

function turnDays(turns: Iterable<TimestampedTurn>): string[] {
  return [...turns]
    .map(turn => turnDayKey(turn.timestamp))
    .filter((day): day is string => day !== null)
}

function addDays(days: Iterable<string>): void {
  for (const day of days) {
    if (DATE_KEY_RE.test(day)) pending.add(day)
  }
}

function parseManifest(raw: unknown): Set<string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Set()
  const value = raw as Partial<Manifest>
  if (value.version !== MANIFEST_VERSION || !Array.isArray(value.days)) return new Set()
  return new Set(value.days.filter((day): day is string => typeof day === 'string' && DATE_KEY_RE.test(day)))
}

async function readManifest(): Promise<Set<string>> {
  try {
    return parseManifest(JSON.parse(await readFile(manifestPath(), 'utf8')) as unknown)
  } catch {
    return new Set()
  }
}

async function writeManifest(days: Iterable<string>): Promise<void> {
  const path = manifestPath()
  await mkdir(getMetroraCacheDir(), { recursive: true })
  const payload: Manifest = {
    version: MANIFEST_VERSION,
    days: [...new Set(days)].filter(day => DATE_KEY_RE.test(day)).sort(),
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporaryPath, path)
    } catch {
      // Windows may reject rename-over-existing-file. The marker is disposable,
      // so replacing it directly is safe and keeps the retry evidence alive.
      await writeFile(path, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

/** Record both sides of a source rewrite so additions and deletions converge. */
export function recordOpenCodeSourceChange(
  providerName: string,
  previousTurns: Iterable<TimestampedTurn>,
  currentTurns: Iterable<TimestampedTurn>,
): void {
  if (providerName !== 'opencode') return
  addDays(turnDays(previousTurns))
  addDays(turnDays(currentTurns))
}

export function recordOpenCodeSourceFailure(
  providerName: string,
  previousTurns: Iterable<TimestampedTurn>,
): void {
  recordOpenCodeSourceChange(providerName, previousTurns, [])
}

export function recordOpenCodeSourceEviction(
  providerName: string,
  turns: Iterable<TimestampedTurn>,
): void {
  recordOpenCodeSourceChange(providerName, turns, [])
}

/** Publish parser-observed OpenCode day invalidations without source paths. */
export async function flushOpenCodeDailyInvalidations(): Promise<void> {
  if (pending.size === 0) return
  const updates = new Set(pending)
  const merged = await readManifest()
  for (const day of updates) merged.add(day)
  await writeManifest(merged)
  for (const day of updates) pending.delete(day)
}

export async function readOpenCodeDailyInvalidatedDays(): Promise<string[]> {
  return [...await readManifest()].sort()
}

export async function clearOpenCodeDailyInvalidations(): Promise<void> {
  pending.clear()
  if (!existsSync(getMetroraCacheDir())) return
  await writeManifest([])
}
