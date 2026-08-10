import * as z from 'zod/v4'

export const WorkspaceEvidenceIntegrityV1Schema = z.enum([
  'unverified',
  'verified',
  'invalid',
  'quarantined',
])

export type WorkspaceEvidenceIntegrityV1 = z.infer<typeof WorkspaceEvidenceIntegrityV1Schema>

export const WorkspaceEvidenceCompatibilityV1Schema = z.enum([
  'uninspected',
  'workspace-required',
  'empty',
  'canonical',
  'historical-read-only',
  'mixed',
  'invalid',
  'quarantined',
])

export type WorkspaceEvidenceCompatibilityV1 = z.infer<typeof WorkspaceEvidenceCompatibilityV1Schema>

export const WorkspaceCapabilityReasonV1Schema = z.enum([
  'inspection-pending',
  'workspace-required',
  'invalid-evidence',
  'quarantined-evidence',
  'historical-evidence-read-only',
  'mixed-evidence-read-only',
  'unbatched-evidence',
  'production-paused',
  'runtime-unavailable',
])

export type WorkspaceCapabilityReasonV1 = z.infer<typeof WorkspaceCapabilityReasonV1Schema>

export const WorkspaceCapabilityV1Schema = z.strictObject({
  allowed: z.boolean(),
  reason: WorkspaceCapabilityReasonV1Schema.nullable(),
}).superRefine((value, context) => {
  if (value.allowed && value.reason !== null) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'allowed capability cannot carry a denial reason' })
  }
  if (!value.allowed && value.reason === null) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'denied capability requires a bounded reason' })
  }
})

export type WorkspaceCapabilityV1 = z.infer<typeof WorkspaceCapabilityV1Schema>

export const DesktopWorkspaceCapabilitiesV1Schema = z.strictObject({
  inspection: WorkspaceCapabilityV1Schema,
  reviewedProduction: WorkspaceCapabilityV1Schema,
  batchSign: WorkspaceCapabilityV1Schema,
  canonicalExport: WorkspaceCapabilityV1Schema,
  recovery: WorkspaceCapabilityV1Schema,
  productionLifecycle: WorkspaceCapabilityV1Schema,
})

export type DesktopWorkspaceCapabilitiesV1 = z.infer<typeof DesktopWorkspaceCapabilitiesV1Schema>
export type WorkspaceCapabilityNameV1 = keyof DesktopWorkspaceCapabilitiesV1

export type WorkspaceCapabilityPolicyInputV1 = {
  inspected: boolean
  workspaceConfigured: boolean
  integrity: WorkspaceEvidenceIntegrityV1
  compatibility: WorkspaceEvidenceCompatibilityV1
  productionMode: 'active' | 'paused'
  unbatchedEventCount: number
  pendingBatchCount: number
  reviewedProductionAvailable?: boolean
}

export type WorkspaceStorageDispositionFactsV1 = {
  workspaceConfigured: boolean
  integrity: WorkspaceEvidenceIntegrityV1
  canonicalEventCount: number
  historicalEventCount: number
  canonicalBatchCount: number
  historicalBatchCount: number
}

function allow(): WorkspaceCapabilityV1 {
  return { allowed: true, reason: null }
}

function deny(reason: WorkspaceCapabilityReasonV1): WorkspaceCapabilityV1 {
  return { allowed: false, reason }
}

function baseMutationReason(input: WorkspaceCapabilityPolicyInputV1): WorkspaceCapabilityReasonV1 | null {
  if (!input.inspected) return 'inspection-pending'
  if (!input.workspaceConfigured) return 'workspace-required'
  if (input.integrity === 'unverified') return 'inspection-pending'
  if (input.integrity === 'invalid') return 'invalid-evidence'
  if (input.integrity === 'quarantined') return 'quarantined-evidence'
  if (input.compatibility === 'uninspected') return 'inspection-pending'
  if (input.compatibility === 'workspace-required') return 'workspace-required'
  if (input.compatibility === 'historical-read-only') return 'historical-evidence-read-only'
  if (input.compatibility === 'mixed') return 'mixed-evidence-read-only'
  if (input.compatibility === 'invalid') return 'invalid-evidence'
  if (input.compatibility === 'quarantined') return 'quarantined-evidence'
  return null
}

function checkedCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

/**
 * The only policy evaluator for private Desktop Workspace operations. Storage
 * adapters report facts/dispositions; this function turns them into the
 * capabilities exposed to the renderer and enforced by runtime actions.
 */
export function evaluateWorkspaceCapabilitiesV1(
  rawInput: WorkspaceCapabilityPolicyInputV1,
): DesktopWorkspaceCapabilitiesV1 {
  const input = {
    ...rawInput,
    unbatchedEventCount: checkedCount(rawInput.unbatchedEventCount, 'unbatched event count'),
    pendingBatchCount: checkedCount(rawInput.pendingBatchCount, 'pending batch count'),
  }
  const mutationReason = baseMutationReason(input)
  const recoveryRuntimeUnavailable = input.reviewedProductionAvailable === false
    && mutationReason === null
    && input.productionMode === 'active'

  const capabilities: DesktopWorkspaceCapabilitiesV1 = {
    // The inspection operation itself is available before the first scan. The
    // inspected flag gates mutation capabilities, not the ability to request a
    // bounded read-only check.
    inspection: allow(),
    reviewedProduction: mutationReason
      ? deny(mutationReason)
      : input.reviewedProductionAvailable === false
        ? deny('runtime-unavailable')
        : input.productionMode === 'paused' ? deny('production-paused') : allow(),
    batchSign: mutationReason ? deny(mutationReason) : allow(),
    canonicalExport: mutationReason
      ? deny(mutationReason)
      : input.unbatchedEventCount > 0 ? deny('unbatched-evidence') : allow(),
    // Invalid/quarantined and historical/mixed states still expose a bounded
    // read-only check. A canonical active state needs the reviewed scanner for
    // the recovery retry, so do not advertise recovery when that runtime is
    // unavailable.
    recovery: recoveryRuntimeUnavailable ? deny('runtime-unavailable') : allow(),
    productionLifecycle: !input.inspected
      ? deny('inspection-pending')
      : !input.workspaceConfigured ? deny('workspace-required') : allow(),
  }

  return DesktopWorkspaceCapabilitiesV1Schema.parse(capabilities)
}

export function uninspectedWorkspaceCapabilitiesV1(workspaceConfigured: boolean): DesktopWorkspaceCapabilitiesV1 {
  return evaluateWorkspaceCapabilitiesV1({
    inspected: false,
    workspaceConfigured,
    integrity: 'unverified',
    compatibility: 'uninspected',
    productionMode: 'active',
    unbatchedEventCount: 0,
    pendingBatchCount: 0,
  })
}

export function classifyWorkspaceEvidenceCompatibilityV1(
  facts: WorkspaceStorageDispositionFactsV1,
): WorkspaceEvidenceCompatibilityV1 {
  if (!facts.workspaceConfigured) return 'workspace-required'
  if (facts.integrity === 'unverified') return 'uninspected'
  if (facts.integrity === 'invalid') return 'invalid'
  if (facts.integrity === 'quarantined') return 'quarantined'

  const hasCanonical = facts.canonicalEventCount > 0 || facts.canonicalBatchCount > 0
  const hasHistorical = facts.historicalEventCount > 0 || facts.historicalBatchCount > 0
  if (!hasCanonical && !hasHistorical) return 'empty'
  if (hasHistorical && !hasCanonical) return 'historical-read-only'
  if (hasCanonical && hasHistorical) return 'mixed'
  return 'canonical'
}

export function assertWorkspaceCapabilityV1(
  capabilities: DesktopWorkspaceCapabilitiesV1,
  capability: WorkspaceCapabilityNameV1,
  detail?: string,
): void {
  const decision = capabilities[capability]
  if (decision.allowed) return
  throw new WorkspaceCapabilityDeniedError(capability, decision.reason ?? 'invalid-evidence', detail)
}

export class WorkspaceCapabilityDeniedError extends Error {
  readonly capability: WorkspaceCapabilityNameV1
  readonly reason: WorkspaceCapabilityReasonV1

  constructor(capability: WorkspaceCapabilityNameV1, reason: WorkspaceCapabilityReasonV1, context?: string) {
    const message = reason === 'workspace-required'
      ? 'a local personal workspace is required'
      : reason === 'historical-evidence-read-only'
        ? 'historical evidence is immutable, verified and read-only; canonical schema export requires an explicit compatibility design'
        : reason === 'mixed-evidence-read-only'
          ? 'mixed canonical and historical evidence is verified but read-only until an explicit compatibility design exists'
          : reason === 'invalid-evidence'
            ? 'workspace evidence is invalid and requires recovery'
            : reason === 'quarantined-evidence'
              ? 'workspace evidence is quarantined and requires review'
              : reason === 'unbatched-evidence'
                ? 'workspace has unbatched reviewed events'
                : reason === 'runtime-unavailable'
                  ? 'the reviewed-production runtime is unavailable'
                : `workspace action is unavailable: ${reason}`
    super(`Workspace capability ${capability} is unavailable: ${message}${context ? ` (${context})` : ''}`)
    this.name = 'WorkspaceCapabilityDeniedError'
    this.capability = capability
    this.reason = reason
  }
}

export function isReadOnlyCompatibilityV1(
  compatibility: WorkspaceEvidenceCompatibilityV1,
): boolean {
  return compatibility === 'historical-read-only' || compatibility === 'mixed'
}
