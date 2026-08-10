import { describe, expect, it } from 'vitest'

import {
  assertWorkspaceCapabilityV1,
  classifyWorkspaceEvidenceCompatibilityV1,
  evaluateWorkspaceCapabilitiesV1,
  type WorkspaceCapabilityPolicyInputV1,
  WorkspaceCapabilityDeniedError,
} from './workspace-capability-policy.js'

function policy(overrides: Partial<WorkspaceCapabilityPolicyInputV1> = {}) {
  return evaluateWorkspaceCapabilitiesV1({
    inspected: true,
    workspaceConfigured: true,
    integrity: 'verified',
    compatibility: 'canonical',
    productionMode: 'active',
    unbatchedEventCount: 0,
    pendingBatchCount: 0,
    ...overrides,
  })
}

describe('private Workspace capability policy v1', () => {
  it('allows the canonical-only healthy workflow', () => {
    const capabilities = policy()
    expect(capabilities).toEqual({
      inspection: { allowed: true, reason: null },
      reviewedProduction: { allowed: true, reason: null },
      batchSign: { allowed: true, reason: null },
      canonicalExport: { allowed: true, reason: null },
      recovery: { allowed: true, reason: null },
      productionLifecycle: { allowed: true, reason: null },
    })
  })

  it('classifies verified historical-only storage as read-only, not corruption', () => {
    const compatibility = classifyWorkspaceEvidenceCompatibilityV1({
      workspaceConfigured: true,
      integrity: 'verified',
      canonicalEventCount: 0,
      historicalEventCount: 1_495,
      canonicalBatchCount: 0,
      historicalBatchCount: 1,
    })
    expect(compatibility).toBe('historical-read-only')

    const capabilities = policy({ compatibility })
    expect(capabilities.inspection.allowed).toBe(true)
    expect(capabilities.recovery.allowed).toBe(true)
    expect(capabilities.reviewedProduction).toEqual({ allowed: false, reason: 'historical-evidence-read-only' })
    expect(capabilities.batchSign).toEqual({ allowed: false, reason: 'historical-evidence-read-only' })
    expect(capabilities.canonicalExport).toEqual({ allowed: false, reason: 'historical-evidence-read-only' })
  })

  it('keeps mixed canonical and historical evidence deterministic and read-only', () => {
    const compatibility = classifyWorkspaceEvidenceCompatibilityV1({
      workspaceConfigured: true,
      integrity: 'verified',
      canonicalEventCount: 3,
      historicalEventCount: 1_495,
      canonicalBatchCount: 1,
      historicalBatchCount: 1,
    })
    expect(compatibility).toBe('mixed')
    const capabilities = policy({ compatibility })
    expect(capabilities.batchSign.reason).toBe('mixed-evidence-read-only')
    expect(capabilities.canonicalExport.reason).toBe('mixed-evidence-read-only')
  })

  it('fails closed for invalid and quarantined evidence while preserving inspection/recovery', () => {
    for (const [integrity, reason, compatibility] of [
      ['invalid', 'invalid-evidence', 'invalid'],
      ['quarantined', 'quarantined-evidence', 'quarantined'],
    ] as const) {
      const capabilities = policy({ integrity, compatibility })
      expect(capabilities.inspection.allowed).toBe(true)
      expect(capabilities.recovery.allowed).toBe(true)
      expect(capabilities.reviewedProduction.reason).toBe(reason)
      expect(capabilities.batchSign.reason).toBe(reason)
      expect(capabilities.canonicalExport.reason).toBe(reason)
    }
  })

  it('uses bounded reasons for setup, pending inspection and paused production', () => {
    expect(policy({ workspaceConfigured: false }).batchSign).toEqual({ allowed: false, reason: 'workspace-required' })
    expect(policy({ inspected: false }).inspection).toEqual({ allowed: true, reason: null })
    expect(policy({ integrity: 'unverified' }).batchSign).toEqual({ allowed: false, reason: 'inspection-pending' })
    expect(policy({ compatibility: 'uninspected' }).canonicalExport).toEqual({ allowed: false, reason: 'inspection-pending' })
    expect(policy({ productionMode: 'paused' }).reviewedProduction).toEqual({ allowed: false, reason: 'production-paused' })
  })

  it('does not advertise canonical recovery when the reviewed runtime is unavailable', () => {
    const capabilities = policy({ reviewedProductionAvailable: false })
    expect(capabilities.reviewedProduction).toEqual({ allowed: false, reason: 'runtime-unavailable' })
    expect(capabilities.recovery).toEqual({ allowed: false, reason: 'runtime-unavailable' })
    expect(capabilities.canonicalExport).toEqual({ allowed: true, reason: null })
  })

  it('enforces the same typed denial consumed by core actions', () => {
    const capabilities = policy({ compatibility: 'historical-read-only' })
    expect(() => assertWorkspaceCapabilityV1(capabilities, 'batchSign')).toThrow(WorkspaceCapabilityDeniedError)
    try {
      assertWorkspaceCapabilityV1(capabilities, 'batchSign')
    } catch (error) {
      expect(error).toMatchObject({ capability: 'batchSign', reason: 'historical-evidence-read-only' })
    }
  })
})
