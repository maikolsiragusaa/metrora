import type {
  SwarmEventV1,
  SwarmIdentityV1,
  SwarmLimitsV1,
  SwarmRunResultV1,
  SwarmRunStatusV1,
  SwarmScopeV1,
  SwarmSynthesisInputV1,
  SwarmSynthesisResultV1,
  SwarmWorkerRequestV1,
  SwarmWorkerResultV1,
  SwarmWorkerRoleV1,
  SwarmWorkerProfileV1,
} from './contract-v1'
import { workerEventStatusForResult, safeSwarmEvent } from './events-v1'
import { buildSwarmEvidenceV1, boundedSwarmText, finalizeSwarmWorkerResult, sanitizeSwarmIdentity, SWARM_EVIDENCE_MAX_TASK_BYTES } from './evidence-v1'
import type { WorkerAdapterV1, WorkerExecutionV1 } from './worker-adapter-v1'

export const SWARM_DEFAULT_WORKERS = 2
export const SWARM_MAX_WORKERS = 3
export const SWARM_DEFAULT_MAX_TOOL_CALLS = 4
export const SWARM_DEFAULT_MAX_TOOL_ROUNDS = 1
export const SWARM_DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024
export const SWARM_DEFAULT_WORKER_TIMEOUT_MS = 120_000
export const SWARM_DEFAULT_RUN_TIMEOUT_MS = 180_000
export const SWARM_DEFAULT_SYNTHESIS_TIMEOUT_MS = 60_000
export const SWARM_HARD_RUN_TIMEOUT_MS = 10 * 60 * 1000
export const SWARM_MAX_ALLOWED_TOOLS = 16

const ROLE_DEFINITIONS: ReadonlyArray<{ role: SwarmWorkerRoleV1; profile: SwarmWorkerProfileV1; label: string; instruction: string }> = [
  { role: 'investigator', profile: 'fixed-investigator-v1', label: 'Investigator', instruction: 'Inspect the user task using bounded read-only Metrora evidence and report concise verified findings.' },
  { role: 'verifier', profile: 'fixed-verifier-v1', label: 'Verifier', instruction: 'Independently check the user task with bounded read-only Metrora evidence and identify supported limits or disagreements.' },
  { role: 'evidence-reviewer', profile: 'fixed-evidence-reviewer-v1', label: 'Evidence reviewer', instruction: 'Review the bounded factual evidence relevant to the user task and report provenance or gaps.' },
]

export type BaselineWorkerRequestInputV1 = {
  runId: string
  task: string
  scope: SwarmScopeV1
  runtime: SwarmIdentityV1
  model: SwarmIdentityV1
  allowedToolNames: readonly string[]
  workerCount?: number
  limits?: Partial<SwarmLimitsV1>
  metadata?: Readonly<Record<string, string | number | boolean | null>>
  now?: () => string
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Swarm bound is outside the public baseline limit.')
  return value
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

export function createBaselineWorkerRequests(input: BaselineWorkerRequestInputV1): readonly SwarmWorkerRequestV1[] {
  const task = boundedSwarmText(input.task, SWARM_EVIDENCE_MAX_TASK_BYTES).trim()
  if (!task) throw new Error('Swarm task must not be empty.')
  const workerCount = boundedInteger(input.workerCount, SWARM_DEFAULT_WORKERS, 1, SWARM_MAX_WORKERS)
  const allowedToolNames = [...new Set(input.allowedToolNames.map(name => name.trim()).filter(Boolean))]
  if (allowedToolNames.length > SWARM_MAX_ALLOWED_TOOLS) throw new RangeError('Swarm allowed Tool count exceeds the public baseline limit.')
  const now = input.now ?? (() => new Date().toISOString())
  const startedAt = now()
  const timeoutMs = boundedInteger(input.limits?.timeoutMs, SWARM_DEFAULT_WORKER_TIMEOUT_MS, 1, SWARM_HARD_RUN_TIMEOUT_MS)
  const limits: SwarmLimitsV1 = freeze({
    maxToolCalls: boundedInteger(input.limits?.maxToolCalls, SWARM_DEFAULT_MAX_TOOL_CALLS, 0, SWARM_DEFAULT_MAX_TOOL_CALLS),
    maxToolRounds: boundedInteger(input.limits?.maxToolRounds, SWARM_DEFAULT_MAX_TOOL_ROUNDS, 0, SWARM_DEFAULT_MAX_TOOL_ROUNDS),
    maxOutputBytes: boundedInteger(input.limits?.maxOutputBytes, SWARM_DEFAULT_MAX_OUTPUT_BYTES, 256, 64 * 1024),
    timeoutMs,
  })
  const scope = freeze({ ...input.scope })
  const runtime = freeze(sanitizeSwarmIdentity(input.runtime))
  const model = freeze(sanitizeSwarmIdentity(input.model))
  const metadata = freeze({ ...(input.metadata ?? {}), baseline: 'fixed-transparent-roles-v1' })
  return ROLE_DEFINITIONS.slice(0, workerCount).map((definition, index) => {
    const workerId = input.runId + '-worker-' + String(index + 1)
    const deadlineAt = new Date(new Date(startedAt).getTime() + timeoutMs).toISOString()
    return freeze({
      contractVersion: 'metrora.swarm.v1' as const,
      schemaVersion: 1 as const,
      runId: input.runId,
      workerId,
      task: task + '\n\nRole: ' + definition.label + '. ' + definition.instruction,
      role: definition.role,
      profile: definition.profile,
      runtime,
      model,
      scope,
      allowedToolNames: Object.freeze([...allowedToolNames]),
      limits,
      deadline: { startedAt, deadlineAt },
      metadata,
    })
  })
}

export type BaselineSwarmInputV1 = Omit<BaselineWorkerRequestInputV1, 'runId' | 'now'> & {
  runId?: string
  wholeRunTimeoutMs?: number
}

export type BaselineSwarmCoordinatorOptionsV1 = {
  adapter: WorkerAdapterV1
  synthesize?: (input: SwarmSynthesisInputV1, signal: AbortSignal) => Promise<SwarmSynthesisResultV1>
  now?: () => string
  createRunId?: () => string
  cancellationGraceMs?: number
  synthesisTimeoutMs?: number
}

export type SwarmRunHandleV1 = {
  runId: string
  result: Promise<SwarmRunResultV1>
  cancel: () => void
}

export interface BaselineSwarmCoordinatorV1 {
  start(input: BaselineSwarmInputV1, observe?: (event: SwarmEventV1) => void, parentSignal?: AbortSignal): SwarmRunHandleV1
  run(input: BaselineSwarmInputV1, observe?: (event: SwarmEventV1) => void, parentSignal?: AbortSignal): Promise<SwarmRunResultV1>
}

function makeRunId(): string {
  return 'swarm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function terminalWorkerResult(
  request: SwarmWorkerRequestV1,
  status: Extract<SwarmWorkerResultV1['status'], 'cancelled' | 'timeout' | 'failed' | 'unavailable'>,
  at: string,
  error: string,
): SwarmWorkerResultV1 {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: request.runId,
    workerId: request.workerId,
    role: request.role,
    profile: request.profile,
    status,
    runtime: request.runtime,
    model: request.model,
    startedAt: request.deadline.startedAt,
    endedAt: at,
    toolActivity: [],
    evidenceRefs: [],
    evidenceSummary: '',
    answer: '',
    artifactSummary: null,
    errors: [boundedSwarmText(error, 400)],
    usage: null,
    resultDigest: '',
  }
}

function deterministicSynthesis(status: SwarmRunStatusV1, results: readonly SwarmWorkerResultV1[]): SwarmSynthesisResultV1 {
  const available = results.filter(result => result.status === 'completed' || result.status === 'partial')
  const unavailable = results.filter(result => result.status !== 'completed' && result.status !== 'partial')
  const answer = available.length
    ? available.map(result => result.answer).filter(Boolean).join('\n\n')
    : 'No worker returned usable evidence for this Swarm run.'
  const suffix = unavailable.length
    ? ' Partial evidence: ' + unavailable.map(result => result.role + ' ' + result.status).join(', ') + '.'
    : ''
  return {
    status: available.length ? 'completed' : status === 'cancelled' ? 'cancelled' : 'unavailable',
    answer: boundedSwarmText(answer + suffix),
    evidenceSummary: available.length + ' worker result(s) were available; ' + unavailable.length + ' worker result(s) were unavailable or failed.',
    errors: unavailable.flatMap(result => result.errors).slice(0, 4),
  }
}

function successful(result: SwarmWorkerResultV1): boolean {
  return result.status === 'completed' || result.status === 'partial'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const WORKER_RESULT_STATUSES: readonly SwarmWorkerResultV1['status'][] = ['completed', 'partial', 'unavailable', 'failed', 'timeout', 'cancelled']
const TOOL_ACTIVITY_STATUSES: readonly SwarmWorkerResultV1['toolActivity'][number]['status'][] = ['started', 'completed', 'unavailable', 'failed', 'cancelled']

function normalizeWorkerResult(request: SwarmWorkerRequestV1, value: unknown): SwarmWorkerResultV1 {
  if (!isRecord(value) || !WORKER_RESULT_STATUSES.includes(value.status as SwarmWorkerResultV1['status'])) throw new Error('Worker returned a malformed terminal result.')
  if (!Array.isArray(value.toolActivity) || !Array.isArray(value.evidenceRefs) || !Array.isArray(value.errors)) throw new Error('Worker returned a malformed terminal result.')
  const toolActivity = value.toolActivity.filter(item => isRecord(item) && typeof item.name === 'string' && TOOL_ACTIVITY_STATUSES.includes(item.status as typeof TOOL_ACTIVITY_STATUSES[number])).map(item => ({
    name: item.name as string,
    status: item.status as typeof TOOL_ACTIVITY_STATUSES[number],
  }))
  const evidenceRefs = value.evidenceRefs.filter(item => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string').map(item => ({ id: item.id as string, label: item.label as string }))
  const errors = value.errors.filter(error => typeof error === 'string') as string[]
  const identity = (candidate: unknown, fallback: SwarmIdentityV1): SwarmIdentityV1 => isRecord(candidate) && typeof candidate.id === 'string' && typeof candidate.label === 'string'
    ? { id: candidate.id, label: candidate.label }
    : fallback
  const usage = isRecord(value.usage)
    ? {
        inputTokens: typeof value.usage.inputTokens === 'number' ? value.usage.inputTokens : null,
        outputTokens: typeof value.usage.outputTokens === 'number' ? value.usage.outputTokens : null,
        costUsd: typeof value.usage.costUsd === 'number' ? value.usage.costUsd : null,
      }
    : null
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: request.runId,
    workerId: request.workerId,
    role: request.role,
    profile: request.profile,
    status: value.status as SwarmWorkerResultV1['status'],
    runtime: identity(value.runtime, request.runtime),
    model: identity(value.model, request.model),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : request.deadline.startedAt,
    endedAt: typeof value.endedAt === 'string' ? value.endedAt : request.deadline.startedAt,
    toolActivity,
    evidenceRefs,
    evidenceSummary: typeof value.evidenceSummary === 'string' ? value.evidenceSummary : '',
    answer: typeof value.answer === 'string' ? value.answer : '',
    artifactSummary: value.artifactSummary === null || typeof value.artifactSummary === 'string' ? value.artifactSummary : null,
    errors,
    usage,
    resultDigest: '',
  }
}

const SYNTHESIS_STATUSES: readonly SwarmSynthesisResultV1['status'][] = ['completed', 'unavailable', 'failed', 'cancelled']

function normalizeSynthesis(value: unknown): SwarmSynthesisResultV1 {
  if (!isRecord(value) || !SYNTHESIS_STATUSES.includes(value.status as SwarmSynthesisResultV1['status']) || typeof value.answer !== 'string' || typeof value.evidenceSummary !== 'string' || !Array.isArray(value.errors)) throw new Error('Synthesis returned a malformed result.')
  return {
    status: value.status as SwarmSynthesisResultV1['status'],
    answer: boundedSwarmText(value.answer),
    evidenceSummary: boundedSwarmText(value.evidenceSummary),
    errors: value.errors.filter(error => typeof error === 'string').slice(0, 4).map(error => boundedSwarmText(error, 400)),
  }
}

function appendSynthesisError(result: SwarmSynthesisResultV1, error: string): SwarmSynthesisResultV1 {
  return { ...result, errors: [...result.errors, boundedSwarmText(error, 400)].slice(0, 4) }
}

export function createBaselineSwarmCoordinator(options: BaselineSwarmCoordinatorOptionsV1): BaselineSwarmCoordinatorV1 {
  const now = options.now ?? (() => new Date().toISOString())
  const createRunId = options.createRunId ?? makeRunId
  const synthesisTimeoutMs = boundedInteger(options.synthesisTimeoutMs, SWARM_DEFAULT_SYNTHESIS_TIMEOUT_MS, 1, SWARM_HARD_RUN_TIMEOUT_MS)

  const execute = async (
    input: BaselineSwarmInputV1,
    observe: (event: SwarmEventV1) => void,
    parentSignal: AbortSignal | undefined,
    runId: string,
  ): Promise<SwarmRunResultV1> => {
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    let terminal = false
    let runClosed = false
    let termination: 'cancelled' | 'timeout' | null = null
    let resolveTermination!: (reason: 'cancelled' | 'timeout') => void
    const terminationPromise = new Promise<'cancelled' | 'timeout'>(resolve => { resolveTermination = resolve })
    let closePendingWorkers: () => void = () => {}
    const terminate = (reason: 'cancelled' | 'timeout') => {
      if (termination) return
      termination = reason
      cancelled = reason === 'cancelled'
      timedOut = reason === 'timeout'
      controller.abort()
      resolveTermination(reason)
    }
    const parentAbort = () => {
      if (runClosed) return
      terminate('cancelled')
      closePendingWorkers()
    }
    if (parentSignal?.aborted) parentAbort()
    else parentSignal?.addEventListener('abort', parentAbort, { once: true })
    const publish = (event: SwarmEventV1) => {
      if (runClosed) return
      observe(safeSwarmEvent(event))
    }
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'proposed', at: now() })
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'preparing', at: now() })
    const requests = createBaselineWorkerRequests({ ...input, runId, now })
    const runTimeoutMs = boundedInteger(input.wholeRunTimeoutMs, SWARM_DEFAULT_RUN_TIMEOUT_MS, 1, SWARM_HARD_RUN_TIMEOUT_MS)
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'started', at: now(), detail: requests.length + ' fixed workers started.' })

    type WorkerRecord = {
      request: SwarmWorkerRequestV1
      execution: WorkerExecutionV1 | null
      workerClosed: boolean
      timeoutId?: ReturnType<typeof setTimeout>
      result: SwarmWorkerResultV1 | null
      resolve: (result: SwarmWorkerResultV1) => void
    }
    const records = new Map<string, WorkerRecord>()
    const workerResults = new Map<string, SwarmWorkerResultV1>()

    const cancelExecution = (record: WorkerRecord): void => {
      try { record.execution?.cancel() } catch { /* adapter cancellation is best effort */ }
      try {
        const cancellation = options.adapter.cancel(record.request.workerId)
        void Promise.resolve(cancellation).catch(() => {})
      } catch { /* adapter cancellation is best effort */ }
    }

    const completeWorker = (record: WorkerRecord, candidate: unknown, fallbackStatus: Extract<SwarmWorkerResultV1['status'], 'failed' | 'cancelled' | 'timeout'>, fallbackMessage: string): void => {
      if (record.workerClosed) return
      record.workerClosed = true
      if (record.timeoutId !== undefined) clearTimeout(record.timeoutId)
      let safeResult: SwarmWorkerResultV1
      try {
        safeResult = normalizeWorkerResult(record.request, candidate)
      } catch (error) {
        safeResult = terminalWorkerResult(record.request, fallbackStatus === 'cancelled' || fallbackStatus === 'timeout' ? fallbackStatus : 'failed', now(), error instanceof Error ? error.message : fallbackMessage)
      }
      safeResult = {
        ...safeResult,
        answer: boundedSwarmText(safeResult.answer),
        evidenceSummary: boundedSwarmText(safeResult.evidenceSummary),
        errors: safeResult.errors.slice(0, 4).map(error => boundedSwarmText(error, 400)),
      }
      record.result = safeResult
      workerResults.set(record.request.workerId, safeResult)
      if (!terminal && !cancelled && !timedOut) {
        publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId, workerId: record.request.workerId, role: record.request.role, status: workerEventStatusForResult(safeResult.status), at: now() })
      }
      record.resolve(safeResult)
    }

    closePendingWorkers = () => {
      for (const record of records.values()) {
        if (record.workerClosed) continue
        completeWorker(record, terminalWorkerResult(record.request, cancelled ? 'cancelled' : 'timeout', now(), cancelled ? 'Worker cancelled.' : 'Worker exceeded the Swarm deadline.'), cancelled ? 'cancelled' : 'timeout', cancelled ? 'Worker cancelled.' : 'Worker exceeded the Swarm deadline.')
        cancelExecution(record)
      }
    }

    const workerPromises: Promise<SwarmWorkerResultV1>[] = []
    for (const request of requests) {
      publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId, workerId: request.workerId, role: request.role, status: 'queued', at: now() })
      let resolveWorker!: (result: SwarmWorkerResultV1) => void
      const workerPromise = new Promise<SwarmWorkerResultV1>(resolve => { resolveWorker = resolve })
      const record: WorkerRecord = { request, execution: null, workerClosed: false, result: null, resolve: resolveWorker }
      records.set(request.workerId, record)
      workerPromises.push(workerPromise)
      void Promise.resolve().then(() => {
        if (record.workerClosed) return
        if (controller.signal.aborted) {
          completeWorker(record, terminalWorkerResult(request, cancelled ? 'cancelled' : 'timeout', now(), cancelled ? 'Worker cancelled before start.' : 'Worker timed out before start.'), cancelled ? 'cancelled' : 'timeout', cancelled ? 'Worker cancelled before start.' : 'Worker timed out before start.')
          return
        }
        try {
          record.execution = options.adapter.start(request, event => {
            if (terminal || record.workerClosed || cancelled || timedOut) return
            if (event.kind === 'worker' && event.runId === runId && event.workerId === request.workerId) publish(event)
          }, { signal: controller.signal })
          record.timeoutId = setTimeout(() => {
            if (record.workerClosed) return
            completeWorker(record, terminalWorkerResult(request, 'timeout', now(), 'Worker exceeded its individual deadline.'), 'timeout', 'Worker exceeded its individual deadline.')
            cancelExecution(record)
          }, request.limits.timeoutMs)
          const resultPromise = Promise.resolve(record.execution.result)
          resultPromise.then(value => {
            try {
              completeWorker(record, value, 'failed', 'Worker returned a malformed terminal result.')
            } catch (error) {
              completeWorker(record, terminalWorkerResult(request, 'failed', now(), error instanceof Error ? error.message : 'Worker failed.'), 'failed', 'Worker failed.')
            }
          }, error => {
            completeWorker(record, terminalWorkerResult(request, controller.signal.aborted ? (cancelled ? 'cancelled' : 'timeout') : 'failed', now(), error instanceof Error ? error.message : 'Worker failed.'), controller.signal.aborted ? (cancelled ? 'cancelled' : 'timeout') : 'failed', error instanceof Error ? error.message : 'Worker failed.')
          })
        } catch (error) {
          completeWorker(record, terminalWorkerResult(request, 'failed', now(), error instanceof Error ? error.message : 'Worker failed.'), 'failed', 'Worker failed.')
        }
      })
    }

    const allWorkers = Promise.all(workerPromises)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(resolve => {
      timeoutId = setTimeout(() => {
        terminate('timeout')
        closePendingWorkers()
        resolve('timeout')
      }, runTimeoutMs)
    })
    const terminated = terminationPromise
    const outcome = await Promise.race([
      allWorkers.then(results => ({ kind: 'workers' as const, results })),
      timeout.then(() => ({ kind: 'timeout' as const })),
      terminated.then(reason => ({ kind: reason as 'cancelled' | 'timeout' })),
    ])
    const rawResults = outcome.kind === 'workers'
      ? outcome.results
      : (outcome.kind === 'cancelled' ? (terminate('cancelled'), closePendingWorkers()) : (terminate('timeout'), closePendingWorkers()), await allWorkers)

    const results = await Promise.all(rawResults.map(finalizeSwarmWorkerResult))
    const successCount = results.filter(successful).length
    const allWorkerTimeout = results.length > 0 && results.every(result => result.status === 'timeout')
    let finalStatus: SwarmRunStatusV1 = cancelled
      ? 'cancelled'
      : timedOut || allWorkerTimeout
        ? 'timeout'
        : successCount === 0
          ? 'failed'
          : successCount < results.length
            ? 'partial'
            : results.some(result => result.status === 'partial') ? 'partial' : 'completed'
    let synthesis: SwarmSynthesisResultV1 | null = null
    if (!cancelled && !timedOut && successCount > 0) {
      publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'synthesis', runId, status: 'started', at: now() })
      const synthesisInput: SwarmSynthesisInputV1 = {
        contractVersion: 'metrora.swarm.v1',
        schemaVersion: 1,
        runId,
        task: boundedSwarmText(input.task, SWARM_EVIDENCE_MAX_TASK_BYTES),
        scope: input.scope,
        workers: results.map(result => ({ ...result, answer: boundedSwarmText(result.answer), evidenceSummary: boundedSwarmText(result.evidenceSummary) })),
      }
      const fallback = (message: string): SwarmSynthesisResultV1 => appendSynthesisError(deterministicSynthesis(finalStatus, results), message)
      if (!options.synthesize) {
        synthesis = deterministicSynthesis(finalStatus, results)
      } else {
        type SynthesisOutcome = { kind: 'value'; value: unknown } | { kind: 'error'; error: unknown } | { kind: 'timeout' } | { kind: 'cancelled' }
        const synthesisPromise = Promise.resolve().then(() => options.synthesize!(synthesisInput, controller.signal))
        const settledSynthesis: Promise<SynthesisOutcome> = synthesisPromise.then(value => ({ kind: 'value' as const, value }), error => ({ kind: 'error' as const, error }))
        let synthesisTimer: ReturnType<typeof setTimeout> | undefined
        const synthesisTimeout = new Promise<SynthesisOutcome>(resolve => {
          synthesisTimer = setTimeout(() => resolve({ kind: 'timeout' }), synthesisTimeoutMs)
        })
        const synthesisOutcome = await Promise.race([settledSynthesis, synthesisTimeout, terminated.then(reason => ({ kind: reason === 'cancelled' ? 'cancelled' as const : 'timeout' as const }))])
        if (synthesisTimer !== undefined) clearTimeout(synthesisTimer)
        if (synthesisOutcome.kind === 'cancelled' || (synthesisOutcome.kind === 'timeout' && termination === 'timeout')) {
          if (synthesisOutcome.kind === 'cancelled') terminate('cancelled')
          else terminate('timeout')
          closePendingWorkers()
          finalStatus = synthesisOutcome.kind === 'cancelled' ? 'cancelled' : 'timeout'
          synthesis = {
            status: synthesisOutcome.kind === 'cancelled' ? 'cancelled' : 'unavailable',
            answer: '',
            evidenceSummary: synthesisOutcome.kind === 'cancelled' ? 'Synthesis was cancelled with the Swarm run.' : 'Synthesis was stopped with the Swarm timeout.',
            errors: [],
          }
        } else if (synthesisOutcome.kind === 'timeout') {
          synthesis = fallback('Synthesis exceeded its bounded deadline; deterministic worker closeout was used.')
        } else if (synthesisOutcome.kind === 'error') {
          synthesis = fallback('Synthesis failed; deterministic worker closeout was used.')
        } else if (synthesisOutcome.kind === 'value') {
          try {
            const normalized = normalizeSynthesis(synthesisOutcome.value)
            synthesis = normalized.status === 'completed' && normalized.answer.trim()
              ? normalized
              : fallback('Synthesis returned no usable completed answer; deterministic worker closeout was used.')
          } catch {
            synthesis = fallback('Synthesis returned a malformed result; deterministic worker closeout was used.')
          }
        } else {
          synthesis = fallback('Synthesis ended without a usable result; deterministic worker closeout was used.')
        }
        // The bounded continuation consumes a late provider promise through
        // settledSynthesis, so an abort-ignoring synthesizer cannot create an
        // unhandled rejection or overwrite the selected fallback.
      }
      if (termination) {
        finalStatus = termination === 'cancelled' ? 'cancelled' : 'timeout'
        synthesis = {
          status: termination === 'cancelled' ? 'cancelled' : 'unavailable',
          answer: '',
          evidenceSummary: termination === 'cancelled' ? 'Synthesis was cancelled with the Swarm run.' : 'Synthesis was stopped with the Swarm timeout.',
          errors: [],
        }
      }
      if (!terminal) publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'synthesis', runId, status: synthesis.status === 'completed' ? 'completed' : synthesis.status, at: now() })
    }
    if (termination) finalStatus = termination === 'cancelled' ? 'cancelled' : 'timeout'
    terminal = true
    const evidence = await buildSwarmEvidenceV1({
      request: { runId, task: input.task, scope: input.scope, allowedToolNames: input.allowedToolNames },
      workers: results,
      finalStatus,
      synthesis,
      cancellation: cancelled,
      timeout: timedOut || allWorkerTimeout,
    })
    publish({
      contractVersion: 'metrora.swarm.v1',
      schemaVersion: 1,
      kind: 'swarm',
      runId,
      status: finalStatus === 'cancelled' ? 'cancelled' : finalStatus === 'failed' || finalStatus === 'timeout' ? 'failed' : 'completed',
      at: now(),
      detail: finalStatus === 'partial' ? 'Partial completion; failed workers are retained as unavailable evidence.' : undefined,
    })
    runClosed = true
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    parentSignal?.removeEventListener('abort', parentAbort)
    return {
      contractVersion: 'metrora.swarm.v1',
      schemaVersion: 1,
      runId,
      task: boundedSwarmText(input.task, SWARM_EVIDENCE_MAX_TASK_BYTES),
      status: finalStatus,
      workers: results,
      synthesis,
      evidence,
    }
  }

  return {
    start(input, observe = () => {}, parentSignal) {
      const runId = input.runId ?? createRunId()
      const controller = new AbortController()
      let cancelled = false
      const cancel = () => { cancelled = true; controller.abort() }
      if (parentSignal?.aborted) cancel()
      else parentSignal?.addEventListener('abort', cancel, { once: true })
      const result = execute(input, observe, controller.signal, runId).finally(() => {
        parentSignal?.removeEventListener('abort', cancel)
        if (cancelled) controller.abort()
      })
      return { runId, result, cancel }
    },
    run(input, observe = () => {}, parentSignal) {
      return this.start(input, observe, parentSignal).result
    },
  }
}
