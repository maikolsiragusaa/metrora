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
import { sanitizeAdvisorDisplayText } from '../advisor/privacy'
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
  clear: () => void
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
    // Cancellation is a foreground lifecycle transition. Do not wait for a
    // provider promise to observe AbortSignal before freeing the composer;
    // the coordinator still owns the background cleanup and late results are
    // ignored by this generation.
    generationRef.current += 1
    handleRef.current = null
    handle.cancel()
    setState(current => current.running
      ? { ...current, status: 'cancelled', running: false }
      : current)
  }, [])

  const clear = useCallback(() => {
    generationRef.current += 1
    handleRef.current?.cancel()
    handleRef.current = null
    setState(INITIAL_STATE)
  }, [])

  const run = useCallback((rawTask: string, workerCount = 2) => {
    if (!enabled) return
    if (handleRef.current) return
    const task = sanitizeSwarmText(rawTask, 8 * 1024).trim()
    if (!task) {
      setState(current => ({ ...current, error: 'Enter a task for the manual Swarm.', status: 'idle', running: false }))
      return
    }
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
      const diagnostic = error instanceof Error ? sanitizeAdvisorDisplayText(error.message, 240) : ''
      setState(current => ({ ...current, status: 'failed', running: false, error: diagnostic === '[redacted]' ? 'Swarm could not complete this task.' : diagnostic || 'Swarm could not complete this task.' }))
    })
  }, [coordinator, enabled, modelId, modelLabel, runtime.id, runtime.label, scope])

  useEffect(() => () => {
    generationRef.current += 1
    const handle = handleRef.current
    handleRef.current = null
    handle?.cancel()
    // The coordinator instance changes when its runtime/overview inputs
    // change. A stale handle must not leave the old run marked as current.
    setState(current => current.running
      ? { ...current, status: 'cancelled', running: false }
      : current)
  }, [coordinator])

  useEffect(() => {
    clear()
  }, [clear, enabled, modelId, modelLabel, runtime.id, runtime.label, scope.period, scope.range?.from, scope.range?.to, scope.provider, scope.projectId, scope.projectName, scope.model])

  return { state, run, cancel, clear }
}
