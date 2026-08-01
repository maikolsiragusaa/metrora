import type { CliError, CodeburnBridge } from './types'

// Both globals point at the same compatibility-shaped preload surface during
// the migration window. New renderer code uses metrora; codeburn remains an
// exported alias so existing sections and third-party integrations keep working.
declare global {
  interface Window {
    metrora?: CodeburnBridge
    qovrion?: CodeburnBridge
    codeburn: CodeburnBridge
  }
}

export const metrora: CodeburnBridge = window.metrora ?? window.qovrion ?? window.codeburn
export const codeburn: CodeburnBridge = metrora

/** Coerce anything thrown across the IPC boundary into a CliError shape. */
export function normalizeCliError(err: unknown): CliError {
  if (err && typeof err === 'object' && 'kind' in err && typeof (err as CliError).kind === 'string') {
    const error = err as CliError
    return { kind: error.kind, message: error.message ?? 'Metrora CLI error' }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'nonzero', message }
}
