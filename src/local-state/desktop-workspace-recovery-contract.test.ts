import { describe, expect, it } from 'vitest'

import { DesktopWorkspaceRecoverySummaryV1Schema } from './desktop-reviewed-production-runtime.js'

const production = {
  kind: 'metrora.canonical-reviewed-production-summary' as const,
  version: 1 as const,
  outcome: 'completed' as const,
  scanned: true,
  eligibleCount: 0,
  producedCount: 0,
  existingCount: 0,
  withheldCount: 0,
  failedCount: 0,
}

describe('desktop Workspace recovery summary v1', () => {
  it('accepts the bounded valid outcome shapes', () => {
    expect(DesktopWorkspaceRecoverySummaryV1Schema.parse({
      kind: 'metrora.desktop-workspace-recovery-summary',
      version: 1,
      outcome: 'paused',
      retryAttempted: false,
      blocker: null,
      production: null,
    }).outcome).toBe('paused')

    expect(DesktopWorkspaceRecoverySummaryV1Schema.parse({
      kind: 'metrora.desktop-workspace-recovery-summary',
      version: 1,
      outcome: 'blocked',
      retryAttempted: false,
      blocker: 'invalid-evidence',
      production: null,
    }).outcome).toBe('blocked')

    expect(DesktopWorkspaceRecoverySummaryV1Schema.parse({
      kind: 'metrora.desktop-workspace-recovery-summary',
      version: 1,
      outcome: 'healthy',
      retryAttempted: true,
      blocker: null,
      production,
    }).outcome).toBe('healthy')
  })

  it('rejects contradictory retry, blocker, and production combinations', () => {
    for (const invalid of [
      {
        outcome: 'blocked', retryAttempted: false, blocker: null, production: null,
      },
      {
        outcome: 'healthy', retryAttempted: false, blocker: null, production: null,
      },
      {
        outcome: 'paused', retryAttempted: false, blocker: null, production,
      },
      {
        outcome: 'reconciled', retryAttempted: true, blocker: 'blocked-evidence', production,
      },
    ]) {
      expect(() => DesktopWorkspaceRecoverySummaryV1Schema.parse({
        kind: 'metrora.desktop-workspace-recovery-summary',
        version: 1,
        ...invalid,
      })).toThrow()
    }
  })
})
