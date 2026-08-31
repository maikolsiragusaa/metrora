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
  const timeoutMs = boundedInteger(input.limits?.timeoutMs, SWARM_DEFAULT_WORKER_TIMEOUT_MS, 1_000, SWARM_HARD_RUN_TIMEOUT_MS)
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

export function createBaselineSwarmCoordinator(options: BaselineSwarmCoordinatorOptionsV1): BaselineSwarmCoordinatorV1 {
  const now = options.now ?? (() => new Date().toISOString())
  const createRunId = options.createRunId ?? makeRunId
  const graceMs = Math.max(0, Math.min(options.cancellationGraceMs ?? 250, 2_000))

  const execute = async (
    input: BaselineSwarmInputV1,
    observe: (event: SwarmEventV1) => void,
    parentSignal: AbortSignal | undefined,
    runId: string,
  ): Promise<SwarmRunResultV1> => {
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    let suppressWorkerResults = false
    let runClosed = false
    const parentAbort = () => {
      if (runClosed) return
      cancelled = true
      controller.abort()
    }
    if (parentSignal?.aborted) parentAbort()
    else parentSignal?.addEventListener('abort', parentAbort, { once: true })
    const publish = (event: SwarmEventV1) => observe(safeSwarmEvent(event))
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'proposed', at: now() })
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'preparing', at: now() })
    let terminal = false
    const requests = createBaselineWorkerRequests({ ...input, runId, now })
    const runTimeoutMs = boundedInteger(input.wholeRunTimeoutMs, SWARM_DEFAULT_RUN_TIMEOUT_MS, 1_000, SWARM_HARD_RUN_TIMEOUT_MS)
    publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'swarm', runId, status: 'started', at: now(), detail: requests.length + ' fixed workers started.' })
    const executions = new Map<string, { request: SwarmWorkerRequestV1; execution: WorkerExecutionV1 | null }>()
    const workerResults = new Map<string, SwarmWorkerResultV1>()
    const workerPromises: Promise<SwarmWorkerResultV1>[] = []
    for (const request of requests) {
      publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId, workerId: request.workerId, role: request.role, status: 'queued', at: now() })
      const record = { request, execution: null as WorkerExecutionV1 | null }
      executions.set(request.workerId, record)
      const promise = Promise.resolve().then(() => {
        if (controller.signal.aborted) return terminalWorkerResult(request, cancelled ? 'cancelled' : 'timeout', now(), cancelled ? 'Worker cancelled before start.' : 'Worker timed out before start.')
        record.execution = options.adapter.start(request, event => {
          if (terminal || cancelled || timedOut) return
          if (event.kind === 'worker' && event.runId === runId && event.workerId === request.workerId) publish(event)
        }, { signal: controller.signal })
        let workerTimeoutId: ReturnType<typeof setTimeout> | undefined
        const workerTimeout = new Promise<SwarmWorkerResultV1>(resolve => {
          workerTimeoutId = setTimeout(() => {
            record.execution?.cancel()
            void options.adapter.cancel(request.workerId).catch(() => {})
            resolve(terminalWorkerResult(request, 'timeout', now(), 'Worker exceeded its individual deadline.'))
          }, request.limits.timeoutMs)
        })
        return Promise.race([record.execution.result, workerTimeout]).finally(() => {
          if (workerTimeoutId !== undefined) clearTimeout(workerTimeoutId)
        })
      }).then(result => {
        const safeResult = {
          ...result,
          answer: boundedSwarmText(result.answer),
          evidenceSummary: boundedSwarmText(result.evidenceSummary),
          errors: result.errors.slice(0, 4).map(error => boundedSwarmText(error, 400)),
        }
        if (!suppressWorkerResults) workerResults.set(request.workerId, safeResult)
        if (!terminal && !cancelled && !timedOut && !suppressWorkerResults) {
          publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId, workerId: request.workerId, role: request.role, status: workerEventStatusForResult(safeResult.status), at: now() })
        }
        return safeResult
      }).catch(error => {
        const failed = terminalWorkerResult(request, controller.signal.aborted ? (cancelled ? 'cancelled' : 'timeout') : 'failed', now(), error instanceof Error ? error.message : 'Worker failed.')
        if (!suppressWorkerResults) workerResults.set(request.workerId, failed)
        if (!terminal && !cancelled && !timedOut && !suppressWorkerResults) {
          publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId, workerId: request.workerId, role: request.role, status: workerEventStatusForResult(failed.status), at: now() })
        }
        return failed
      })
      workerPromises.push(promise)
    }
    const allWorkers = Promise.all(workerPromises)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(resolve => {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
        resolve('timeout')
      }, runTimeoutMs)
    })
    const abort = new Promise<'cancelled'>(resolve => {
      if (controller.signal.aborted && cancelled) resolve('cancelled')
      else controller.signal.addEventListener('abort', () => { if (cancelled) resolve('cancelled') }, { once: true })
    })
    let outcome: readonly SwarmWorkerResultV1[] | 'timeout' | 'cancelled'
    try {
      outcome = await Promise.race([allWorkers, timeout, abort])
      if (outcome === 'timeout' || outcome === 'cancelled') {
        suppressWorkerResults = true
        for (const item of executions.values()) {
          item.execution?.cancel()
          void options.adapter.cancel(item.request.workerId).catch(() => {})
        }
        if (graceMs > 0) await Promise.race([allWorkers, new Promise(resolve => setTimeout(resolve, graceMs))])
        for (const request of requests) {
          if (!workerResults.has(request.workerId)) {
            workerResults.set(request.workerId, terminalWorkerResult(request, outcome === 'cancelled' ? 'cancelled' : 'timeout', now(), outcome === 'cancelled' ? 'Worker cancelled.' : 'Worker exceeded the Swarm deadline.'))
          }
        }
        outcome = requests.map(request => workerResults.get(request.workerId)!)
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
    const rawResults = Array.isArray(outcome)
      ? outcome
      : requests.map(request => workerResults.get(request.workerId) ?? terminalWorkerResult(request, cancelled ? 'cancelled' : 'timeout', now(), 'Worker did not return before the Swarm deadline.'))
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
      try {
        synthesis = options.synthesize ? await options.synthesize(synthesisInput, controller.signal) : deterministicSynthesis(finalStatus, results)
      } catch (error) {
        synthesis = cancelled || timedOut
          ? { status: cancelled ? 'cancelled' : 'unavailable', answer: '', evidenceSummary: 'Synthesis was stopped with the Swarm run.', errors: [] }
          : deterministicSynthesis(finalStatus, results)
        if (!cancelled && !timedOut) synthesis = { ...synthesis, errors: [...synthesis.errors, boundedSwarmText(error instanceof Error ? error.message : 'Synthesis failed.', 400)].slice(0, 4) }
      }
      if (cancelled || timedOut) {
        finalStatus = cancelled ? 'cancelled' : 'timeout'
        synthesis = {
          status: cancelled ? 'cancelled' : 'unavailable',
          answer: '',
          evidenceSummary: cancelled ? 'Synthesis was cancelled with the Swarm run.' : 'Synthesis was stopped with the Swarm timeout.',
          errors: [],
        }
      }
      if (!terminal && !cancelled && !timedOut) publish({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'synthesis', runId, status: synthesis.status === 'completed' ? 'completed' : synthesis.status, at: now() })
    }
    terminal = true
    runClosed = true
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
