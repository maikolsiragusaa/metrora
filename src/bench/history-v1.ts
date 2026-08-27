import { open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWritePrivateFile, cleanupStaleAtomicTemps, ensurePrivateDirectory, removePrivateFile } from '../local-state/atomic-file.js'
import { defaultMetroraDataDir } from '../local-state/endpoint-identity.js'
import { withLocalStateLease } from '../local-state/local-state-lease.js'
import { sha256Json } from './serialization.js'
import { FIXED_GENERATION_PARAMETERS } from './contract-v1.js'
import { CORE_TASK_PACK_V1 } from './task-pack-v1.js'
import { BENCH_EVALUATION_SCHEMA_VERSION, digestBenchEvaluationV1, type BenchEvaluationV1 } from './task-pack-run-v1.js'

export const BENCH_HISTORY_KIND = 'metrora.bench-history.v1' as const
export const BENCH_HISTORY_VERSION = 1 as const
export const BENCH_HISTORY_MAX_RECORDS = 50
export const BENCH_HISTORY_MAX_BYTES = 5 * 1024 * 1024
export const BENCH_HISTORY_MAX_CANDIDATE_FILES = BENCH_HISTORY_MAX_RECORDS * 4
export const BENCH_HISTORY_MAX_FILE_BYTES = 512 * 1024
export const BENCH_HISTORY_MAX_INVALID_FILES = 16
export const BENCH_HISTORY_MAX_INVALID_DIAGNOSTICS = 32

const RuntimeMetrics = z.object({ totalDurationNs: z.number().int().nonnegative().nullable(), loadDurationNs: z.number().int().nonnegative().nullable(), promptEvalCount: z.number().int().nonnegative().nullable(), promptEvalDurationNs: z.number().int().nonnegative().nullable(), evalCount: z.number().int().nonnegative().nullable(), evalDurationNs: z.number().int().nonnegative().nullable() }).strict()
const TaskResult = z.object({
  taskId: z.string().min(1).max(128), attempted: z.boolean(), status: z.enum(['passed', 'failed', 'malformed', 'unavailable', 'timeout', 'cancelled']), score: z.union([z.literal(0), z.literal(1), z.null()]), outputDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable(), outputChars: z.number().int().nonnegative().max(32_768).nullable(), requestLatencyMs: z.number().nonnegative().nullable(), timeToFirstContentMs: z.number().nonnegative().nullable(), runtimeReported: RuntimeMetrics, failure: z.object({ code: z.string().min(1).max(64), message: z.string().min(1).max(240) }).strict().nullable(),
}).strict()
const EvaluationShape = z.object({
  schemaVersion: z.literal(BENCH_EVALUATION_SCHEMA_VERSION), runId: z.string().min(1).max(128), runner: z.object({ id: z.literal('ollama-task-pack-v1'), version: z.literal('1.0.0') }).strict(), pack: z.object({ packId: z.literal('metrora.bench.core'), version: z.literal('1.0.0'), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), model: z.object({ selected: z.string().min(1).max(200), reported: z.string().min(1).max(200).nullable() }).strict(), runtime: z.object({ id: z.literal('ollama-local'), endpoint: z.literal('http://127.0.0.1:11434'), version: z.string().max(128).nullable() }).strict(), environment: z.object({ os: z.string().min(1).max(240), arch: z.string().min(1).max(64), node: z.string().min(1).max(64) }).strict(), generation: z.object({ parameters: z.object({ temperature: z.number(), seed: z.number().int(), numPredict: z.number().int() }).strict(), policy: z.literal('one-bounded-request-per-task') }).strict(), startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }), status: z.enum(['completed', 'unavailable', 'cancelled']), tasks: z.array(TaskResult).min(1).max(64), aggregate: z.object({ planned: z.number().int().nonnegative().max(64), attempted: z.number().int().nonnegative().max(64), passed: z.number().int().nonnegative().max(64), failed: z.number().int().nonnegative().max(64), unavailable: z.number().int().nonnegative().max(64), cancelled: z.number().int().nonnegative().max(64), score: z.object({ numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(), value: z.number().min(0).max(1).nullable() }).strict() }).strict(), resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
const Evaluation = EvaluationShape.superRefine((record, ctx) => {
  const issue = (path: (string | number)[], message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  const tasks = record.tasks
  const counts = {
    attempted: tasks.filter(task => task.attempted).length,
    passed: tasks.filter(task => task.status === 'passed').length,
    failed: tasks.filter(task => task.status === 'failed' || task.status === 'malformed').length,
    unavailable: tasks.filter(task => task.status === 'unavailable' || task.status === 'timeout').length,
    cancelled: tasks.filter(task => task.status === 'cancelled').length,
    scored: tasks.filter(task => task.score !== null).length,
    passedScore: tasks.filter(task => task.score === 1).length,
  }
  if (record.aggregate.planned !== tasks.length) issue(['aggregate', 'planned'], 'planned count must equal the retained task count')
  for (const key of ['attempted', 'passed', 'failed', 'unavailable', 'cancelled'] as const) {
    if (record.aggregate[key] !== counts[key]) issue(['aggregate', key], key + ' count does not match retained task results')
  }
  if (record.aggregate.score.numerator !== counts.passedScore) issue(['aggregate', 'score', 'numerator'], 'score numerator must equal passed scored tasks')
  if (record.aggregate.score.denominator !== counts.scored) issue(['aggregate', 'score', 'denominator'], 'score denominator must equal scored tasks')
  if (record.aggregate.score.numerator > record.aggregate.score.denominator) issue(['aggregate', 'score'], 'score numerator cannot exceed its denominator')
  const expectedScore = counts.scored === 0 ? null : counts.passedScore / counts.scored
  if (record.aggregate.score.value === null ? expectedScore !== null : expectedScore === null || Math.abs(record.aggregate.score.value - expectedScore) > 1e-12) {
    issue(['aggregate', 'score', 'value'], 'score value does not match its numerator and denominator')
  }
  const expectedStatus = counts.cancelled > 0 ? 'cancelled' : counts.unavailable > 0 ? 'unavailable' : 'completed'
  if (record.status !== expectedStatus) issue(['status'], 'status does not match retained task outcomes')
  if (Date.parse(record.startedAt) > Date.parse(record.endedAt)) issue(['endedAt'], 'endedAt must not precede startedAt')
  if (record.pack.digest !== CORE_TASK_PACK_V1.digest) issue(['pack', 'digest'], 'pack digest does not match the canonical Core conformance pack')
  if (tasks.length !== CORE_TASK_PACK_V1.tasks.length) issue(['tasks'], 'task count does not match the canonical Core conformance pack')
  for (const key of ['temperature', 'seed', 'numPredict'] as const) {
    if (record.generation.parameters[key] !== FIXED_GENERATION_PARAMETERS[key]) issue(['generation', 'parameters', key], 'generation parameter does not match the fixed Core conformance policy')
  }

  const taskIds = new Set<string>()
  tasks.forEach((task, index) => {
    if (taskIds.has(task.taskId)) issue(['tasks', index, 'taskId'], 'task ids must be unique')
    taskIds.add(task.taskId)
    if (task.taskId !== CORE_TASK_PACK_V1.tasks[index]?.id) issue(['tasks', index, 'taskId'], 'task id or order does not match the canonical Core conformance pack')
    if (!task.attempted && task.score !== null) issue(['tasks', index], 'an unattempted task cannot have a score')
    if (task.status === 'passed') {
      if (!task.attempted || task.score !== 1 || task.failure !== null || task.outputDigest === null || task.outputChars === null) issue(['tasks', index], 'passed tasks must contain a scored output')
    } else if (task.status === 'failed' || task.status === 'malformed') {
      if (!task.attempted || task.score !== 0 || task.failure === null || task.outputDigest === null || task.outputChars === null) issue(['tasks', index], 'scored failures must contain a scored output')
    } else if (task.score !== null || task.outputDigest !== null || task.outputChars !== null || task.failure === null) {
      issue(['tasks', index], 'unscored tasks must retain only bounded failure metadata')
    }
  })
  if (record.resultDigest !== digestBenchEvaluationV1(record)) issue(['resultDigest'], 'result digest does not match retained task evidence')
})
const HistoryFile = z.object({ kind: z.literal(BENCH_HISTORY_KIND), version: z.literal(BENCH_HISTORY_VERSION), recordSha256: z.string().regex(/^[0-9a-f]{64}$/), record: Evaluation }).strict()

export type BenchHistoryScanV1 = { records: BenchEvaluationV1[]; invalid: Array<{ file: string; reason: string }> }
export type BenchHistoryOptions = { dataDir?: string }
type ScannedHistoryFile = { file: string; byteLength: number; record: BenchEvaluationV1 | null }
type PreparedBenchHistoryScan = BenchHistoryScanV1 & { files: ScannedHistoryFile[]; candidateScanTruncated: boolean }
type BoundedHistoryFileRead =
  | { kind: 'missing'; byteLength: 0 }
  | { kind: 'ok'; bytes: Buffer; byteLength: number }
  | { kind: 'invalid'; byteLength: number; reason: string }
function paths(dataDir: string) { const root = join(dataDir, 'bench-history', 'v1'); return { root, records: join(root, 'records') } }
export function benchHistoryDirectoryV1(dataDir = defaultMetroraDataDir()): string { return paths(dataDir).records }
function fileName(runId: string): string { return sha256Json([BENCH_HISTORY_KIND, runId]) + '.json' }
function recordDigest(record: BenchEvaluationV1): string { return sha256Json(record) }
export function parseBenchEvaluationV1(input: unknown): BenchEvaluationV1 { return Evaluation.parse(input) as BenchEvaluationV1 }
async function prepare(dataDir: string) { const p = paths(dataDir); await ensurePrivateDirectory(p.records); await cleanupStaleAtomicTemps(p.records); return p }

const HISTORY_FILE_PATTERN = /^[0-9a-f]{64}\.json$/

function boundedDiagnosticReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return (raw.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'history file is invalid')
}

function isMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function readBoundedHistoryFile(path: string): Promise<BoundedHistoryFileRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const info = await handle.stat()
    if (!info.isFile()) return { kind: 'invalid', byteLength: 0, reason: 'history path is not a regular file' }
    const size = Number(info.size)
    if (!Number.isSafeInteger(size) || size < 0) return { kind: 'invalid', byteLength: BENCH_HISTORY_MAX_FILE_BYTES + 1, reason: 'history file size was not safely bounded' }
    if (size > BENCH_HISTORY_MAX_FILE_BYTES) return { kind: 'invalid', byteLength: size, reason: 'history file exceeds the bounded byte limit' }
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const chunk = await handle.read(bytes, offset, size - offset, offset)
      if (chunk.bytesRead === 0) break
      offset += chunk.bytesRead
    }
    const finalSize = Number((await handle.stat()).size)
    if (finalSize > BENCH_HISTORY_MAX_FILE_BYTES) return { kind: 'invalid', byteLength: finalSize, reason: 'history file exceeded the bounded byte limit while being read' }
    if (offset !== size || finalSize !== size) return { kind: 'invalid', byteLength: Math.max(0, finalSize), reason: 'history file changed during the bounded read' }
    return { kind: 'ok', bytes, byteLength: size }
  } catch (error) {
    if (isMissingError(error)) return { kind: 'missing', byteLength: 0 }
    return { kind: 'invalid', byteLength: 0, reason: boundedDiagnosticReason(error) }
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

async function candidateHistoryFiles(recordsDir: string): Promise<{ files: string[]; truncated: boolean }> {
  const directory = await opendir(recordsDir)
  const files: string[] = []
  try {
    while (files.length < BENCH_HISTORY_MAX_CANDIDATE_FILES) {
      const entry = await directory.read()
      if (!entry) return { files: files.sort(), truncated: false }
      if (entry.isFile() && HISTORY_FILE_PATTERN.test(entry.name)) files.push(entry.name)
    }
    return { files: files.sort(), truncated: true }
  } finally {
    await directory.close().catch(() => undefined)
  }
}

function compareRecords(left: BenchEvaluationV1, right: BenchEvaluationV1): number {
  return Date.parse(right.endedAt) - Date.parse(left.endedAt) || left.runId.localeCompare(right.runId)
}

async function scanPrepared(recordsDir: string): Promise<PreparedBenchHistoryScan> {
  const records: BenchEvaluationV1[] = []
  const scannedFiles: ScannedHistoryFile[] = []
  const invalid: BenchHistoryScanV1['invalid'] = []
  let omittedInvalid = 0
  const addInvalid = (file: string, reason: string): void => {
    if (invalid.length < BENCH_HISTORY_MAX_INVALID_DIAGNOSTICS - 1) invalid.push({ file, reason: boundedDiagnosticReason(reason) })
    else omittedInvalid += 1
  }
  const candidates = await candidateHistoryFiles(recordsDir)
  for (const file of candidates.files) {
    const read = await readBoundedHistoryFile(join(recordsDir, file))
    if (read.kind === 'missing') continue
    const scanned: ScannedHistoryFile = { file, byteLength: read.byteLength, record: null }
    scannedFiles.push(scanned)
    if (read.kind === 'invalid') {
      addInvalid(file, read.reason)
      continue
    }
    try {
      const wrapper = HistoryFile.parse(JSON.parse(read.bytes.toString('utf8')))
      if (fileName(wrapper.record.runId) !== file) throw new Error('run id does not match history filename')
      if (wrapper.recordSha256 !== recordDigest(wrapper.record as BenchEvaluationV1)) throw new Error('history record digest mismatch')
      scanned.record = wrapper.record as BenchEvaluationV1
      records.push(scanned.record)
    } catch (error) {
      addInvalid(file, boundedDiagnosticReason(error))
    }
  }
  if (candidates.truncated) addInvalid('<candidate-scan>', 'history candidate scan stopped at the bounded file limit')
  if (omittedInvalid > 0) invalid.push({ file: '<bounded-diagnostics>', reason: String(omittedInvalid) + ' additional invalid history diagnostics were omitted' })
  records.sort(compareRecords)
  return { records, invalid, files: scannedFiles, candidateScanTruncated: candidates.truncated }
}
export async function scanBenchHistoryV1(options: BenchHistoryOptions = {}): Promise<BenchHistoryScanV1> {
  const scan = await scanPrepared((await prepare(options.dataDir ?? defaultMetroraDataDir())).records)
  return { records: scan.records, invalid: scan.invalid }
}

export async function saveBenchEvaluationV1(recordInput: BenchEvaluationV1, options: BenchHistoryOptions = {}): Promise<{ status: 'saved' | 'duplicate'; record: BenchEvaluationV1 }> {
  const record = parseBenchEvaluationV1(recordInput)
  const p = await prepare(options.dataDir ?? defaultMetroraDataDir())
  return withLocalStateLease(p.root, async () => {
    const file = fileName(record.runId)
    const path = join(p.records, file)
    const existing = await readBoundedHistoryFile(path)
    if (existing.kind === 'ok') {
      const parsed = HistoryFile.parse(JSON.parse(existing.bytes.toString('utf8')))
      if (parsed.recordSha256 === recordDigest(record)) return { status: 'duplicate', record: parsed.record as BenchEvaluationV1 }
      throw new Error('Bench history run id collision with different content')
    }
    if (existing.kind === 'invalid') throw new Error('Bench history run id collision with invalid existing content')
    await atomicWritePrivateFile(path, JSON.stringify({ kind: BENCH_HISTORY_KIND, version: BENCH_HISTORY_VERSION, recordSha256: recordDigest(record), record }))
    const scan = await scanPrepared(p.records)
    const keep = new Set<string>()
    let bytes = 0
    let validKept = 0
    const validFiles = scan.files
      .filter(item => item.record !== null)
      .sort((left, right) => compareRecords(left.record!, right.record!))
    for (const item of validFiles) {
      if (validKept >= BENCH_HISTORY_MAX_RECORDS || bytes + item.byteLength > BENCH_HISTORY_MAX_BYTES) continue
      keep.add(item.file)
      validKept += 1
      bytes += item.byteLength
    }
    let invalidKept = 0
    const invalidFiles = scan.files.filter(item => item.record === null).sort((left, right) => left.file.localeCompare(right.file))
    for (const item of invalidFiles) {
      if (invalidKept >= BENCH_HISTORY_MAX_INVALID_FILES || item.byteLength > BENCH_HISTORY_MAX_FILE_BYTES || bytes + item.byteLength > BENCH_HISTORY_MAX_BYTES) continue
      keep.add(item.file)
      invalidKept += 1
      bytes += item.byteLength
    }
    for (const item of scan.files) {
      if (!keep.has(item.file)) await removePrivateFile(join(p.records, item.file)).catch(() => undefined)
    }
    return { status: 'saved', record }
  })
}
