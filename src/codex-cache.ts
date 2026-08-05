import { readFile, mkdir, stat, open, rename, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'

import type { ParsedProviderCall } from './providers/types.js'

// v4: attribute MCP calls emitted as event_msg/mcp_tool_call_end (issue #478).
// Recent Codex sessions cached under v3 dropped these, so force a re-parse.
// v5: also attribute CLI-wrapped MCP calls (`mcp-cli call server tool`) that
// Codex logs as a plain exec_command (issue #478 follow-up). Force a re-parse
// so sessions cached under v4 pick up the CLI-MCP attribution.
// v6/v7: rich-session-capture — per-call locAdded/locRemoved/editFailed from
// patch_apply_end. Sessions cached under v5 lack these fields; re-parse to add.
// v8: persist native MCP timing and compact invocation attribution.
// v9: persist explicit per-call reasoning attribution from turn_context.
// v10: reprice raw Codex model ids carrying numeric context-capacity tags.
const CODEX_CACHE_VERSION = 10
const CACHE_FILE = 'codex-results.json'

type FileFingerprint = { mtimeMs: number; sizeBytes: number }

type FileEntry = {
  mtimeMs: number
  sizeBytes: number
  project: string
  calls: ParsedProviderCall[]
}

type ResultCache = {
  version: number
  files: Record<string, FileEntry>
}

function getCacheDir(): string {
  return process.env['CODEBURN_CACHE_DIR'] ?? join(homedir(), '.cache', 'codeburn')
}

function getCachePath(): string {
  return join(getCacheDir(), CACHE_FILE)
}

async function loadCache(): Promise<ResultCache> {
  try {
    const parsed = JSON.parse(await readFile(getCachePath(), 'utf8')) as Partial<ResultCache>
    if (parsed.version === CODEX_CACHE_VERSION && parsed.files && typeof parsed.files === 'object') {
      return { version: CODEX_CACHE_VERSION, files: parsed.files }
    }
  } catch { /* cold or invalid cache */ }
  return { version: CODEX_CACHE_VERSION, files: {} }
}

let cachePromise: Promise<ResultCache> | null = null

function sharedCache(): Promise<ResultCache> {
  if (!cachePromise) cachePromise = loadCache()
  return cachePromise
}

async function fingerprint(path: string): Promise<FileFingerprint | null> {
  try {
    const s = await stat(path)
    return { mtimeMs: s.mtimeMs, sizeBytes: s.size }
  } catch {
    return null
  }
}

function sameFingerprint(entry: FileEntry, fp: FileFingerprint): boolean {
  return entry.mtimeMs === fp.mtimeMs && entry.sizeBytes === fp.sizeBytes
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await open(tmp, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, path)
  } catch (error) {
    try { await unlink(tmp) } catch { /* ignore */ }
    throw error
  }
}

let saveChain: Promise<void> = Promise.resolve()

async function persist(cache: ResultCache): Promise<void> {
  saveChain = saveChain.then(() => atomicWrite(getCachePath(), JSON.stringify(cache)))
  await saveChain
}

export async function readCachedCodexResults(path: string): Promise<ParsedProviderCall[] | null> {
  const fp = await fingerprint(path)
  if (!fp) return null
  const cache = await sharedCache()
  const entry = cache.files[path]
  if (!entry || !sameFingerprint(entry, fp)) return null
  return entry.calls
}

export async function writeCachedCodexResults(
  path: string,
  project: string,
  calls: ParsedProviderCall[],
): Promise<void> {
  const fp = await fingerprint(path)
  if (!fp) return
  const cache = await sharedCache()
  cache.files[path] = { ...fp, project, calls }
  await persist(cache)
}

export function resetCodexCacheForTests(): void {
  cachePromise = null
  saveChain = Promise.resolve()
}
