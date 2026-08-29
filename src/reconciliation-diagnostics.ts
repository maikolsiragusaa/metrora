/**
 * Opt-in diagnostics for tracing the fresh reconciliation lifecycle.
 *
 * The default path is silent. When enabled, callers should pass only bounded
 * operational fields (provider names, counts, statuses, booleans, and elapsed
 * times); source paths, exception text, prompts, and other user data do not
 * belong in this stream.
 */
export type ReconciliationDiagnosticValue = string | number | boolean | null

export type ReconciliationDiagnosticFields = Record<string, ReconciliationDiagnosticValue | undefined>

export function reconciliationDebugEnabled(): boolean {
  return process.env['METRORA_RECONCILIATION_DEBUG'] === '1'
}

export function traceReconciliation(
  stage: string,
  fields: ReconciliationDiagnosticFields = {},
): void {
  if (!reconciliationDebugEnabled()) return

  const payload: Record<string, ReconciliationDiagnosticValue> = { stage }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value
  }

  try {
    process.stderr.write(`METRORA_RECONCILIATION ${JSON.stringify(payload)}\n`)
  } catch {
    // Diagnostics must never affect reconciliation when stderr is closed.
  }
}
