import { buildConversationEvidence } from '../advisor/special-evidence'
import { createAdvisorModelGuardV1, resolveAdvisorQuestion } from '../advisor/comprehension'
import { ADVISOR_TOOL_CONTRACT } from '../advisor/contract'
import { createAdvisorToolRegistry } from '../advisor/tools'
import { sanitizeAdvisorDisplayText, sanitizeAdvisorModelOutput } from '../advisor/privacy'
import { sanitizeSwarmSynthesisAnswer } from './synthesis-safety'
import type {
  AdvisorAnswer,
  AdvisorDataSource,
  AdvisorEvidenceRef,
  AdvisorModelRuntime,
  AdvisorScope,
  AdvisorToolContract,
  AdvisorToolDefinition,
  AdvisorToolEvent,
  AdvisorToolExecution,
} from '../advisor/types'
import type { MenubarPayload } from '../lib/types'
import {
  boundedSwarmText,
  finalizeSwarmWorkerResult,
  sanitizeSwarmIdentity,
  sanitizeSwarmText,
} from '../../../src/swarm/evidence-v1'
import type {
  SwarmEventV1,
  SwarmSynthesisInputV1,
  SwarmSynthesisResultV1,
  SwarmToolActivityV1,
  SwarmWorkerRequestV1,
  SwarmWorkerResultV1,
} from '../../../src/swarm/contract-v1'
import type {
  WorkerAdapterObserveV1,
  WorkerAdapterStartOptionsV1,
  WorkerAdapterV1,
  WorkerExecutionV1,
} from '../../../src/swarm/worker-adapter-v1'

export const NATIVE_SWARM_TOOL_NAMES = [
  'get_spend_snapshot',
  'get_model_efficiency',
  'get_quota_snapshot',
  'get_overview_snapshot',
  'get_project_drivers',
  'get_session_highlights',
  'get_coverage_report',
  'get_bench_evidence',
] as const

export class SwarmBoundsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwarmBoundsError'
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Swarm worker cancelled', 'AbortError')
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && /abort|cancel/i.test(error.message))
}

function safeToolName(value: string): string {
  return sanitizeAdvisorDisplayText(sanitizeSwarmText(value, 96), 96)
}

function safeRefs(refs: readonly AdvisorEvidenceRef[]): Array<{ id: string; label: string }> {
  return refs.slice(0, 16).map(ref => ({
    id: sanitizeAdvisorDisplayText(sanitizeSwarmText(ref.id, 120), 120),
    label: sanitizeAdvisorDisplayText(sanitizeSwarmText(ref.label, 240), 240),
  }))
}

function safeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/abort|cancel/i.test(message)) return 'Worker cancelled.'
  if (/timeout|deadline/i.test(message)) return 'Worker timed out.'
  if (/unavailable|not available|runtime/i.test(message)) return 'Worker runtime unavailable.'
  if (/tool|contract|allowlist|bound|scope/i.test(message)) return 'Worker request was rejected by the bounded Tool contract.'
  return 'Worker failed; diagnostic details were withheld.'
}

function filteredToolContract(
  contract: AdvisorToolContract,
  definitions: readonly AdvisorToolDefinition[],
): AdvisorToolContract {
  const allowedFilters = Object.fromEntries(
    definitions.map(definition => [
      definition.function.name,
      contract.scope.allowedFilters[definition.function.name as keyof AdvisorToolContract['scope']['allowedFilters']] ?? [],
    ]),
  ) as AdvisorToolContract['scope']['allowedFilters']
  return {
    ...contract,
    tools: definitions,
    scope: { ...contract.scope, allowedFilters },
  }
}

function toolActivityFromEvents(events: readonly AdvisorToolEvent[]): SwarmToolActivityV1[] {
  const latest = new Map<string, SwarmToolActivityV1>()
  for (const event of events) {
    const status = event.status === 'queued' || event.status === 'started'
      ? 'started'
      : event.status === 'completed'
        ? 'completed'
        : event.status === 'unavailable'
          ? 'unavailable'
          : event.status === 'cancelled'
            ? 'cancelled'
            : 'failed'
    latest.set(safeToolName(event.name), { name: safeToolName(event.name), status })
  }
  return [...latest.values()].slice(0, 16)
}

function safeAnswer(answer: AdvisorAnswer, maxBytes = 8 * 1024): { answer: string; evidenceSummary: string; refs: Array<{ id: string; label: string }> } {
  const refs = safeRefs(answer.evidence)
  const evidenceSummary = boundedSwarmText(sanitizeAdvisorDisplayText([
    answer.coverage.label,
    answer.coverage.detail,
    refs.map(ref => ref.label).join('; '),
  ].filter(Boolean).join(' - ')))
  const safeConclusion = sanitizeAdvisorModelOutput(sanitizeSwarmText(answer.conclusion), maxBytes)
  return {
    answer: safeConclusion,
    evidenceSummary,
    refs,
  }
}

function baseResult(request: SwarmWorkerRequestV1, status: SwarmWorkerResultV1['status'], startedAt: string, endedAt: string, activity: readonly SwarmToolActivityV1[], answer = '', evidenceSummary = '', errors: readonly string[] = []): SwarmWorkerResultV1 {
  return {
    contractVersion: 'metrora.swarm.v1',
    schemaVersion: 1,
    runId: request.runId,
    workerId: request.workerId,
    role: request.role,
    profile: request.profile,
    status,
    runtime: sanitizeSwarmIdentity(request.runtime),
    model: sanitizeSwarmIdentity(request.model),
    startedAt,
    endedAt,
    toolActivity: activity.slice(0, 16),
    evidenceRefs: [],
    evidenceSummary: boundedSwarmText(evidenceSummary),
    answer: boundedSwarmText(answer),
    artifactSummary: null,
    errors: errors.slice(0, 4).map(safeWorkerError),
    usage: null,
    resultDigest: '',
  }
}

export type NativeHarnessWorkerAdapterOptions = {
  source: AdvisorDataSource
  runtime: AdvisorModelRuntime
  overview?: MenubarPayload | null
  now?: () => string
}

/**
 * The first real public worker path. It delegates generation to the selected
 * existing Harness runtime and factual reads to the canonical Tool registry.
 */
export class NativeHarnessWorkerAdapter implements WorkerAdapterV1 {
  readonly adapterId = 'metrora-harness-native-worker-v1'
  private readonly source: AdvisorDataSource
  private readonly runtime: AdvisorModelRuntime
  private readonly overview: MenubarPayload | null
  private readonly now: () => string
  private readonly active = new Map<string, AbortController>()

  constructor(options: NativeHarnessWorkerAdapterOptions) {
    this.source = options.source
    this.runtime = options.runtime
    this.overview = options.overview ?? null
    this.now = options.now ?? (() => new Date().toISOString())
  }

  start(request: SwarmWorkerRequestV1, observe: WorkerAdapterObserveV1, options: WorkerAdapterStartOptionsV1 = {}): WorkerExecutionV1 {
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    let closed = false
    let terminalSettled = false
    let settleTerminal: ((status: SwarmWorkerResultV1['status'], error: string) => void) | null = null
    const startedAt = this.now()
    const terminal = new Promise<SwarmWorkerResultV1>(resolve => {
      settleTerminal = (status, error) => {
        if (terminalSettled) return
        terminalSettled = true
        resolve(baseResult(request, status, startedAt, this.now(), [], '', '', [error]))
      }
    })
    const parentAbort = () => {
      cancelled = true
      controller.abort()
      settleTerminal?.('cancelled', 'Worker cancelled by its parent run.')
    }
    if (options.signal?.aborted) parentAbort()
    else options.signal?.addEventListener('abort', parentAbort, { once: true })
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
      settleTerminal?.('timeout', 'Worker exceeded its bounded deadline.')
    }, request.limits.timeoutMs)
    this.active.set(request.workerId, controller)
    const emit = (event: SwarmEventV1) => {
      if (closed) return
      observe(event)
    }
    emit({
      contractVersion: 'metrora.swarm.v1',
      schemaVersion: 1,
      kind: 'worker',
      runId: request.runId,
      workerId: request.workerId,
      role: request.role,
      status: 'started',
      at: startedAt,
      detail: sanitizeSwarmText(this.runtime.label, 160),
    })
    const operation = this.execute(request, emit, controller.signal, startedAt, () => cancelled, () => timedOut)
    const result = Promise.race([operation, terminal])
      .finally(() => {
        closed = true
        clearTimeout(timeoutId)
        options.signal?.removeEventListener('abort', parentAbort)
        if (this.active.get(request.workerId) === controller) this.active.delete(request.workerId)
      })
    return {
      workerId: request.workerId,
      result,
      cancel: () => {
        cancelled = true
        controller.abort()
        settleTerminal?.('cancelled', 'Worker cancelled.')
      },
    }
  }

  async run(request: SwarmWorkerRequestV1, observe: WorkerAdapterObserveV1 = () => {}, options?: WorkerAdapterStartOptionsV1): Promise<SwarmWorkerResultV1> {
    return this.start(request, observe, options).result
  }

  async cancel(workerId: string): Promise<void> {
    this.active.get(workerId)?.abort()
  }

  private async execute(
    request: SwarmWorkerRequestV1,
    observe: WorkerAdapterObserveV1,
    signal: AbortSignal,
    startedAt: string,
    wasCancelled: () => boolean,
    timedOut: () => boolean,
  ): Promise<SwarmWorkerResultV1> {
    const activityEvents: AdvisorToolEvent[] = []
    const activity = () => toolActivityFromEvents(activityEvents)
    const finish = async (result: SwarmWorkerResultV1): Promise<SwarmWorkerResultV1> => {
      return finalizeSwarmWorkerResult(result)
    }
    try {
      throwIfAborted(signal)
      const ready = this.runtime.mode !== 'unsupported'
        && this.runtime.mode !== 'deterministic-local'
        && this.runtime.availability !== 'unavailable'
      if (!ready) {
        const result = baseResult(request, 'unavailable', startedAt, this.now(), [], 'The selected Harness runtime is unavailable.', '', ['No usable runtime was available for this worker.'])
        observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'unavailable', at: result.endedAt, detail: 'Runtime unavailable.' })
        return finish(result)
      }
      const scope = request.scope as unknown as AdvisorScope
      const plan = resolveAdvisorQuestion(request.task, scope)
      const evidence = {
        ...buildConversationEvidence(request.task, scope),
        understanding: plan.understanding,
        plan: plan.plan,
      }
      const registry = createAdvisorToolRegistry(this.source, scope, this.overview)
      const allowed = new Set(request.allowedToolNames)
      const definitions = registry.definitions.filter(definition => allowed.has(definition.function.name)).slice(0, 16)
      const contract = filteredToolContract(registry.contract, definitions)
      let toolCalls = 0
      const onToolRound = (round: number) => {
        if (!Number.isInteger(round) || round < 1 || round > request.limits.maxToolRounds) throw new SwarmBoundsError('Worker Tool-round limit reached.')
      }
      const onToolEvent = (event: AdvisorToolEvent) => {
        activityEvents.push(event)
        if (event.status === 'started' || event.status === 'queued') {
          observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'tool-started', at: this.now(), toolName: safeToolName(event.name) })
        } else {
          observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'tool-completed', at: this.now(), toolName: safeToolName(event.name), detail: event.status })
        }
      }
      const executeTool = async (name: string, args: Record<string, unknown>, toolSignal?: AbortSignal): Promise<AdvisorToolExecution> => {
        throwIfAborted(signal)
        if (!allowed.has(name) || !definitions.some(definition => definition.function.name === name)) throw new SwarmBoundsError('Worker requested a Tool outside its immutable allowlist.')
        if (toolCalls >= request.limits.maxToolCalls) throw new SwarmBoundsError('Worker Tool-call limit reached.')
        toolCalls += 1
        return registry.execute(name, args, toolSignal ?? signal)
      }
      const answer = await this.runtime.generate({
        question: request.task,
        evidence,
        plan: plan.plan,
        guard: createAdvisorModelGuardV1(plan),
        fallbackIntent: plan.intent,
        tools: definitions,
        toolContract: contract,
        executeTool,
        onToolRound,
        onToolEvent,
      }, signal)
      throwIfAborted(signal)
      const safe = safeAnswer(answer, request.limits.maxOutputBytes)
      const refs = safe.refs.slice(0, 16)
      const result = baseResult(request, safe.answer ? 'completed' : 'partial', startedAt, this.now(), activity(), safe.answer, safe.evidenceSummary, [])
      return finish({ ...result, evidenceRefs: refs })
    } catch (error) {
      const status: SwarmWorkerResultV1['status'] = timedOut()
        ? 'timeout'
        : wasCancelled() || isCancellation(error, signal)
          ? 'cancelled'
          : error instanceof Error && /unavailable|not available|runtime/i.test(error.message)
            ? 'unavailable'
            : 'failed'
      const result = baseResult(request, status, startedAt, this.now(), activity(), '', '', [error instanceof Error ? error.message : 'Worker failed.'])
      observe({
        contractVersion: 'metrora.swarm.v1',
        schemaVersion: 1,
        kind: 'worker',
        runId: request.runId,
        workerId: request.workerId,
        role: request.role,
        status: status === 'timeout' || status === 'failed' ? 'failed' : status,
        at: result.endedAt,
        detail: status === 'cancelled' ? 'Worker cancelled.' : status === 'timeout' ? 'Worker timed out.' : status === 'unavailable' ? 'Worker unavailable.' : 'Worker failed.',
      })
      return finish(result)
    }
  }
}

export function createNativeHarnessSwarmSynthesizer(runtime: AdvisorModelRuntime, now: () => string = () => new Date().toISOString()): (input: SwarmSynthesisInputV1, signal: AbortSignal) => Promise<SwarmSynthesisResultV1> {
  return async (input, signal) => {
    if (runtime.mode === 'unsupported' || runtime.mode === 'deterministic-local' || runtime.availability === 'unavailable') {
      return { status: 'unavailable', answer: '', evidenceSummary: 'The selected Harness runtime is unavailable for synthesis.', errors: ['No usable synthesis runtime was available.'] }
    }
    throwIfAborted(signal)
    const reports = input.workers.map(worker => ({
      role: worker.role,
      status: worker.status,
      answer: sanitizeAdvisorModelOutput(boundedSwarmText(sanitizeSwarmText(worker.answer), 4 * 1024), 4 * 1024),
      evidenceSummary: sanitizeAdvisorDisplayText(boundedSwarmText(sanitizeSwarmText(worker.evidenceSummary), 1 * 1024), 1 * 1024),
    }))
    if (!runtime.generateSwarmSynthesis) {
      const available = reports.filter(report => report.status === 'completed' || report.status === 'partial')
      return {
        status: available.length ? 'completed' : 'unavailable',
        answer: boundedSwarmText(available.map(report => report.answer).filter(Boolean).join('\n\n')),
        evidenceSummary: 'Hosted Swarm keeps worker reports local and used the deterministic bounded report path.',
        errors: [],
      }
    }
    const result = await runtime.generateSwarmSynthesis({ question: input.task, scope: input.scope as unknown as AdvisorScope, workers: reports }, signal)
    throwIfAborted(signal)
    const answer = sanitizeSwarmSynthesisAnswer(
      boundedSwarmText(sanitizeSwarmText(result.answer)),
      reports,
      8 * 1024,
    )
    const evidenceSummary = sanitizeAdvisorDisplayText(boundedSwarmText(sanitizeSwarmText(result.evidenceSummary)), 1 * 1024)
    return {
      status: answer.trim() ? 'completed' : 'unavailable',
      answer,
      evidenceSummary: evidenceSummary || 'Synthesis used bounded worker results and statuses only.',
      errors: answer.trim() ? [] : ['Synthesis was not promoted because it added unsupported or unsafe content.'],
    }
  }
}

export function nativeWorkerToolContract(): AdvisorToolContract {
  return {
    ...ADVISOR_TOOL_CONTRACT,
    tools: ADVISOR_TOOL_CONTRACT.tools.filter(definition => (NATIVE_SWARM_TOOL_NAMES as readonly string[]).includes(definition.function.name)),
  }
}

export async function nativeWorkerResultDigest(result: SwarmWorkerResultV1): Promise<string> {
  return (await finalizeSwarmWorkerResult(result)).resultDigest
}
