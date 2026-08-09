import { useCallback, useEffect, useState } from 'react'

import type {
  DesktopWorkspaceAvailability,
  DesktopWorkspaceSnapshot,
  WorkspaceBridge,
} from '../lib/workspace'

export type WorkspaceAction =
  | 'reload'
  | 'create'
  | 'produce'
  | 'recover'
  | 'pause'
  | 'resume'
  | 'batch'
  | 'export'
  | null

/**
 * Open the Workspace from the bounded bootstrap snapshot, then replace it with
 * the complete read-only evidence inspection. This hook owns only status reads;
 * production, recovery, signing and export remain explicit component actions.
 */
export function useWorkspaceStatus(bridge: Partial<WorkspaceBridge>) {
  const [availability, setAvailability] = useState<DesktopWorkspaceAvailability | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [inspectionError, setInspectionError] = useState(false)
  const [action, setAction] = useState<WorkspaceAction>('reload')

  const acceptSnapshot = useCallback((snapshot: DesktopWorkspaceSnapshot) => {
    setInspectionError(false)
    setAvailability(current => {
      if (!current || current.availability !== 'ready') return current
      return { ...current, inspection: 'complete', snapshot }
    })
  }, [])

  const loadStatus = useCallback(async (retry: boolean) => {
    setAction('reload')
    setStatusError(false)
    setInspectionError(false)
    try {
      const method = retry ? bridge.retryWorkspaceStatus : bridge.getWorkspaceStatus
      if (typeof method !== 'function') throw new Error('workspace bridge unavailable')
      setAvailability(await method.call(bridge))
    } catch {
      setStatusError(true)
    } finally {
      setAction(null)
    }
  }, [bridge])

  const loadBootstrap = useCallback(() => loadStatus(false), [loadStatus])
  const retryStatus = useCallback(() => loadStatus(true), [loadStatus])

  const reload = useCallback(async () => {
    setAction('reload')
    setStatusError(false)
    setInspectionError(false)
    try {
      if (typeof bridge.inspectWorkspaceStatus === 'function') {
        setAvailability(await bridge.inspectWorkspaceStatus())
      } else if (typeof bridge.getWorkspaceStatus === 'function') {
        setAvailability(await bridge.getWorkspaceStatus())
      } else {
        throw new Error('workspace bridge unavailable')
      }
    } catch {
      setStatusError(true)
    } finally {
      setAction(null)
    }
  }, [bridge])

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  useEffect(() => {
    if (
      availability?.availability !== 'ready'
      || availability.inspection !== 'pending'
      || inspectionError
    ) return

    let cancelled = false
    const inspect = async () => {
      try {
        if (typeof bridge.inspectWorkspaceStatus !== 'function') {
          throw new Error('workspace inspection bridge unavailable')
        }
        const inspected = await bridge.inspectWorkspaceStatus()
        if (!cancelled) setAvailability(inspected)
      } catch {
        if (!cancelled) setInspectionError(true)
      }
    }
    void inspect()
    return () => { cancelled = true }
  }, [availability, bridge, inspectionError])

  return {
    availability,
    acceptSnapshot,
    statusError,
    inspectionError,
    action,
    setAction,
    loadBootstrap,
    retryStatus,
    reload,
  }
}
