import { buildClarificationEvidence, buildConversationEvidence } from '../advisor/special-evidence'
import { createAdvisorModelGuardV1, resolveAdvisorQuestion } from '../advisor/comprehension'
import { explicitAdvisorPeriodHints } from '../advisor/planner'
import { ADVISOR_TOOL_CONTRACT, ADVISOR_TOOL_OUTPUT_MAX_BYTES } from '../advisor/contract'
import { createAdvisorToolRegistry, type AdvisorOverviewSnapshot } from '../advisor/tools'
import { DeterministicAdvisorRuntime } from '../advisor/runtime'
import { mergeEvidence } from '../advisor/merge-evidence'
import { requiredAdvisorToolRequests } from '../advisor/required-reads'
import type {
  AdvisorDataSource,
  AdvisorEvidence,
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
  SwarmEvidenceResultStatusV1,
  SwarmEvidenceResultV1,
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
import {
  isCancellation,
  prefixWorkerAnswer,
  safeAnswer,
  safeRefs,
  safeToolName,
  throwIfAborted,
  toolActivityFromEvents,
  workerContext,
} from './native-worker-support'

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

function originalWorkerTask(task: string): string {
  const marker = task.search(/\n\nRole:\s+(?:Investigator|Verifier|Evidence reviewer)\./u)
  return (marker >= 0 ? task.slice(0, marker) : task).trim()
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

function evidenceStatus(requiredToolNames: readonly string[], successfulToolNames: ReadonlySet<string>, unavailableToolNames: ReadonlySet<string>): SwarmEvidenceResultStatusV1 {
  if (!requiredToolNames.length) return 'usable'
  const required = new Set(requiredToolNames)
  const successful = [...required].filter(name => successfulToolNames.has(name)).length
  if (!successful) return 'unavailable'
  return successful < required.size || [...required].some(name => unavailableToolNames.has(name)) ? 'partial' : 'usable'
}

function evidenceResult(requiredToolNames: readonly string[], successfulToolNames: ReadonlySet<string>, unavailableToolNames: ReadonlySet<string>, usedToolNames: readonly string[]): SwarmEvidenceResultV1 {
  return {
    status: evidenceStatus(requiredToolNames, successfulToolNames, unavailableToolNames),
    requiredToolNames: [...new Set(requiredToolNames)].slice(0, 16),
    usedToolNames: [...new Set(usedToolNames)].slice(0, 16),
  }
}

function baseResult(request: SwarmWorkerRequestV1, status: SwarmWorkerResultV1['status'], startedAt: string, endedAt: string, activity: readonly SwarmToolActivityV1[], answer = '', evidenceSummary = '', errors: readonly string[] = [], evidenceResultValue: SwarmEvidenceResultV1 = { status: 'unavailable', requiredToolNames: [], usedToolNames: [] }): SwarmWorkerResultV1 {
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
    evidenceResult: evidenceResultValue,
    answer: boundedSwarmText(answer),
    artifactSummary: null,
    errors: errors.slice(0, 4).map(error => boundedSwarmText(error, 400)),
    usage: null,
    resultDigest: '',
  }
}

export type NativeHarnessWorkerAdapterOptions = {
  source: AdvisorDataSource
  runtime: AdvisorModelRuntime
  overview?: AdvisorOverviewSnapshot | MenubarPayload | null
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
  private readonly overview: AdvisorOverviewSnapshot | MenubarPayload | null
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
    const startedAt = this.now()
    const parentAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', parentAbort, { once: true })
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, request.limits.timeoutMs)
    this.active.set(request.workerId, controller)
    observe({
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
    const result = this.execute(request, observe, controller.signal, startedAt, () => cancelled, () => timedOut)
      .finally(() => {
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
        const result = baseResult(request, 'unavailable', startedAt, this.now(), [], 'The selected Harness runtime is unavailable.', '', ['No usable runtime was available for this worker.'], { status: 'unavailable', requiredToolNames: [], usedToolNames: [] })
        observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'unavailable', at: result.endedAt, detail: 'Runtime unavailable.' })
        return finish(result)
      }
      const scope = request.scope as unknown as AdvisorScope
      // The coordinator appends a trusted role sentence to the public worker
      // request. Keep that responsibility metadata out of semantic question
      // classification so words such as "limits" in a verifier instruction
      // cannot turn a factual task into a clarification.
      const question = originalWorkerTask(request.task)
      const plan = resolveAdvisorQuestion(question, scope)
      if (plan.plan.scopeConflict) {
        const clarificationEvidence = {
          ...buildClarificationEvidence(question, scope, plan.plan.scopeConflict.message),
          understanding: plan.understanding,
          plan: plan.plan,
        }
        const clarification = await new DeterministicAdvisorRuntime().generate({
          question,
          evidence: clarificationEvidence,
          plan: plan.plan,
          fallbackIntent: 'clarification',
          guard: createAdvisorModelGuardV1(plan),
        }, signal)
        const safe = safeAnswer(clarification, request.limits.maxOutputBytes)
        const result = baseResult(
          request,
          'completed',
          startedAt,
          this.now(),
          [],
          prefixWorkerAnswer(request.role, safe.answer || plan.plan.scopeConflict.message),
          'Scope clarification required; no canonical read was executed.',
          [],
          { status: 'unavailable', requiredToolNames: [], usedToolNames: [] },
        )
        return finish(result)
      }
      const allowedPeriods = scope.range
        ? [scope.period]
        : Array.from(new Set([scope.period, ...explicitAdvisorPeriodHints(question)]))
      const registry = createAdvisorToolRegistry(this.source, scope, this.overview, { allowedPeriods })
      const allowed = new Set(request.allowedToolNames)
      const definitions = registry.definitions.filter(definition => allowed.has(definition.function.name)).slice(0, 16)
      const contract = filteredToolContract(registry.contract, definitions)
      let toolCalls = 0
      const successfulToolNames = new Set<string>()
      const unavailableToolNames = new Set<string>()
      const onToolEvent = (event: AdvisorToolEvent) => {
        activityEvents.push(event)
        if (event.status === 'started' || event.status === 'queued') {
          observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'tool-started', at: this.now(), toolName: safeToolName(event.name) })
        } else {
          observe({ contractVersion: 'metrora.swarm.v1', schemaVersion: 1, kind: 'worker', runId: request.runId, workerId: request.workerId, role: request.role, status: 'tool-completed', at: this.now(), toolName: safeToolName(event.name), detail: event.status })
        }
      }
      const requiredToolRequests = requiredAdvisorToolRequests(plan, definitions, question)
      const requiredToolNames = requiredToolRequests.map(request => request.tool)
      const evidence = { ...buildConversationEvidence(question, scope), understanding: plan.understanding, plan: plan.plan }
      const evidenceItems: AdvisorEvidence[] = []
      const executeTool = async (name: string, args: Record<string, unknown>, toolSignal?: AbortSignal): Promise<AdvisorToolExecution> => {
        throwIfAborted(signal)
        if (!allowed.has(name) || !definitions.some(definition => definition.function.name === name)) throw new SwarmBoundsError('Worker requested a Tool outside its immutable allowlist.')
        if (toolCalls >= request.limits.maxToolCalls) throw new SwarmBoundsError('Worker Tool-call limit reached.')
        toolCalls += 1
        const execution = await registry.execute(name, args, toolSignal ?? signal)
        const unavailable = execution.envelope?.unavailable === true || execution.evidence.coverage.level === 'unavailable'
        const evidence = unavailable ? { ...execution.evidence, refs: [] } : execution.evidence
        evidenceItems.push(evidence)
        if (unavailable) unavailableToolNames.add(name)
        else successfulToolNames.add(name)
        return unavailable ? { ...execution, evidence } : execution
      }
      const answer = await this.runtime.generate({
        question,
        evidence,
        requiredToolRequests,
        plan: plan.plan,
        guard: createAdvisorModelGuardV1(plan),
        fallbackIntent: plan.intent,
        tools: definitions,
        toolContract: contract,
        executeTool,
        onToolEvent,
        agentLoopBounds: {
          maxSteps: request.limits.maxToolRounds + 1,
          maxCallsPerStep: request.limits.maxToolCalls,
          maxCallsPerTurn: request.limits.maxToolCalls,
          maxToolRounds: request.limits.maxToolRounds,
          maxParallelToolCalls: 1,
          turnTimeoutMs: request.limits.timeoutMs,
          // A worker's published answer limit is separate from the canonical
          // Tool-result limit. The loop must be able to replay one bounded
          // Tool result without treating it as an oversized final answer.
          maxContentBytes: Math.max(request.limits.maxOutputBytes, ADVISOR_TOOL_OUTPUT_MAX_BYTES),
          maxLedgerMessages: 32,
        },
        workerContext: workerContext(request),
      }, signal)
      throwIfAborted(signal)
      const mergedEvidence = evidenceItems.length ? mergeEvidence(evidenceItems, evidenceItems[0]!) : evidence
      const safe = safeAnswer(answer, request.limits.maxOutputBytes)
      const canonicalRefs = safeRefs(mergedEvidence.refs)
      const usedToolNames = [...new Set([
        ...successfulToolNames,
        ...activity().filter(item => item.status === 'completed').map(item => item.name),
      ])]
      const resultEvidence = evidenceResult(requiredToolNames, successfulToolNames, unavailableToolNames, usedToolNames)
      const publishable = !requiredToolNames.length || resultEvidence.status !== 'unavailable'
      const closeout = publishable && safe.answer
        ? { answer: prefixWorkerAnswer(request.role, safe.answer), evidenceSummary: safe.evidenceSummary, refs: canonicalRefs }
        : {
            answer: prefixWorkerAnswer(request.role, requiredToolNames.length ? 'The required canonical Metrora evidence was unavailable for this bounded task.' : 'This worker had no supported canonical Metrora evidence responsibility for the task.'),
            evidenceSummary: requiredToolNames.length ? 'Canonical evidence unavailable.' : 'No supported canonical Metrora evidence read was assigned.',
            refs: canonicalRefs,
          }
      const activityResult = activity()
      const summary = boundedSwarmText(requiredToolNames.length
        ? [
            resultEvidence.status === 'usable' ? 'Usable canonical evidence' : resultEvidence.status === 'partial' ? 'Partial canonical evidence' : 'Canonical evidence unavailable',
            mergedEvidence.coverage.label,
            mergedEvidence.coverage.detail,
            canonicalRefs.map(ref => ref.label).join('; '),
          ].filter(Boolean).join(' - ')
        : 'No canonical Metrora read was required for this bounded worker task.')
      const result = baseResult(request, closeout.answer ? 'completed' : 'partial', startedAt, this.now(), activityResult, closeout.answer, summary, [], resultEvidence)
      return finish({ ...result, evidenceRefs: canonicalRefs })
    } catch (error) {
      const status: SwarmWorkerResultV1['status'] = timedOut()
        ? 'timeout'
        : wasCancelled() || isCancellation(error, signal)
          ? 'cancelled'
          : error instanceof Error && /unavailable|not available|runtime/i.test(error.message)
            ? 'unavailable'
            : 'failed'
      const result = baseResult(request, status, startedAt, this.now(), activity(), '', '', [error instanceof Error ? error.message : 'Worker failed.'], { status: 'unavailable', requiredToolNames: [], usedToolNames: activity().filter(item => item.status === 'completed').map(item => item.name) })
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

export { createNativeHarnessSwarmSynthesizer } from './native-worker-synthesis'

export function nativeWorkerToolContract(): AdvisorToolContract {
  return {
    ...ADVISOR_TOOL_CONTRACT,
    tools: ADVISOR_TOOL_CONTRACT.tools.filter(definition => (NATIVE_SWARM_TOOL_NAMES as readonly string[]).includes(definition.function.name)),
  }
}

export async function nativeWorkerResultDigest(result: SwarmWorkerResultV1): Promise<string> {
  return (await finalizeSwarmWorkerResult(result)).resultDigest
}
