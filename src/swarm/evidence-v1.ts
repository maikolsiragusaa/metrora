import type {
  SwarmEvidenceV1,
  SwarmIdentityV1,
  SwarmJsonValue,
  SwarmRunStatusV1,
  SwarmSynthesisResultV1,
  SwarmUsageV1,
  SwarmWorkerRequestV1,
  SwarmWorkerResultV1,
} from './contract-v1'

export const SWARM_EVIDENCE_SCHEMA = 'metrora.swarm-evidence.v1' as const
export const SWARM_EVIDENCE_MAX_TASK_BYTES = 8 * 1024
export const SWARM_EVIDENCE_MAX_RESULT_BYTES = 8 * 1024
export const SWARM_EVIDENCE_MAX_REFS = 16

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function sanitizeSwarmText(value: unknown, maxBytes = SWARM_EVIDENCE_MAX_RESULT_BYTES): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|workspace|Volumes)\/)[^\s"']+/giu, '[path]')
    .replace(/(?:api[_-]?key|token|password|secret|credential)\s*[:=]\s*\S+/giu, '[redacted]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/giu, '[redacted]')
  if (byteLength(normalized) <= maxBytes) return normalized
  return new TextDecoder().decode(new TextEncoder().encode(normalized).slice(0, maxBytes)) + '...'
}

export function boundedSwarmText(value: unknown, maxBytes = SWARM_EVIDENCE_MAX_RESULT_BYTES): string {
  return sanitizeSwarmText(value, maxBytes)
}

export function sanitizeSwarmIdentity(value: SwarmIdentityV1): SwarmIdentityV1 {
  return {
    id: sanitizeSwarmText(value.id, 160).replace(/\[path\]/gu, 'local-runtime'),
    label: sanitizeSwarmText(value.label, 160).replace(/\[path\]/gu, 'local runtime'),
  }
}

function boundedUsage(usage: SwarmUsageV1 | null): SwarmUsageV1 | null {
  if (!usage) return null
  const count = (value: number | null): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1_000_000_000) : null
  const cost = (value: number | null): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 1_000_000_000) : null
  return {
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    costUsd: cost(usage.costUsd),
  }
}

function canonicalize(value: SwarmJsonValue | undefined): SwarmJsonValue | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map(item => canonicalize(item) as SwarmJsonValue)
  if (value !== null && typeof value === 'object') {
    const output: Record<string, SwarmJsonValue> = {}
    for (const key of Object.keys(value).sort()) {
      const next = canonicalize(value[key])
      if (next !== undefined) output[key] = next
    }
    return output
  }
  return value
}

export function canonicalSwarmJson(value: unknown): string {
  return JSON.stringify(canonicalize(value as SwarmJsonValue)) ?? 'null'
}

export async function createSwarmDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSwarmJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function digestWorkerResult(result: SwarmWorkerResultV1): Promise<string> {
  return createSwarmDigest({
    workerId: result.workerId,
    role: result.role,
    status: result.status,
    runtime: sanitizeSwarmIdentity(result.runtime),
    model: sanitizeSwarmIdentity(result.model),
    toolActivity: result.toolActivity.map(item => ({ name: item.name, status: item.status })),
    evidenceRefs: result.evidenceRefs.slice(0, SWARM_EVIDENCE_MAX_REFS),
    evidenceSummary: boundedSwarmText(result.evidenceSummary),
    answer: boundedSwarmText(result.answer),
    artifactSummary: boundedSwarmText(result.artifactSummary),
    errors: result.errors.slice(0, 4).map(error => boundedSwarmText(error, 400)),
    usage: boundedUsage(result.usage),
  })
}

export async function buildSwarmEvidenceV1(input: {
  request: Pick<SwarmWorkerRequestV1, 'runId' | 'task' | 'scope' | 'allowedToolNames'>
  workers: readonly SwarmWorkerResultV1[]
  finalStatus: SwarmRunStatusV1
  synthesis: SwarmSynthesisResultV1 | null
  cancellation: boolean
  timeout: boolean
}): Promise<SwarmEvidenceV1> {
  const synthesis = input.synthesis
  const taskDigest = await createSwarmDigest(boundedSwarmText(input.request.task, SWARM_EVIDENCE_MAX_TASK_BYTES))
  const scopeDigest = await createSwarmDigest(input.request.scope)
  const workers = await Promise.all(input.workers.map(async worker => ({
    workerId: worker.workerId,
    role: worker.role,
    runtime: sanitizeSwarmIdentity(worker.runtime),
    model: sanitizeSwarmIdentity(worker.model),
    status: worker.status,
    allowedToolNames: input.request.allowedToolNames.slice(0, 16),
    toolNamesUsed: [...new Set(worker.toolActivity.map(item => item.name))].slice(0, 16),
    startedAt: worker.startedAt,
    endedAt: worker.endedAt,
    resultDigest: /^[0-9a-f]{64}$/u.test(worker.resultDigest) ? worker.resultDigest : await digestWorkerResult(worker),
    answerDigest: await createSwarmDigest(boundedSwarmText(worker.answer)),
    usage: boundedUsage(worker.usage),
  })))
  const synthesisStatus = synthesis?.status ?? 'not-requested'
  const answerDigest = synthesis ? await createSwarmDigest(boundedSwarmText(synthesis.answer)) : null
  const evidenceDigest = synthesis ? await createSwarmDigest(boundedSwarmText(synthesis.evidenceSummary)) : null
  const synthesisRecord: SwarmEvidenceV1['synthesis'] = { status: synthesisStatus, answerDigest, evidenceDigest }
  const unsigned = {
    schema: SWARM_EVIDENCE_SCHEMA,
    schemaVersion: 1 as const,
    runId: input.request.runId,
    taskDigest,
    scopeDigest,
    workerCount: workers.length,
    workers,
    finalStatus: input.finalStatus,
    cancellation: input.cancellation,
    timeout: input.timeout,
    synthesis: synthesisRecord,
    methodology: {
      coordinator: 'metrora-harness-public-baseline-v1' as const,
      assignments: 'fixed-transparent-roles-v1' as const,
      runtimeSelection: 'manual-current-runtime-v1' as const,
    },
  }
  return { ...unsigned, evidenceDigest: await createSwarmDigest(unsigned) }
}
