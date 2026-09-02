import { useCallback, useEffect, useRef, useState } from 'react'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorDataSource, AdvisorModelRuntime, AdvisorScope } from '../advisor/types'
import type { AdvisorOverviewSnapshot } from '../advisor/tools'
import {
  createBaselineSwarmCoordinator,
  type BaselineSwarmCoordinatorV1,
} from '../../../src/swarm/coordinator-v1'
import type {
  SwarmEventV1,
  SwarmRunResultV1,
  SwarmRunStatusV1,
  SwarmScopeV1,
} from '../../../src/swarm/contract-v1'
import { sanitizeSwarmIdentity, sanitizeSwarmText } from '../../../src/swarm/evidence-v1'
import {
  NATIVE_SWARM_TOOL_NAMES,
  NativeHarnessWorkerAdapter,
  createNativeHarnessSwarmSynthesizer,
} from './native-worker-adapter'

export type SwarmRunState = {
  runId: string | null
  status: SwarmRunStatusV1 | 'idle'
  events: SwarmEventV1[]
  result: SwarmRunResultV1 | null
  error: string | null
  running: boolean
}

export type UseSwarmRunOptions = {
  source: AdvisorDataSource
  runtime: AdvisorModelRuntime
  scope: AdvisorScope
  overview: AdvisorOverviewSnapshot | MenubarPayload | null
  modelId: string
  modelLabel: string
  enabled: boolean
}

export type SwarmRunController = {
  state: SwarmRunState
  run: (task: string, workerCount?: number) => void
  cancel: () => void
}

const INITIAL_STATE: SwarmRunState = {
  runId: null,
  status: 'idle',
  events: [],
  result: null,
  error: null,
  running: false,
}

function runStatusFromEvent(event: SwarmEventV1): SwarmRunStatusV1 | 'idle' {
  if (event.kind !== 'swarm') return 'idle'
  if (event.status === 'cancelled') return 'cancelled'
  if (event.status === 'failed') return 'failed'
  if (event.status === 'completed') return 'completed'
  return 'idle'
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function snapshotOverview(overview: AdvisorOverviewSnapshot | MenubarPayload | null): AdvisorOverviewSnapshot | MenubarPayload | null {
  if (!overview) return null
  // Overview is a JSON-safe polling payload. Clone it before handing it to a
  // run so a later poll, or an accidental consumer mutation, cannot alter the
  // factual snapshot used by an in-flight worker.
  return deepFreeze(structuredClone(overview))
}

function snapshotScope(scope: AdvisorScope): AdvisorScope {
  return deepFreeze({
    ...scope,
    range: scope.range ? { ...scope.range } : null,
  })
}

function snapshotSource(source: AdvisorDataSource): AdvisorDataSource {
  return Object.freeze({
    getOverview: source.getOverview.bind(source),
    getModels: source.getModels.bind(source),
    getQuota: source.getQuota.bind(source),
    ...(source.getBenchEvidence ? { getBenchEvidence: source.getBenchEvidence.bind(source) } : {}),
  })
}

function snapshotRuntime(runtime: AdvisorModelRuntime): AdvisorModelRuntime {
  const generateSwarmSynthesis = runtime.generateSwarmSynthesis
  return Object.freeze({
    id: runtime.id,
    label: runtime.label,
    mode: runtime.mode,
    providerSupport: Object.freeze([...runtime.providerSupport]),
    availability: runtime.availability,
    supportsStreaming: runtime.supportsStreaming,
    reasoningEfforts: runtime.reasoningEfforts ? Object.freeze([...runtime.reasoningEfforts]) : undefined,
    generate: runtime.generate.bind(runtime),
    ...(generateSwarmSynthesis ? { generateSwarmSynthesis: generateSwarmSynthesis.bind(runtime) } : {}),
  })
}

export function useSwarmRun(options: UseSwarmRunOptions): SwarmRunController {
  const { source, runtime, scope, overview, modelId, modelLabel, enabled } = options
  const [state, setState] = useState<SwarmRunState>(INITIAL_STATE)
  const handleRef = useRef<{ runId: string; cancel: () => void } | null>(null)
  const generationRef = useRef(0)

  const cancel = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    // Invalidate event/result callbacks before asking the adapter to stop. A
    // provider may ignore AbortSignal, but it must not keep the composer busy
    // or overwrite the next run in this conversation.
    generationRef.current += 1
    handleRef.current = null
    handle.cancel()
    setState(current => current.running
      ? { ...current, status: 'cancelled', running: false }
      : current)
  }, [])

  const run = useCallback((rawTask: string, workerCount = 2) => {
    if (!enabled) return
    const task = sanitizeSwarmText(rawTask, 8 * 1024).trim()
    if (!task) {
      setState(current => ({ ...current, error: 'Enter a task for the experimental Swarm.', status: 'idle', running: false }))
      return
    }
    handleRef.current?.cancel()
    const generation = ++generationRef.current
    setState({ runId: null, status: 'idle', events: [], result: null, error: null, running: true })
    // The adapter and coordinator are execution owners, not render-time
    // derived values. Every run receives its own immutable factual/runtime
    // snapshot and keeps that owner until its terminal result arrives.
    let handle: ReturnType<BaselineSwarmCoordinatorV1['start']>
    try {
      const runSource = snapshotSource(source)
      const runRuntime = snapshotRuntime(runtime)
      const runScope = snapshotScope(scope)
      const runOverview = snapshotOverview(overview)
      const adapter = new NativeHarnessWorkerAdapter({ source: runSource, runtime: runRuntime, overview: runOverview })
      const coordinator: BaselineSwarmCoordinatorV1 = createBaselineSwarmCoordinator({
        adapter,
        synthesize: createNativeHarnessSwarmSynthesizer(runRuntime),
      })
      handle = coordinator.start({
        task,
        scope: runScope as unknown as SwarmScopeV1,
        runtime: sanitizeSwarmIdentity({ id: runRuntime.id, label: runRuntime.label }),
        model: sanitizeSwarmIdentity({ id: modelId, label: modelLabel }),
        allowedToolNames: NATIVE_SWARM_TOOL_NAMES,
        workerCount,
      }, event => {
        if (generationRef.current !== generation) return
        setState(current => ({
          ...current,
          runId: event.runId,
          status: runStatusFromEvent(event) === 'idle' ? current.status : runStatusFromEvent(event),
          events: [...current.events, event].slice(-240),
        }))
      })
    } catch (error) {
      if (generationRef.current === generation) {
        setState(current => ({
          ...current,
          status: 'failed',
          running: false,
          error: error instanceof Error ? error.message : 'Swarm could not start this task.',
        }))
      }
      return
    }
    handleRef.current = handle
    setState(current => ({ ...current, runId: handle.runId }))
    void handle.result.then(result => {
      if (generationRef.current !== generation) return
      handleRef.current = null
      setState(current => ({ ...current, runId: result.runId, status: result.status, result, running: false }))
    }).catch(error => {
      if (generationRef.current !== generation) return
      handleRef.current = null
      setState(current => ({ ...current, status: 'failed', running: false, error: error instanceof Error ? error.message : 'Swarm could not complete this task.' }))
    })
  }, [enabled, modelId, modelLabel, overview, runtime, scope, source])

  useEffect(() => () => {
    generationRef.current += 1
    const handle = handleRef.current
    handleRef.current = null
    handle?.cancel()
  }, [])

  useEffect(() => {
    cancel()
  }, [
    cancel,
    modelId,
    modelLabel,
    runtime.availability,
    runtime.id,
    runtime.label,
    runtime.mode,
    scope.model,
    scope.period,
    scope.provider,
    scope.projectId,
    scope.projectName,
    scope.range?.from,
    scope.range?.to,
  ])

  return { state, run, cancel }
}
