import { sha256Text, canonicalJson } from './serialization.js'
import type { BenchTaskPackV1, BenchTaskV1 } from './task-pack-v1.js'

export const BENCH_SCORING_SCHEMA_VERSION = 'metrora.bench-scoring.v1' as const

export type BenchTaskScoreStatusV1 = 'passed' | 'failed' | 'malformed'

export type BenchTaskScoreV1 = {
  schemaVersion: typeof BENCH_SCORING_SCHEMA_VERSION
  taskId: string
  status: BenchTaskScoreStatusV1
  score: 0 | 1
  outputDigest: string
  outputChars: number
  failureReason: string | null
}

function parseJson(output: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(output.trim()) }
  } catch {
    return { ok: false }
  }
}

function typeMatches(value: unknown, type: string): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  return false
}

function result(task: BenchTaskV1, output: string, status: BenchTaskScoreStatusV1, reason: string | null): BenchTaskScoreV1 {
  return {
    schemaVersion: BENCH_SCORING_SCHEMA_VERSION,
    taskId: task.id,
    status,
    score: status === 'passed' ? 1 : 0,
    outputDigest: sha256Text(output),
    outputChars: Array.from(output).length,
    failureReason: reason,
  }
}

export function scoreBenchTaskV1(task: BenchTaskV1, output: string): BenchTaskScoreV1 {
  if (typeof output !== 'string' || output.length > 32_768) {
    return result(task, typeof output === 'string' ? output : '', 'malformed', 'output is not a bounded text value')
  }

  const scoring = task.scoring
  if (scoring.kind === 'exact-text') {
    return output.trim() === scoring.expected
      ? result(task, output, 'passed', null)
      : result(task, output, 'failed', 'normalized text did not match the expected value')
  }
  if (scoring.kind === 'normalized-text') {
    return output.trim().toLowerCase() === scoring.expected.toLowerCase()
      ? result(task, output, 'passed', null)
      : result(task, output, 'failed', 'case-normalized text did not match the expected value')
  }
  if (scoring.kind === 'exact-number') {
    const value = Number(output.trim())
    if (!Number.isFinite(value)) return result(task, output, 'malformed', 'output was not a finite number')
    return value === scoring.expected
      ? result(task, output, 'passed', null)
      : result(task, output, 'failed', 'numeric value did not match the expected value')
  }

  const parsed = parseJson(output)
  if (!parsed.ok) return result(task, output, 'malformed', 'output was not valid JSON')
  if (scoring.kind === 'exact-json') {
    let actual: string
    let expected: string
    try {
      actual = canonicalJson(parsed.value)
      expected = canonicalJson(scoring.expected)
    } catch {
      return result(task, output, 'malformed', 'JSON value was not within the bounded scoring domain')
    }
    return actual === expected
      ? result(task, output, 'passed', null)
      : result(task, output, 'failed', 'JSON value did not match the expected value')
  }

  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return result(task, output, 'failed', 'JSON value was not an object')
  }
  const object = parsed.value as Record<string, unknown>
  for (const [key, type] of Object.entries(scoring.required)) {
    if (!Object.hasOwn(object, key) || !typeMatches(object[key], type)) {
      return result(task, output, 'failed', 'JSON object did not satisfy the required field shape')
    }
  }
  return result(task, output, 'passed', null)
}

export function scoreBenchTaskPackV1(pack: BenchTaskPackV1, outputs: Readonly<Record<string, string>>): BenchTaskScoreV1[] {
  return pack.tasks.map(task => scoreBenchTaskV1(task, outputs[task.id] ?? ''))
}
