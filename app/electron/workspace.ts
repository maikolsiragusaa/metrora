import path from 'node:path'

import type { Envelope } from './main'
import type {
  DesktopWorkspaceRuntimeState,
  DesktopWorkspaceSnapshot,
} from './local-state'

export type DesktopWorkspaceAvailability =
  | {
      availability: 'ready'
      inspection: 'pending' | 'complete'
      vault: {
        backend: 'windows-dpapi' | 'macos-keychain'
        masterKeyState: 'created' | 'loaded' | 'rewrapped'
      }
      snapshot: DesktopWorkspaceSnapshot
    }
  | { availability: 'unsupported-platform'; platform: NodeJS.Platform }
  | { availability: 'unavailable'; reason: 'vault-unavailable' | 'initialization-failed' }

export type WorkspaceBridgeDeps = {
  getRuntimeState(): Promise<DesktopWorkspaceRuntimeState>
  chooseExportPath(suggestedName: string): Promise<string | null>
  now?: () => Date
}

type WorkspaceHandler = (...args: unknown[]) => Promise<Envelope>

type WorkspaceRecoveryRuntime = {
  recoverLocalState(): Promise<unknown>
}

type WorkspaceBootstrapRuntime = {
  getBootstrapSnapshot(): Promise<DesktopWorkspaceSnapshot>
}

function workspaceError(kind: string, message: string): Envelope<never> {
  return { ok: false, error: { kind, message } }
}

function invalidWorkspaceInput(message: string): Error {
  const error = new Error(message)
  error.name = 'ZodError'
  return error
}

function unavailableError(state: Exclude<DesktopWorkspaceRuntimeState, { status: 'ready' }>): Envelope<never> {
  if (state.status === 'unsupported-platform') {
    return workspaceError('workspace-unsupported', 'Workspace signing requires Windows or macOS OS-backed encryption.')
  }
  return workspaceError(
    'workspace-unavailable',
    state.reason === 'vault-unavailable'
      ? 'The operating-system vault is unavailable. Workspace actions remain disabled.'
      : 'The local Workspace runtime could not be initialized.',
  )
}

function sanitizeActionError(error: unknown): { kind: string; message: string } {
  const name = error instanceof Error ? error.name : ''
  if (name === 'ZodError') return { kind: 'bad-args', message: 'Workspace input is invalid.' }
  if (name === 'LocalWorkspaceRecoveryRequiredError') {
    return { kind: 'workspace-recovery-required', message: 'Local Workspace state requires recovery.' }
  }
  if (name === 'LocalWorkspaceProductionLifecycleRecoveryRequiredError') {
    return { kind: 'workspace-lifecycle-recovery-required', message: 'Local Workspace production state requires recovery.' }
  }
  if (name === 'LocalWorkspaceProductionLifecycleWorkspaceRequiredError') {
    return { kind: 'workspace-required', message: 'Create the local Workspace before changing production state.' }
  }
  if (name === 'CanonicalReviewedProductionScannerIntegrityError') {
    return { kind: 'workspace-production-scan-failed', message: 'Canonical local usage could not be validated for reviewed production.' }
  }
  if (name === 'DesktopReviewedProductionUnavailableError') {
    return { kind: 'workspace-production-unavailable', message: 'Reviewed production is unavailable in this desktop runtime.' }
  }
  if (name === 'LocalWorkspaceEvidenceBlockedError') {
    return { kind: 'workspace-blocked', message: 'Workspace evidence is blocked or requires review.' }
  }
  return { kind: 'workspace-action-failed', message: 'The local Workspace action failed.' }
}

function parseCreateInput(input: unknown): {
  displayName: string
  slug?: string
  endpointDisplayName: string
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidWorkspaceInput('Workspace create input must be an object')
  }
  const row = input as Record<string, unknown>
  const displayName = typeof row.displayName === 'string' ? row.displayName.trim() : ''
  const endpointDisplayName = typeof row.endpointDisplayName === 'string' ? row.endpointDisplayName.trim() : ''
  if (!displayName || displayName.length > 120 || !endpointDisplayName || endpointDisplayName.length > 120) {
    throw invalidWorkspaceInput('Workspace display names are invalid')
  }
  if (row.slug === undefined) return { displayName, endpointDisplayName }
  const slug = typeof row.slug === 'string' ? row.slug.trim() : ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 64) {
    throw invalidWorkspaceInput('Workspace slug is invalid')
  }
  return { displayName, endpointDisplayName, slug }
}

function suggestedExportName(now: Date): string {
  return `Metrora-Workspace-Evidence-${now.toISOString().slice(0, 10)}.json`
}

async function readyState(deps: WorkspaceBridgeDeps): Promise<
  | Extract<DesktopWorkspaceRuntimeState, { status: 'ready' }>
  | Envelope<never>
> {
  const state = await deps.getRuntimeState()
  return state.status === 'ready' ? state : unavailableError(state)
}

function readyAvailability(
  state: Extract<DesktopWorkspaceRuntimeState, { status: 'ready' }>,
  snapshot: DesktopWorkspaceSnapshot,
  inspection: 'pending' | 'complete',
): DesktopWorkspaceAvailability {
  return {
    availability: 'ready',
    inspection,
    vault: { backend: state.backend, masterKeyState: state.masterKeyState },
    snapshot,
  }
}

export function createWorkspaceBridgeHandlers(deps: WorkspaceBridgeDeps): Record<string, WorkspaceHandler> {
  return {
    'metrora:getWorkspaceStatus': async () => {
      const state = await deps.getRuntimeState()
      if (state.status === 'unsupported-platform') {
        return { ok: true, value: { availability: 'unsupported-platform', platform: state.platform } satisfies DesktopWorkspaceAvailability }
      }
      if (state.status === 'unavailable') {
        return { ok: true, value: { availability: 'unavailable', reason: state.reason } satisfies DesktopWorkspaceAvailability }
      }
      try {
        const runtime = state.runtime as typeof state.runtime & Partial<WorkspaceBootstrapRuntime>
        if (typeof runtime.getBootstrapSnapshot === 'function') {
          return {
            ok: true,
            value: readyAvailability(state, await runtime.getBootstrapSnapshot(), 'pending'),
          }
        }
        return {
          ok: true,
          value: readyAvailability(state, await runtime.getSnapshot(), 'complete'),
        }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:inspectWorkspaceStatus': async () => {
      const state = await deps.getRuntimeState()
      if (state.status === 'unsupported-platform') {
        return { ok: true, value: { availability: 'unsupported-platform', platform: state.platform } satisfies DesktopWorkspaceAvailability }
      }
      if (state.status === 'unavailable') {
        return { ok: true, value: { availability: 'unavailable', reason: state.reason } satisfies DesktopWorkspaceAvailability }
      }
      try {
        return {
          ok: true,
          value: readyAvailability(state, await state.runtime.getSnapshot(), 'complete'),
        }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:createWorkspace': async (input?: unknown) => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      try {
        return { ok: true, value: await state.runtime.createWorkspace(parseCreateInput(input)) }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:pauseWorkspaceProduction': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      try {
        return { ok: true, value: await state.runtime.setProductionMode('paused') }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:resumeWorkspaceProduction': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      try {
        return { ok: true, value: await state.runtime.setProductionMode('active') }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:produceWorkspaceMeasurements': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      try {
        return { ok: true, value: await state.runtime.produceReviewedMeasurements() }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:recoverWorkspaceState': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      const runtime = state.runtime as typeof state.runtime & Partial<WorkspaceRecoveryRuntime>
      if (typeof runtime.recoverLocalState !== 'function') {
        return workspaceError(
          'workspace-recovery-unavailable',
          'Local Workspace recovery is unavailable in this desktop runtime.',
        )
      }
      try {
        return { ok: true, value: await runtime.recoverLocalState() }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:createWorkspaceBatch': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      try {
        return { ok: true, value: await state.runtime.createNextBatch() }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },

    'metrora:exportWorkspaceEvidence': async () => {
      const state = await readyState(deps)
      if ('ok' in state) return state
      const outputPath = await deps.chooseExportPath(suggestedExportName((deps.now ?? (() => new Date()))()))
      if (outputPath === null) return { ok: true, value: { outcome: 'cancelled' as const } }
      if (!path.isAbsolute(outputPath)) return workspaceError('bad-args', 'Workspace export path must be absolute.')
      try {
        const exported = await state.runtime.exportEvidence(outputPath)
        return {
          ok: true,
          value: {
            outcome: 'exported' as const,
            fileName: path.basename(exported.outputPath),
            verification: exported.verification,
            snapshot: exported.snapshot,
          },
        }
      } catch (error) {
        return { ok: false, error: sanitizeActionError(error) }
      }
    },
  }
}
