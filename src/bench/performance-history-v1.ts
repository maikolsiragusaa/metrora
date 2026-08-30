import { open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWritePrivateFile, cleanupStaleAtomicTemps, ensurePrivateDirectory, removePrivateFile } from '../local-state/atomic-file.js'
import { defaultMetroraDataDir } from '../local-state/endpoint-identity.js'
import { withLocalStateLease } from '../local-state/local-state-lease.js'
import { sha256Json } from './serialization.js'
import {
  PERFORMANCE_BENCH_METHOD_ID,
  PERFORMANCE_BENCH_METHOD_VERSION,
  PERFORMANCE_BENCH_RUNNER_ID,
  PERFORMANCE_BENCH_RUNNER_VERSION,
  PERFORMANCE_BENCH_RUNTIME_ID,
  PERFORMANCE_BENCH_SCHEMA_VERSION,
  PERFORMANCE_HISTORY_KIND,
  PERFORMANCE_HISTORY_VERSION,
  performanceResultDigest,
  type PerformanceRunV1,
} from './performance-contract-v1.js'

export const PERFORMANCE_HISTORY_MAX_RECORDS = 50
export const PERFORMANCE_HISTORY_MAX_BYTES = 5 * 1024 * 1024
export const PERFORMANCE_HISTORY_MAX_CANDIDATE_FILES = PERFORMANCE_HISTORY_MAX_RECORDS * 4
export const PERFORMANCE_HISTORY_MAX_FILE_BYTES = 512 * 1024
export const PERFORMANCE_HISTORY_MAX_INVALID_FILES = 16
export const PERFORMANCE_HISTORY_MAX_INVALID_DIAGNOSTICS = 32

const Setup = z.object({
  repetitions: z.number().int().min(1).max(5),
  promptTokens: z.number().int().min(1).max(8192),
  generationTokens: z.number().int().min(1).max(8192),
  batchSize: z.number().int().min(1).max(8192),
  ubatchSize: z.number().int().min(1).max(8192),
  threads: z.number().int().min(1).max(256).nullable(),
  gpuLayers: z.number().int().min(-1).max(512),
  flashAttention: z.enum(['auto', 'on', 'off']),
  splitMode: z.enum(['none', 'layer', 'row']),
  mainGpu: z.number().int().min(0).max(64).nullable(),
  warmup: z.boolean(),
}).strict()

const Workload = z.object({
  workload: z.enum(['prefill', 'decode', 'mixed', 'unknown']),
  promptTokens: z.number().int().nonnegative().nullable(),
  generationTokens: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative().nullable(),
  repetitions: z.number().int().nonnegative().nullable(),
  throughputTokensPerSecond: z.number().nonnegative().nullable(),
  throughputStddevTokensPerSecond: z.number().nonnegative().nullable(),
  averageTimeNs: z.number().nonnegative().nullable(),
  averageLatencyMs: z.number().nonnegative().nullable(),
  testTime: z.string().datetime({ offset: true }).nullable(),
}).strict()

const ObservedConfiguration = z.object({
  batchSize: z.number().int().positive().nullable(),
  ubatchSize: z.number().int().positive().nullable(),
  threads: z.number().int().positive().nullable(),
  gpuLayers: z.number().int().min(-1).max(512).nullable(),
  splitMode: z.enum(['none', 'layer', 'row', 'tensor']).nullable(),
  mainGpu: z.number().int().nonnegative().nullable(),
  flashAttention: z.enum(['auto', 'on', 'off']).nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  generationTokens: z.number().int().nonnegative().nullable(),
  repetitions: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative().nullable(),
}).strict()

const Performance = z.object({
  schemaVersion: z.literal(PERFORMANCE_BENCH_SCHEMA_VERSION),
  runId: z.string().min(1).max(128),
  runner: z.object({ id: z.literal(PERFORMANCE_BENCH_RUNNER_ID), version: z.literal(PERFORMANCE_BENCH_RUNNER_VERSION) }).strict(),
  methodology: z.object({
    id: z.literal(PERFORMANCE_BENCH_METHOD_ID),
    version: z.literal(PERFORMANCE_BENCH_METHOD_VERSION),
    setup: Setup,
    argvDigest: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  model: z.object({
    selected: z.string().min(1).max(160),
    reported: z.string().min(1).max(160).nullable(),
    type: z.string().min(1).max(512).nullable(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    parameterCount: z.number().int().nonnegative().nullable(),
  }).strict(),
  executable: z.object({ name: z.string().min(1).max(160) }).strict(),
  runtime: z.object({
    id: z.literal(PERFORMANCE_BENCH_RUNTIME_ID),
    buildCommit: z.string().min(1).max(512).nullable(),
    buildNumber: z.number().int().nonnegative().nullable(),
    version: z.string().min(1).max(512).nullable(),
    backends: z.array(z.string().min(1).max(160)).max(32),
  }).strict(),
  hardware: z.object({
    cpuInfo: z.string().min(1).max(512).nullable(),
    gpuInfo: z.string().min(1).max(512).nullable(),
    devices: z.array(z.string().min(1).max(160)).max(32),
  }).strict(),
  environment: z.object({ os: z.string().min(1).max(240), arch: z.string().min(1).max(64), node: z.string().min(1).max(64) }).strict(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  status: z.enum(['completed', 'unavailable', 'failed', 'cancelled']),
  termination: z.object({ status: z.enum(['none', 'timeout', 'cancelled', 'output-limit', 'spawn-error', 'malformed-output']) }).strict(),
  failure: z.object({ code: z.string().min(1).max(64), message: z.string().min(1).max(240) }).strict().nullable(),
  observedConfiguration: ObservedConfiguration.nullable(),
  workloads: z.array(Workload).max(16),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((record, ctx) => {
  if (Date.parse(record.startedAt) > Date.parse(record.endedAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endedAt'], message: 'endedAt must not precede startedAt' })
  if (record.status === 'completed' && !record.workloads.some(workload => workload.workload !== 'unknown')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workloads'], message: 'completed Performance runs must retain a recognized workload' })
  if (record.status === 'cancelled' && record.termination.status !== 'cancelled') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['termination', 'status'], message: 'cancelled runs must retain cancelled termination' })
  if (record.status === 'completed' && record.observedConfiguration) {
    const declared = record.methodology.setup
    const observed = record.observedConfiguration
    const checks: Array<[keyof typeof observed, number | string | null, number | string | null]> = [
      ['batchSize', observed.batchSize, declared.batchSize],
      ['ubatchSize', observed.ubatchSize, declared.ubatchSize],
      ['gpuLayers', observed.gpuLayers, declared.gpuLayers],
      ['splitMode', observed.splitMode, declared.splitMode],
      ['flashAttention', observed.flashAttention, declared.flashAttention],
      ['promptTokens', observed.promptTokens, declared.promptTokens],
      ['generationTokens', observed.generationTokens, declared.generationTokens],
      ['repetitions', observed.repetitions, declared.repetitions],
    ]
    if (declared.threads !== null) checks.push(['threads', observed.threads, declared.threads])
    if (declared.mainGpu !== null) checks.push(['mainGpu', observed.mainGpu, declared.mainGpu])
    for (const [field, actual, expected] of checks) {
      if (actual !== null && actual !== expected) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['observedConfiguration', field], message: 'observed configuration does not match declared setup' })
    }
  }
  if (record.resultDigest !== performanceResultDigest(record as PerformanceRunV1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resultDigest'], message: 'result digest does not match retained Performance evidence' })
})

const HistoryFile = z.object({ kind: z.literal(PERFORMANCE_HISTORY_KIND), version: z.literal(PERFORMANCE_HISTORY_VERSION), recordSha256: z.string().regex(/^[0-9a-f]{64}$/), record: Performance }).strict()

export type PerformanceHistoryScanV1 = { records: PerformanceRunV1[]; invalid: Array<{ file: string; reason: string }> }
export type PerformanceHistoryOptions = { dataDir?: string }
type ScannedHistoryFile = { file: string; byteLength: number; record: PerformanceRunV1 | null; reason?: string }
type PreparedScan = PerformanceHistoryScanV1 & { files: ScannedHistoryFile[]; candidateScanTruncated: boolean }
type BoundedRead =
  | { kind: 'missing'; byteLength: 0 }
  | { kind: 'ok'; bytes: Buffer; byteLength: number }
  | { kind: 'invalid'; byteLength: number; reason: string }

function paths(dataDir: string) {
  const root = join(dataDir, 'bench-history', 'performance-v1')
  return { root, records: join(root, 'records') }
}

export function performanceHistoryDirectoryV1(dataDir = defaultMetroraDataDir()): string {
  return paths(dataDir).records
}

function fileName(runId: string): string {
  return sha256Json([PERFORMANCE_HISTORY_KIND, runId]) + '.json'
}

function recordDigest(record: PerformanceRunV1): string {
  return sha256Json(record)
}

export function parsePerformanceRunV1(input: unknown): PerformanceRunV1 {
  return Performance.parse(input) as PerformanceRunV1
}

async function prepare(dataDir: string) {
  const value = paths(dataDir)
  await ensurePrivateDirectory(value.records)
  await cleanupStaleAtomicTemps(value.records)
  return value
}

const FILE_PATTERN = /^[0-9a-f]{64}\.json$/

function diagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (raw.replace(/[\r\n]+/gu, ' ').slice(0, 240) || 'Performance history file is invalid')
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function readBounded(path: string): Promise<BoundedRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const info = await handle.stat()
    if (!info.isFile()) return { kind: 'invalid', byteLength: 0, reason: 'history path is not a regular file' }
    const size = Number(info.size)
    if (!Number.isSafeInteger(size) || size < 0) return { kind: 'invalid', byteLength: PERFORMANCE_HISTORY_MAX_FILE_BYTES + 1, reason: 'history file size was not safely bounded' }
    if (size > PERFORMANCE_HISTORY_MAX_FILE_BYTES) return { kind: 'invalid', byteLength: size, reason: 'history file exceeds the bounded byte limit' }
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const chunk = await handle.read(bytes, offset, size - offset, offset)
      if (chunk.bytesRead === 0) break
      offset += chunk.bytesRead
    }
    const finalSize = Number((await handle.stat()).size)
    if (finalSize > PERFORMANCE_HISTORY_MAX_FILE_BYTES) return { kind: 'invalid', byteLength: finalSize, reason: 'history file exceeded the bounded byte limit while being read' }
    if (offset !== size || finalSize !== size) return { kind: 'invalid', byteLength: Math.max(0, finalSize), reason: 'history file changed during the bounded read' }
    return { kind: 'ok', bytes, byteLength: size }
  } catch (error) {
    if (missing(error)) return { kind: 'missing', byteLength: 0 }
    return { kind: 'invalid', byteLength: 0, reason: diagnostic(error) }
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

async function candidates(recordsDir: string): Promise<{ files: string[]; truncated: boolean }> {
  const directory = await opendir(recordsDir)
  const files: string[] = []
  try {
    while (files.length < PERFORMANCE_HISTORY_MAX_CANDIDATE_FILES) {
      const entry = await directory.read()
      if (!entry) return { files: files.sort(), truncated: false }
      if (entry.isFile() && FILE_PATTERN.test(entry.name)) files.push(entry.name)
    }
    return { files: files.sort(), truncated: true }
  } finally {
    await directory.close().catch(() => undefined)
  }
}

function compareRecords(left: PerformanceRunV1, right: PerformanceRunV1): number {
  return Date.parse(right.endedAt) - Date.parse(left.endedAt) || left.runId.localeCompare(right.runId)
}

async function scanFile(recordsDir: string, file: string): Promise<ScannedHistoryFile | null> {
  const read = await readBounded(join(recordsDir, file))
  if (read.kind === 'missing') return null
  const scanned: ScannedHistoryFile = { file, byteLength: read.byteLength, record: null }
  if (read.kind === 'invalid') return { ...scanned, reason: read.reason }
  try {
    const wrapper = HistoryFile.parse(JSON.parse(read.bytes.toString('utf8')))
    if (fileName(wrapper.record.runId) !== file) throw new Error('run id does not match history filename')
    if (wrapper.recordSha256 !== recordDigest(wrapper.record as PerformanceRunV1)) throw new Error('history record digest mismatch')
    scanned.record = wrapper.record as PerformanceRunV1
  } catch (error) {
    return { ...scanned, reason: diagnostic(error) }
  }
  return scanned
}

async function scanPrepared(recordsDir: string): Promise<PreparedScan> {
  const records: PerformanceRunV1[] = []
  const files: ScannedHistoryFile[] = []
  const invalid: PerformanceHistoryScanV1['invalid'] = []
  let omitted = 0
  const addInvalid = (file: string, reason: string): void => {
    if (invalid.length < PERFORMANCE_HISTORY_MAX_INVALID_DIAGNOSTICS - 1) invalid.push({ file, reason: diagnostic(reason) })
    else omitted += 1
  }
  const found = await candidates(recordsDir)
  for (const file of found.files) {
    const scanned = await scanFile(recordsDir, file)
    if (!scanned) continue
    files.push(scanned)
    if (scanned.record) records.push(scanned.record)
    else addInvalid(file, scanned.reason ?? 'history file is invalid')
  }
  if (found.truncated) addInvalid('<candidate-scan>', 'history candidate scan stopped at the bounded file limit')
  if (omitted > 0) invalid.push({ file: '<bounded-diagnostics>', reason: `${omitted} additional invalid history diagnostics were omitted` })
  records.sort(compareRecords)
  return { records, invalid, files, candidateScanTruncated: found.truncated }
}

function addNewest(candidates: ScannedHistoryFile[], candidate: ScannedHistoryFile): void {
  candidates.push(candidate)
  candidates.sort((left, right) => compareRecords(left.record!, right.record!))
  if (candidates.length > PERFORMANCE_HISTORY_MAX_RECORDS) candidates.pop()
}

function addInvalid(candidates: ScannedHistoryFile[], candidate: ScannedHistoryFile): void {
  if (candidate.byteLength > PERFORMANCE_HISTORY_MAX_FILE_BYTES) return
  candidates.push(candidate)
  candidates.sort((left, right) => left.file.localeCompare(right.file))
  if (candidates.length > PERFORMANCE_HISTORY_MAX_INVALID_FILES) candidates.pop()
}

async function prune(recordsDir: string): Promise<void> {
  const valid: ScannedHistoryFile[] = []
  const invalid: ScannedHistoryFile[] = []
  const directory = await opendir(recordsDir)
  try {
    for await (const entry of directory) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue
      const scanned = await scanFile(recordsDir, entry.name)
      if (!scanned) continue
      if (scanned.record) addNewest(valid, scanned)
      else addInvalid(invalid, scanned)
    }
  } finally {
    await directory.close().catch(() => undefined)
  }
  const keep = new Set<string>()
  let bytes = 0
  for (const item of valid) {
    if (keep.size >= PERFORMANCE_HISTORY_MAX_RECORDS || bytes + item.byteLength > PERFORMANCE_HISTORY_MAX_BYTES) continue
    keep.add(item.file)
    bytes += item.byteLength
  }
  for (const item of invalid) {
    if (invalid.filter(candidate => keep.has(candidate.file)).length >= PERFORMANCE_HISTORY_MAX_INVALID_FILES || bytes + item.byteLength > PERFORMANCE_HISTORY_MAX_BYTES) continue
    keep.add(item.file)
    bytes += item.byteLength
  }
  const cleanup = await opendir(recordsDir)
  try {
    for await (const entry of cleanup) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name) || keep.has(entry.name)) continue
      await removePrivateFile(join(recordsDir, entry.name))
    }
  } finally {
    await cleanup.close().catch(() => undefined)
  }
}

export async function scanPerformanceHistoryV1(options: PerformanceHistoryOptions = {}): Promise<PerformanceHistoryScanV1> {
  const scan = await scanPrepared((await prepare(options.dataDir ?? defaultMetroraDataDir())).records)
  return { records: scan.records, invalid: scan.invalid }
}

export async function savePerformanceRunV1(recordInput: PerformanceRunV1, options: PerformanceHistoryOptions = {}): Promise<{ status: 'saved' | 'duplicate'; record: PerformanceRunV1 }> {
  const record = parsePerformanceRunV1(recordInput)
  const value = await prepare(options.dataDir ?? defaultMetroraDataDir())
  return withLocalStateLease(value.root, async () => {
    const file = fileName(record.runId)
    const path = join(value.records, file)
    const existing = await readBounded(path)
    if (existing.kind === 'ok') {
      const parsed = HistoryFile.parse(JSON.parse(existing.bytes.toString('utf8')))
      if (parsed.recordSha256 === recordDigest(record)) return { status: 'duplicate', record: parsed.record as PerformanceRunV1 }
      throw new Error('Performance history run id collision with different content')
    }
    if (existing.kind === 'invalid') throw new Error('Performance history run id collision with invalid existing content')
    await atomicWritePrivateFile(path, JSON.stringify({ kind: PERFORMANCE_HISTORY_KIND, version: PERFORMANCE_HISTORY_VERSION, recordSha256: recordDigest(record), record }))
    const scan = await scanPrepared(value.records)
    if (scan.candidateScanTruncated) await prune(value.records)
    else {
      const valid = scan.files.filter(item => item.record !== null).sort((left, right) => compareRecords(left.record!, right.record!))
      const invalid = scan.files.filter(item => item.record === null).sort((left, right) => left.file.localeCompare(right.file))
      const keep = new Set<string>()
      let bytes = 0
      for (const item of valid) {
        if (keep.size >= PERFORMANCE_HISTORY_MAX_RECORDS || bytes + item.byteLength > PERFORMANCE_HISTORY_MAX_BYTES) continue
        keep.add(item.file)
        bytes += item.byteLength
      }
      let invalidKept = 0
      for (const item of invalid) {
        if (invalidKept >= PERFORMANCE_HISTORY_MAX_INVALID_FILES || item.byteLength > PERFORMANCE_HISTORY_MAX_FILE_BYTES || bytes + item.byteLength > PERFORMANCE_HISTORY_MAX_BYTES) continue
        keep.add(item.file)
        bytes += item.byteLength
        invalidKept += 1
      }
      for (const item of scan.files) if (!keep.has(item.file)) await removePrivateFile(join(value.records, item.file))
    }
    return { status: 'saved', record }
  })
}
