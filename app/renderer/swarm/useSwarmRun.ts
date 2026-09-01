import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MenubarPayload } from '../lib/types'
import type { AdvisorDataSource, AdvisorModelRuntime, AdvisorScope } from '../advisor/types'
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
  overview: MenubarPayload | null
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

export function useSwarmRun(options: UseSwarmRunOptions): SwarmRunController {
  const { source, runtime, scope, overview, modelId, modelLabel, enabled } = options
  const [state, setState] = useState<SwarmRunState>(INITIAL_STATE)
  const handleRef = useRef<{ runId: string; cancel: () => void } | null>(null)
  const generationRef = useRef(0)
  const adapter = useMemo(
    () => new NativeHarnessWorkerAdapter({ source, runtime, overview }),
    [overview, runtime, source],
  )
  const coordinator: BaselineSwarmCoordinatorV1 = useMemo(
    () => createBaselineSwarmCoordinator({
      adapter,
      synthesize: createNativeHarnessSwarmSynthesizer(runtime),
    }),
    [adapter, runtime],
  )

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
    const handle = coordinator.start({
      task,
      scope: scope as unknown as SwarmScopeV1,
      runtime: sanitizeSwarmIdentity({ id: runtime.id, label: runtime.label }),
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
  }, [coordinator, enabled, modelId, modelLabel, runtime.id, runtime.label, scope])

  useEffect(() => () => {
    generationRef.current += 1
    handleRef.current?.cancel()
  }, [coordinator])

  useEffect(() => {
    cancel()
  }, [cancel, runtime.id, modelId, scope.period, scope.provider, scope.projectId, scope.model])

  return { state, run, cancel }
}
