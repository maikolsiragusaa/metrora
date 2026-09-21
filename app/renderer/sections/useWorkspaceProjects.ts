import { useCallback, useEffect, useMemo, useState } from 'react'

import { metrora } from '../lib/ipc'
import type { ProjectBridge, ProjectScopePayload } from '../lib/project-bridge-types'

export type WorkspaceProjectsState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: ProjectScopePayload | null
  projects: ProjectScopePayload['options']
  error: string | null
  reload: () => Promise<void>
}

/** Read-only Project catalog access for the Workspace Overview summary. */
export function useWorkspaceProjects(enabled: boolean): WorkspaceProjectsState {
  const bridge = metrora as Partial<ProjectBridge>
  const [status, setStatus] = useState<WorkspaceProjectsState['status']>('idle')
  const [data, setData] = useState<ProjectScopePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      if (typeof bridge.getProjects !== 'function') throw new Error('Project catalog bridge unavailable.')
      const next = await bridge.getProjects()
      setData(next)
      setStatus('ready')
    } catch (reason) {
      setStatus('error')
      setError(reason instanceof Error ? reason.message : 'Project catalog could not be loaded.')
    }
  }, [bridge])

  useEffect(() => {
    if (!enabled || status !== 'idle') return
    void reload()
  }, [enabled, reload, status])

  const projects = useMemo(
    () => data?.options.filter(option => option.id.startsWith('mp_')) ?? [],
    [data],
  )

  return { status, data, projects, error, reload }
}

