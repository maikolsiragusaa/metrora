import { open, readdir, readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'
import zlib from 'zlib'

import { MAX_SESSION_FILE_BYTES, readSessionFile, readSessionLines } from '../fs-utils.js'
import type { SessionSource } from './types.js'

// Reading half of the DeepSeek Harness (dsh) collector: where the logs live,
// how a log is decompressed, and which of a session's rotated generations is
// authoritative. The parsing half is `dsh.ts`.
//
// DSH stores one session per directory:
//   <DSH_HOME|~/.dsh>/sessions/<encoded-cwd>/<session-id>/session[.vN].jsonl[.zstd]
// (or an uncompressed session.jsonl when compression=none). The .zstd file is
// a concatenation of INDEPENDENT zstd frames — one per appended event batch —
// so node:zlib's one-shot zstdDecompressSync (which decodes a single frame)
// must be driven frame-by-frame behind a structural frame-boundary scan. The
// scan below is a port of scanZstdFrames from the official
// @deepseek-ai/dsh-session-persistence-jsonl package.
//
// Ported from the upstream source snapshot's `src/providers/dsh.ts` at commit
// aded4c232622b82284f22d172cecb137354e3071 (MIT; the repository is named in
// THIRD_PARTY_NOTICES.md).
// Metrora extends it to Session format version 4, which upstream refuses: v4
// packs the per-attempt stream (including its usage chunk) INSIDE the
// `assistant/message` record instead of emitting sibling `assistant/chunk`
// events. Reading only the message's own `data.usage`, with the stream chunk as
// a fallback exactly as for v2/v3, keeps that split identity collapsed instead
// of double-counted.

// zstd landed in node:zlib in 22.15 / 23.8; the package floor is lower, so the
// provider degrades with a notice instead of assuming the export exists.
const zstdDecompress = (zlib as { zstdDecompressSync?: (buf: Buffer, opts?: { maxOutputLength?: number }) => Buffer }).zstdDecompressSync

const ZSTD_MAGIC = 0xfd2fb528

// SESSION_FORMAT_VERSION in @deepseek-ai/dsh-session. DSH refuses to load a log
// stamped with any other version, and a bump means an event's meaning changed,
// so a foreign version is skipped rather than read with today's assumptions.
// A zstd frame's declared content size is attacker-controlled, so a few KB of
// crafted input can expand to gigabytes. Every decode is capped: no single
// frame may exceed this, and no file may decode to more than it would have been
// allowed to occupy uncompressed (MAX_SESSION_FILE_BYTES). Overflow throws, and
// the caller skips the WHOLE file rather than counting the frames it got to.
export const MAX_FRAME_DECODED_BYTES = 64 * 1024 * 1024

// Versions this parser was written against: 0-3 are the set the upstream port
// already proved against real logs, 4 is the generation current DSH builds
// write (verified against real logs: header,
// request/context, request/header, turn/start, user/message, tool/call,
// assistant/message and assistant/attempt shapes are unchanged; the usage
// record moved inside the message's stream, never beside it).
export const SUPPORTED_SESSION_FORMAT_VERSIONS = new Set([0, 1, 2, 3, 4])
export const SESSION_LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/u

const MIN_REASONABLE_TIMESTAMP_MS = 1_000_000_000_000

// Discovery walks every session, so a per-file notice would repeat once per
// log; each distinct message is worth saying exactly once.
const noticed = new Set<string>()

export function noticeDsh(message: string): void {
  if (noticed.has(message)) return
  noticed.add(message)
  process.stderr.write(message)
}

// A notice naming a file cannot dedup on its text: a systematic problem prints
// one line per session and grows `noticed` without bound. Dedup on the kind
// instead and show a few example paths.
const PATH_NOTICE_EXAMPLES = 3
const noticedPaths = new Map<string, number>()

export function noticeDshPath(kind: string, detail: string): void {
  const seen = (noticedPaths.get(kind) ?? 0) + 1
  noticedPaths.set(kind, seen)
  if (seen <= PATH_NOTICE_EXAMPLES) process.stderr.write(`metrora: ${kind}: ${detail}\n`)
  else if (seen === PATH_NOTICE_EXAMPLES + 1) process.stderr.write(`metrora: ${kind}: further paths suppressed\n`)
}

export type DshUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  /** v4 reports the full-call total; the ledger uses the disjoint components. */
  totalTokens?: number
}

export type DshEvent = {
  type?: string
  seq?: number
  time?: number
  // Session header fields live at the top level of the first event.
  version?: number
  id?: string
  cwd?: string
  createdAt?: number
  parentSession?: string
  seedLength?: number
  isSeeded?: boolean
  data?: {
    turn?: number
    step?: number
    content?: Array<{ type?: string; text?: string }>
    // `user/message` carries the message author: a real prompt is
    // `{ kind: 'user' }`, agent-injected context (runtime snapshots, skill
    // catalogues, file-change notices) rides the same event type.
    source?: { kind?: string }
    header?: { config?: { model?: string; provider?: string } }
    provider?: string
    model?: string
    inherited?: boolean
    message?: { source?: { kind?: string; model?: string; provider?: string } }
    chunk?: { type?: string; usage?: DshUsage }
    stream?: Array<{
      type?: string
      time?: number
      chunk?: { type?: string; usage?: DshUsage }
    }>
    usage?: DshUsage
    name?: string
    arguments?: string
  }
}

type ZstdFrame = { start: number; end: number }

// Locate complete frames without decompressing their blocks. An EOF inside the
// final frame (a torn append from a crashed writer) returns its start so the
// caller can ignore the tail; invalid complete structure rejects.
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): { frames: ZstdFrame[]; tornStart?: number } {
  const frames: ZstdFrame[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid zstd frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)!
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

// Decode every complete frame and yield its JSONL lines. A torn final frame is
// ignored; a structurally corrupt file, or one that decodes past `budget`,
// throws for the caller to report. Exported for the decode-budget test.
export function* readZstdLines(
  buffer: Buffer,
  maxFrames = Number.POSITIVE_INFINITY,
  budget = MAX_SESSION_FILE_BYTES,
): Generator<string> {
  const { frames } = scanZstdFrames(buffer, maxFrames)
  let remaining = budget
  for (const frame of frames) {
    if (remaining <= 0) throw new Error(`decodes past the ${budget}-byte cap`)
    // node throws ERR_BUFFER_TOO_LARGE without allocating past the cap, so the
    // per-frame limit doubles as the running budget for the frames after it.
    const decoded = zstdDecompress!(buffer.subarray(frame.start, frame.end), {
      maxOutputLength: Math.min(remaining, MAX_FRAME_DECODED_BYTES),
    })
    remaining -= decoded.length
    for (const line of decoded.toString('utf-8').split('\n')) {
      if (line.trim()) yield line
    }
  }
}

export async function readDshEventLines(filePath: string): Promise<string[] | null> {
  if (filePath.endsWith('.zstd')) {
    if (!zstdDecompress) {
      noticeDsh('metrora: DSH sessions need Node >= 22.15 (zstd support); skipping DSH usage.\n')
      return null
    }
    let buffer: Buffer
    try {
      // The whole log is buffered to scan its frames, so it needs the same
      // oversize guard readSessionFile applies to the uncompressed variant.
      const size = (await stat(filePath)).size
      if (size > MAX_SESSION_FILE_BYTES) {
        noticeDshPath('skipped oversize DSH session log', `${filePath} (${size} bytes)`)
        return null
      }
      buffer = await readFile(filePath)
    } catch {
      return null
    }
    try {
      return [...readZstdLines(buffer)]
    } catch (err) {
      noticeDshPath('skipped corrupt DSH session log', `${filePath}: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }
  const content = await readSessionFile(filePath)
  if (content === null) return null
  return content.split('\n').filter(l => l.trim())
}

// Cheap discovery probe: decompress ONLY the first frame (the session header
// batch) instead of the whole log. The header frame is tiny, so a bounded head
// read almost always contains it; fall back to a full read when it does not.
export async function readDshSessionHeader(filePath: string): Promise<DshEvent | null> {
  const firstLine = async (): Promise<string | null> => {
    if (filePath.endsWith('.zstd')) {
      if (!zstdDecompress) return null
      let head: Buffer
      try {
        const handle = await open(filePath, 'r')
        try {
          const size = (await handle.stat()).size
          const length = Math.min(size, 256 * 1024)
          head = Buffer.alloc(length)
          await handle.read(head, 0, length, 0)
        } finally {
          await handle.close()
        }
      } catch {
        return null
      }
      let { frames } = scanZstdFrames(head, 1)
      if (frames.length === 0) {
        // Head read did not cover one full frame; take the whole file. A fork's
        // first batch carries the whole inherited seed, so this is reachable on
        // a real log and needs the same oversize guard as the parse read.
        try {
          if ((await stat(filePath)).size > MAX_SESSION_FILE_BYTES) return null
          const full = await readFile(filePath)
          frames = scanZstdFrames(full, 1).frames
          if (frames.length === 0) return null
          head = full
        } catch {
          return null
        }
      }
      const text = zstdDecompress(head.subarray(frames[0]!.start, frames[0]!.end), {
        maxOutputLength: MAX_FRAME_DECODED_BYTES,
      }).toString('utf-8')
      return text.split('\n').find(l => l.trim()) ?? null
    }
    for await (const line of readSessionLines(filePath)) {
      if (line.trim()) return line
    }
    return null
  }

  try {
    const line = await firstLine()
    if (!line) return null
    const event = JSON.parse(line) as DshEvent
    if (event.type !== 'session') return null
    return event
  } catch {
    return null
  }
}

// A log stamped with a version this parser was not written against is skipped
// whole: a bump means an event's meaning changed, so reading it with today's
// assumptions would report confident wrong numbers.
function isReadableVersion(header: DshEvent): boolean {
  if (typeof header.version === 'number' && SUPPORTED_SESSION_FORMAT_VERSIONS.has(header.version)) return true
  // Keyed on the version, not the path: a DSH upgrade makes EVERY session
  // unreadable at once, and one line per session log is noise, not a report.
  noticeDsh(`metrora: skipping DSH sessions written in session format version ${String(header.version)}; upgrade metrora.\n`)
  return false
}

function generationFromPath(filePath: string): number | undefined {
  const match = SESSION_LOG_NAME.exec(basename(filePath))
  if (!match) return undefined
  return match[1] === undefined ? 0 : Number(match[1])
}

export function dshHeaderMatchesPath(header: DshEvent, filePath: string): boolean {
  const generation = generationFromPath(filePath)
  if (generation === undefined || header.version !== generation) {
    noticeDshPath('skipping DSH session log whose filename and header versions disagree', filePath)
    return false
  }
  return isReadableVersion(header)
}

// DSH writes epoch milliseconds; promote a seconds-resolution value and reject
// what stays implausible, matching the guard cline-cli.ts uses on the hazard.
export function dshTimestamp(value: number | undefined, fallback: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  const ms = value < MIN_REASONABLE_TIMESTAMP_MS ? value * 1000 : value
  const date = new Date(ms)
  if (Number.isNaN(date.getTime()) || date.getTime() < MIN_REASONABLE_TIMESTAMP_MS) return fallback
  return date.toISOString()
}

export function getDshHome(override?: string): string {
  // An empty-string DSH_HOME is treated as unset.
  return override ?? (process.env['DSH_HOME'] || undefined) ?? join(homedir(), '.dsh')
}

// DSH writes native-platform paths into the header (backslashes on Windows);
// split on both separators so discovery is correct on any host.
export function projectFromCwd(cwd: string, fallback: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? fallback
}

export async function discoverDshSessionsInDir(sessionsDir: string): Promise<SessionSource[]> {
  const sources: SessionSource[] = []

  let projectDirs: string[]
  try {
    projectDirs = await readdir(sessionsDir)
  } catch {
    return sources
  }

  for (const dirName of projectDirs) {
    const dirPath = join(sessionsDir, dirName)
    const dirStat = await stat(dirPath).catch(() => null)
    if (!dirStat?.isDirectory()) continue

    let sessionDirs: string[]
    try {
      sessionDirs = await readdir(dirPath)
    } catch {
      continue
    }

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(dirPath, sessionDir)
      const sessionStat = await stat(sessionPath).catch(() => null)
      if (!sessionStat?.isDirectory()) continue

      // DSH keeps migrated generations beside their immutable predecessors.
      // Resolve the numerically highest canonical generation once per Session;
      // never fall back to an older snapshot when that authoritative file is
      // unknown or corrupt, since that would silently report stale usage.
      const generationFiles: Array<{ path: string; version: number; compressed: boolean }> = []
      const slots = new Set<string>()
      let ambiguous: number | undefined
      const names = await readdir(sessionPath).catch(() => [])
      for (const name of names) {
        const match = SESSION_LOG_NAME.exec(name)
        if (!match) continue
        const version = match[1] === undefined ? 0 : Number(match[1])
        const candidate = join(sessionPath, name)
        const fileStat = await stat(candidate).catch(() => null)
        if (!fileStat?.isFile()) continue
        const compressed = name.endsWith('.zstd')
        // `session.v0.jsonl` names the unversioned generation and
        // `session.v03.jsonl` names generation 3, so two files can claim one
        // generation; past 2^53 a generation cannot be ordered at all. Either
        // way no canonical log can be resolved, and dropping the session
        // silently is the omission #1281 was about.
        const slot = `${version}:${String(compressed)}`
        if (!Number.isSafeInteger(version) || slots.has(slot)) {
          ambiguous ??= version
          continue
        }
        slots.add(slot)
        generationFiles.push({ path: candidate, version, compressed })
      }
      if (ambiguous !== undefined) {
        noticeDshPath('skipping DSH session whose generation filenames are ambiguous', sessionPath)
        continue
      }
      generationFiles.sort((a, b) => b.version - a.version || Number(b.compressed) - Number(a.compressed))
      const selected = generationFiles[0]
      if (!selected) continue
      const filePath = selected.path

      if (!SUPPORTED_SESSION_FORMAT_VERSIONS.has(selected.version)) {
        noticeDsh(`metrora: skipping DSH sessions written in session format version ${selected.version}; upgrade metrora.\n`)
        continue
      }

      // Without zstd every compressed header reads as unreadable, so say why
      // once rather than naming every session log.
      if (selected.compressed && !zstdDecompress) {
        noticeDsh('metrora: DSH sessions need Node >= 22.15 (zstd support); skipping DSH usage.\n')
        continue
      }

      const header = await readDshSessionHeader(filePath)
      if (!header) {
        noticeDshPath('skipping unreadable DSH session header', filePath)
        continue
      }
      if (!dshHeaderMatchesPath(header, filePath)) continue

      const cwd = typeof header.cwd === 'string' && header.cwd.trim() ? header.cwd : dirName
      sources.push({ path: filePath, project: projectFromCwd(cwd, dirName), provider: 'dsh' })
    }
  }

  return sources.sort((left, right) => left.path.localeCompare(right.path))
}
