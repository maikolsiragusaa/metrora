import type { CliError, MetroraBridge } from './types'
import type { WorkspaceBridge } from './workspace'

declare global {
  interface Window {
    metrora: MetroraBridge & WorkspaceBridge
  }
}

export const metrora: MetroraBridge & WorkspaceBridge = window.metrora

/** Coerce anything thrown across the IPC boundary into a CliError shape. */
export function normalizeCliError(err: unknown): CliError {
  if (err && typeof err === 'object' && 'kind' in err && typeof (err as CliError).kind === 'string') {
    const error = err as CliError
    return { kind: error.kind, message: error.message ?? 'Metrora CLI error' }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'nonzero', message }
}
