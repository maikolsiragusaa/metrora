import { sha256Json } from './serialization.js'

export const BENCH_TASK_PACK_SCHEMA_VERSION = 'metrora.bench-task-pack.v1' as const
export const CORE_TASK_PACK_ID = 'metrora.bench.core' as const
export const CORE_TASK_PACK_VERSION = '1.0.0' as const

export type BenchJsonValue = null | boolean | number | string | BenchJsonValue[] | { [key: string]: BenchJsonValue }
export type BenchShapeFieldType = 'string' | 'number' | 'boolean' | 'array'

export type BenchTaskScoringV1 =
  | { kind: 'exact-text'; expected: string }
  | { kind: 'normalized-text'; expected: string }
  | { kind: 'exact-number'; expected: number }
  | { kind: 'exact-json'; expected: BenchJsonValue }
  | { kind: 'json-shape'; required: Record<string, BenchShapeFieldType> }

export type BenchTaskV1 = {
  id: string
  prompt: string
  scoring: BenchTaskScoringV1
}

export type BenchTaskPackV1 = {
  schemaVersion: typeof BENCH_TASK_PACK_SCHEMA_VERSION
  packId: typeof CORE_TASK_PACK_ID
  version: typeof CORE_TASK_PACK_VERSION
  label: string
  policy: 'deterministic-local-only'
  tasks: readonly BenchTaskV1[]
  digest: string
}

const CORE_TASKS: readonly BenchTaskV1[] = [
  {
    id: 'exact-word',
    prompt: 'Return exactly the single lowercase word blue. Do not add punctuation or explanation.',
    scoring: { kind: 'exact-text', expected: 'blue' },
  },
  {
    id: 'arithmetic',
    prompt: 'Compute 17 + 25. Return only the integer answer.',
    scoring: { kind: 'exact-number', expected: 42 },
  },
  {
    id: 'exact-json',
    prompt: 'Return exactly this JSON object and no markdown: {"kind":"fixture","count":3}',
    scoring: { kind: 'exact-json', expected: { kind: 'fixture', count: 3 } },
  },
  {
    id: 'exact-array',
    prompt: 'Return exactly this JSON array and no markdown: ["alpha","beta","gamma"]',
    scoring: { kind: 'exact-json', expected: ['alpha', 'beta', 'gamma'] },
  },
  {
    id: 'schema-object',
    prompt: 'Return a JSON object with answer as the number 42 and unit as the string items. Extra keys are unnecessary.',
    scoring: { kind: 'json-shape', required: { answer: 'number', unit: 'string' } },
  },
  {
    id: 'normalized-confirmation',
    prompt: 'Confirm the bounded fixture with the word READY. You may use any letter case, but no other words.',
    scoring: { kind: 'normalized-text', expected: 'ready' },
  },
]

const CORE_TASK_PACK_CONTENT = {
  schemaVersion: BENCH_TASK_PACK_SCHEMA_VERSION,
  packId: CORE_TASK_PACK_ID,
  version: CORE_TASK_PACK_VERSION,
  label: 'Core deterministic local task pack',
  policy: 'deterministic-local-only' as const,
  tasks: CORE_TASKS,
}

export const CORE_TASK_PACK_V1: BenchTaskPackV1 = {
  ...CORE_TASK_PACK_CONTENT,
  digest: sha256Json(CORE_TASK_PACK_CONTENT),
}

export function getBenchTaskPackV1(packId = 'core-v1'): BenchTaskPackV1 {
  if (packId !== 'core-v1' && packId !== CORE_TASK_PACK_ID) {
    throw new Error('unknown Bench task pack; supported pack is core-v1')
  }
  return CORE_TASK_PACK_V1
}
