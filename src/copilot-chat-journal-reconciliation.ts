import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getMetroraCacheDir } from './product-paths.js'
import { copilot } from './providers/copilot.js'
import type { SessionSource } from './providers/types.js'
import type { FileFingerprint } from './session-cache.js'
import { COPILOT_CHAT_JOURNAL_PROVIDER } from './provider-parse-authorities.js'

const MANIFEST_VERSION = 1
const MANIFEST_FILE = 'copilot-chat-journal-invalidations.v1.json'
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

type Manifest = {
  version: number
  sources: Record<string, string[]>
}

const pending = new Map<string, Set<string>>()
const previousTurns = new Map<string, JournalTurn[]>()
let suppressPendingInvalidation = false

export type CopilotChatJournalFingerprint = {
  path: string
  dev: number
  ino: number
  mtimeMs: number
  sizeBytes: number
}

function manifestPath(): string {
  return join(getMetroraCacheDir(), MANIFEST_FILE)
}

function sourceIdentity(sourcePath: string): string {
  // The path is an internal identity only. Persist its digest so the manifest
  // never becomes a source-path inventory or a privacy-bearing log.
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 24)
}

function validDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((value): value is string => typeof value === 'string' && DATE_KEY_RE.test(value)))].sort()
}

function mergeSourceDays(target: Map<string, Set<string>>, source: string, days: Iterable<string>): void {
  const existing = target.get(source) ?? new Set<string>()
  for (const day of days) {
    if (DATE_KEY_RE.test(day)) existing.add(day)
  }
  if (existing.size > 0) target.set(source, existing)
}

export function recordCopilotChatJournalInvalidation(sourcePath: string, days: Iterable<string>): void {
  if (suppressPendingInvalidation) return
  mergeSourceDays(pending, sourceIdentity(sourcePath), days)
}

function isChatSessionSource(source: SessionSource): source is SessionSource & { sourceType: 'chatsession' } {
  return (source as SessionSource & { sourceType?: unknown }).sourceType === 'chatsession'
}

/** Read only source identity/stat metadata; never return journal content. */
export async function getCopilotChatJournalFingerprints(): Promise<CopilotChatJournalFingerprint[]> {
  const sources = await copilot.discoverSessions().catch(() => [])
  const fingerprints: CopilotChatJournalFingerprint[] = []
  for (const source of sources) {
    if (!isChatSessionSource(source)) continue
    const current = await stat(source.path).catch(() => null)
    if (!current?.isFile()) continue
    fingerprints.push({
      path: source.path,
      dev: Number(current.dev),
      ino: Number(current.ino),
      mtimeMs: current.mtimeMs,
      sizeBytes: current.size,
    })
  }
  return fingerprints.sort((left, right) => left.path.localeCompare(right.path))
}

type JournalTurn = { timestamp: string }

type QueuedSource = {
  source: SessionSource
  fp: Pick<FileFingerprint, 'dev' | 'ino' | 'mtimeMs' | 'sizeBytes'>
}

export function queueCopilotChatJournalSource(
  providerName: string,
  source: SessionSource,
  fp: QueuedSource['fp'],
  turns: Iterable<JournalTurn>,
): QueuedSource {
  if (providerName === COPILOT_CHAT_JOURNAL_PROVIDER) {
    previousTurns.set(source.path, [...turns].map(turn => ({ timestamp: turn.timestamp })))
  }
  return { source, fp }
}

function turnDayKey(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function turnDays(turns: Iterable<JournalTurn>): string[] {
  return [...turns].map(turn => turnDayKey(turn.timestamp)).filter(Boolean)
}

/** Parser-facing adapter keeps the provider-specific invalidation policy here. */
export function recordCopilotChatJournalSourceChange(
  providerName: string,
  sourcePath: string,
  currentTurns: Iterable<JournalTurn>,
): void {
  if (providerName !== COPILOT_CHAT_JOURNAL_PROVIDER) return
  const oldTurns = previousTurns.get(sourcePath) ?? []
  recordCopilotChatJournalInvalidation(sourcePath, [...turnDays(oldTurns), ...turnDays(currentTurns)])
}

export function recordCopilotChatJournalSourceFailure(
  providerName: string,
  sourcePath: string,
): void {
  recordCopilotChatJournalSourceChange(providerName, sourcePath, [])
}

export function recordCopilotChatJournalSourceEviction(
  providerName: string,
  sourcePath: string,
  turns: Iterable<JournalTurn>,
): void {
  if (providerName !== COPILOT_CHAT_JOURNAL_PROVIDER) return
  recordCopilotChatJournalInvalidation(sourcePath, turnDays(turns))
}

/** Used only for an identity-ambiguous source-root switch. */
export function beginCopilotChatJournalIdentityBoundary(): void {
  suppressPendingInvalidation = true
}

export function endCopilotChatJournalIdentityBoundary(): void {
  suppressPendingInvalidation = false
}

function parseManifest(raw: unknown): Map<string, Set<string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map()
  const record = raw as Record<string, unknown>
  if (record['version'] !== MANIFEST_VERSION || !record['sources'] || typeof record['sources'] !== 'object' || Array.isArray(record['sources'])) {
    return new Map()
  }
  const result = new Map<string, Set<string>>()
  for (const [source, rawDays] of Object.entries(record['sources'] as Record<string, unknown>)) {
    const days = validDays(rawDays)
    if (days.length > 0) result.set(source, new Set(days))
  }
  return result
}

async function readManifest(): Promise<Map<string, Set<string>>> {
  try {
    return parseManifest(JSON.parse(await readFile(manifestPath(), 'utf-8')) as unknown)
  } catch {
    return new Map()
  }
}

async function writeManifest(values: Map<string, Set<string>>): Promise<void> {
  const path = manifestPath()
  await mkdir(getMetroraCacheDir(), { recursive: true })
  const sources: Record<string, string[]> = {}
  for (const [source, days] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const valid = [...days].filter(day => DATE_KEY_RE.test(day)).sort()
    if (valid.length > 0) sources[source] = valid
  }
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify({ version: MANIFEST_VERSION, sources } satisfies Manifest), { encoding: 'utf-8', mode: 0o600 })
  await rename(temp, path)
}

/** Publish parser-observed invalidations without exposing source content. */
export async function flushCopilotChatJournalInvalidations(): Promise<void> {
  if (pending.size === 0) {
    previousTurns.clear()
    return
  }
  const updates = new Map([...pending.entries()].map(([source, days]) => [source, new Set(days)] as const))
  const merged = await readManifest()
  for (const [source, days] of updates) mergeSourceDays(merged, source, days)
  await writeManifest(merged)
  for (const source of updates.keys()) pending.delete(source)
  previousTurns.clear()
}

/** Return all affected days, preserving source identity only inside the file. */
export async function readCopilotChatJournalInvalidatedDays(): Promise<string[]> {
  const manifest = await readManifest()
  return [...new Set([...manifest.values()].flatMap(days => [...days]))].sort()
}

export async function clearCopilotChatJournalInvalidations(): Promise<void> {
  // Keep an empty, versioned marker rather than removing an arbitrary file;
  // this is safe across concurrent readers and makes the authority explicit.
  if (!existsSync(getMetroraCacheDir())) return
  await writeManifest(new Map())
}
