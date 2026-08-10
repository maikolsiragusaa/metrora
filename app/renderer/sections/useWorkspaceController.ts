import { useCallback, useState } from 'react'

import { metrora } from '../lib/ipc'
import { showToast } from '../lib/toast'
import type {
  DesktopReviewedProductionSummary,
  DesktopWorkspaceRecoverySummary,
  WorkspaceBridge,
  WorkspaceProductionMode,
} from '../lib/workspace'
import {
  workspaceActionErrorMessage,
  workspaceBatchToast,
  workspaceProductionToast,
  workspaceRecoveryToast,
} from './workspaceActionCopy'
import { useWorkspaceStatus } from './useWorkspaceStatus'

export function useWorkspaceController(
  bridge: Partial<WorkspaceBridge> = metrora as Partial<WorkspaceBridge>,
) {
  const {
    availability,
    acceptSnapshot,
    statusError,
    inspectionError,
    action,
    setAction,
    loadBootstrap,
    retryStatus,
    reload,
  } = useWorkspaceStatus(bridge)
  const [workspaceName, setWorkspaceName] = useState('My workspace')
  const [endpointName, setEndpointName] = useState('This computer')
  const [lastProduction, setLastProduction] = useState<DesktopReviewedProductionSummary | null>(null)
  const [lastRecovery, setLastRecovery] = useState<DesktopWorkspaceRecoverySummary | null>(null)
  const busy = action !== null

  const createWorkspace = useCallback(async () => {
    if (busy) return
    const displayName = workspaceName.trim()
    const endpointDisplayName = endpointName.trim()
    if (!displayName || !endpointDisplayName) {
      showToast('Workspace and endpoint names are required.', 'error')
      return
    }

    setAction('create')
    try {
      if (typeof bridge.createWorkspace !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.createWorkspace({ displayName, endpointDisplayName })
      acceptSnapshot(result.snapshot)
      setLastProduction(null)
      setLastRecovery(null)
      showToast(result.outcome === 'created' ? 'Local workspace created.' : 'Existing local workspace loaded.')
    } catch {
      showToast(workspaceActionErrorMessage('create'), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, endpointName, setAction, workspaceName])

  const produceMeasurements = useCallback(async () => {
    if (busy) return
    setAction('produce')
    try {
      if (typeof bridge.produceWorkspaceMeasurements !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.produceWorkspaceMeasurements()
      acceptSnapshot(result.snapshot)
      setLastProduction(result.summary)
      setLastRecovery(null)
      showToast(workspaceProductionToast(result.summary))
    } catch {
      showToast(workspaceActionErrorMessage('produce'), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, setAction])

  const recoverLocalState = useCallback(async () => {
    if (busy) return
    setAction('recover')
    try {
      if (typeof bridge.recoverWorkspaceState !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.recoverWorkspaceState()
      acceptSnapshot(result.snapshot)
      setLastRecovery(result.summary)
      if (result.summary.production) setLastProduction(result.summary.production)
      const toast = workspaceRecoveryToast(result.summary)
      showToast(toast.message, toast.error ? 'error' : undefined)
    } catch {
      showToast(workspaceActionErrorMessage('recover'), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, setAction])

  const setProductionMode = useCallback(async (mode: WorkspaceProductionMode) => {
    if (busy) return
    const nextAction = mode === 'paused' ? 'pause' : 'resume'
    setAction(nextAction)
    try {
      const method = mode === 'paused' ? bridge.pauseWorkspaceProduction : bridge.resumeWorkspaceProduction
      if (typeof method !== 'function') throw new Error('workspace bridge unavailable')
      const result = await method.call(bridge)
      acceptSnapshot(result.snapshot)
      setLastRecovery(null)
      showToast(mode === 'paused' ? 'Reviewed production paused.' : 'Reviewed production resumed.')
    } catch {
      showToast(workspaceActionErrorMessage(nextAction), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, setAction])

  const createBatch = useCallback(async () => {
    if (busy) return
    setAction('batch')
    try {
      if (typeof bridge.createWorkspaceBatch !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.createWorkspaceBatch()
      acceptSnapshot(result.snapshot)
      showToast(workspaceBatchToast(result))
    } catch {
      showToast(workspaceActionErrorMessage('batch'), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, setAction])

  const exportEvidence = useCallback(async () => {
    if (busy) return
    setAction('export')
    try {
      if (typeof bridge.exportWorkspaceEvidence !== 'function') throw new Error('workspace bridge unavailable')
      const result = await bridge.exportWorkspaceEvidence()
      if (result.outcome === 'cancelled') return
      acceptSnapshot(result.snapshot)
      showToast(`Exported ${result.fileName}.`)
    } catch {
      showToast(workspaceActionErrorMessage('export'), 'error')
    } finally {
      setAction(null)
    }
  }, [acceptSnapshot, bridge, busy, setAction])

  return {
    availability,
    statusError,
    inspectionError,
    action,
    busy,
    workspaceName,
    endpointName,
    lastProduction,
    lastRecovery,
    setWorkspaceName,
    setEndpointName,
    loadBootstrap,
    retryStatus,
    reload,
    createWorkspace,
    produceMeasurements,
    recoverLocalState,
    setProductionMode,
    createBatch,
    exportEvidence,
  }
}
