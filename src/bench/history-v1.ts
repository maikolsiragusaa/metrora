import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWritePrivateFile, cleanupStaleAtomicTemps, ensurePrivateDirectory, readOptionalPrivateFile, removePrivateFile } from '../local-state/atomic-file.js'
import { defaultMetroraDataDir } from '../local-state/endpoint-identity.js'
import { withLocalStateLease } from '../local-state/local-state-lease.js'
import { sha256Json } from './serialization.js'
import { BENCH_EVALUATION_SCHEMA_VERSION, type BenchEvaluationV1 } from './task-pack-run-v1.js'

export const BENCH_HISTORY_KIND = 'metrora.bench-history.v1' as const
export const BENCH_HISTORY_VERSION = 1 as const
export const BENCH_HISTORY_MAX_RECORDS = 50
export const BENCH_HISTORY_MAX_BYTES = 5 * 1024 * 1024

const RuntimeMetrics = z.object({ totalDurationNs: z.number().int().nonnegative().nullable(), loadDurationNs: z.number().int().nonnegative().nullable(), promptEvalCount: z.number().int().nonnegative().nullable(), promptEvalDurationNs: z.number().int().nonnegative().nullable(), evalCount: z.number().int().nonnegative().nullable(), evalDurationNs: z.number().int().nonnegative().nullable() }).strict()
const TaskResult = z.object({
  taskId: z.string().min(1).max(128), attempted: z.boolean(), status: z.enum(['passed', 'failed', 'malformed', 'unavailable', 'timeout', 'cancelled']), score: z.union([z.literal(0), z.literal(1), z.null()]), outputDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable(), outputChars: z.number().int().nonnegative().max(32_768).nullable(), requestLatencyMs: z.number().nonnegative().nullable(), timeToFirstContentMs: z.number().nonnegative().nullable(), runtimeReported: RuntimeMetrics, failure: z.object({ code: z.string().min(1).max(64), message: z.string().min(1).max(240) }).strict().nullable(),
}).strict()
const Evaluation = z.object({
  schemaVersion: z.literal(BENCH_EVALUATION_SCHEMA_VERSION), runId: z.string().min(1).max(128), runner: z.object({ id: z.literal('ollama-task-pack-v1'), version: z.literal('1.0.0') }).strict(), pack: z.object({ packId: z.literal('metrora.bench.core'), version: z.literal('1.0.0'), digest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), model: z.object({ selected: z.string().min(1).max(200), reported: z.string().min(1).max(200).nullable() }).strict(), runtime: z.object({ id: z.literal('ollama-local'), endpoint: z.literal('http://127.0.0.1:11434'), version: z.string().max(128).nullable() }).strict(), environment: z.object({ os: z.string().min(1).max(240), arch: z.string().min(1).max(64), node: z.string().min(1).max(64) }).strict(), generation: z.object({ parameters: z.object({ temperature: z.number(), seed: z.number().int(), numPredict: z.number().int() }).strict(), policy: z.literal('one-bounded-request-per-task') }).strict(), startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }), status: z.enum(['completed', 'unavailable', 'cancelled']), tasks: z.array(TaskResult).min(1).max(64), aggregate: z.object({ planned: z.number().int().nonnegative().max(64), attempted: z.number().int().nonnegative().max(64), passed: z.number().int().nonnegative().max(64), failed: z.number().int().nonnegative().max(64), unavailable: z.number().int().nonnegative().max(64), cancelled: z.number().int().nonnegative().max(64), score: z.object({ numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(), value: z.number().min(0).max(1).nullable() }).strict() }).strict(), resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
const HistoryFile = z.object({ kind: z.literal(BENCH_HISTORY_KIND), version: z.literal(BENCH_HISTORY_VERSION), recordSha256: z.string().regex(/^[0-9a-f]{64}$/), record: Evaluation }).strict()

export type BenchHistoryScanV1 = { records: BenchEvaluationV1[]; invalid: Array<{ file: string; reason: string }> }
export type BenchHistoryOptions = { dataDir?: string }
function paths(dataDir: string) { const root = join(dataDir, 'bench-history', 'v1'); return { root, records: join(root, 'records') } }
export function benchHistoryDirectoryV1(dataDir = defaultMetroraDataDir()): string { return paths(dataDir).records }
function fileName(runId: string): string { return sha256Json([BENCH_HISTORY_KIND, runId]) + '.json' }
function recordDigest(record: BenchEvaluationV1): string { return sha256Json(record) }
export function parseBenchEvaluationV1(input: unknown): BenchEvaluationV1 { return Evaluation.parse(input) as BenchEvaluationV1 }
async function prepare(dataDir: string) { const p = paths(dataDir); await ensurePrivateDirectory(p.records); await cleanupStaleAtomicTemps(p.records); return p }

async function scanPrepared(recordsDir: string): Promise<BenchHistoryScanV1> {
  const records: BenchEvaluationV1[] = []
  const invalid: BenchHistoryScanV1['invalid'] = []
  const files = (await readdir(recordsDir)).filter(file => /^[0-9a-f]{64}\.json$/.test(file)).sort()
  for (const file of files) {
    try {
      const bytes = await readOptionalPrivateFile(join(recordsDir, file))
      if (!bytes) continue
      const wrapper = HistoryFile.parse(JSON.parse(bytes.toString('utf8')))
      if (fileName(wrapper.record.runId) !== file) throw new Error('run id does not match history filename')
      if (wrapper.recordSha256 !== recordDigest(wrapper.record as BenchEvaluationV1)) throw new Error('history record digest mismatch')
      records.push(wrapper.record as BenchEvaluationV1)
    } catch (error) {
      invalid.push({ file, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  records.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || a.runId.localeCompare(b.runId))
  return { records, invalid }
}
export async function scanBenchHistoryV1(options: BenchHistoryOptions = {}): Promise<BenchHistoryScanV1> { return scanPrepared((await prepare(options.dataDir ?? defaultMetroraDataDir())).records) }

export async function saveBenchEvaluationV1(recordInput: BenchEvaluationV1, options: BenchHistoryOptions = {}): Promise<{ status: 'saved' | 'duplicate'; record: BenchEvaluationV1 }> {
  const record = parseBenchEvaluationV1(recordInput)
  const p = await prepare(options.dataDir ?? defaultMetroraDataDir())
  return withLocalStateLease(p.root, async () => {
    const file = fileName(record.runId)
    const path = join(p.records, file)
    const existingBytes = await readOptionalPrivateFile(path)
    if (existingBytes) {
      const existing = HistoryFile.parse(JSON.parse(existingBytes.toString('utf8')))
      if (existing.recordSha256 === recordDigest(record)) return { status: 'duplicate', record: existing.record as BenchEvaluationV1 }
      throw new Error('Bench history run id collision with different content')
    }
    await atomicWritePrivateFile(path, JSON.stringify({ kind: BENCH_HISTORY_KIND, version: BENCH_HISTORY_VERSION, recordSha256: recordDigest(record), record }))
    const scan = await scanPrepared(p.records)
    let bytes = 0
    for (let index = 0; index < scan.records.length; index++) {
      const item = scan.records[index]!
      const itemPath = join(p.records, fileName(item.runId))
      const itemBytes = await readOptionalPrivateFile(itemPath)
      if (!itemBytes) continue
      if (bytes + itemBytes.byteLength > BENCH_HISTORY_MAX_BYTES || index >= BENCH_HISTORY_MAX_RECORDS) await removePrivateFile(itemPath).catch(() => undefined)
      else bytes += itemBytes.byteLength
    }
    return { status: 'saved', record }
  })
}
