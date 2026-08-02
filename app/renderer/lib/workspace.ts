export type WorkspaceEvidenceState =
  | 'workspace-required'
  | 'empty'
  | 'ready'
  | 'acknowledged'
  | 'quarantined'
  | 'blocked'

export type WorkspaceProductionMode = 'active' | 'paused'

export type DesktopWorkspaceSnapshot = {
  kind: 'metrora.desktop-workspace-snapshot'
  version: 1
  localOnly: true
  identity: {
    endpointId: string
    generation: number
    publicKeyFingerprintSha256: string
  }
  workspace: null | {
    workspaceId: string
    displayName: string
    slug: string
    ownership: 'personal'
    status: 'active'
    ownerRole: 'owner'
    endpoint: {
      endpointId: string
      displayName: string
      os: 'windows' | 'macos' | 'linux' | 'android' | 'other'
      architecture: 'x64' | 'arm64' | 'arm' | 'other'
      identityGeneration: number
      publicKeyFingerprintSha256: string
      metroraVersion: string
      collectorVersion: string
      capabilities: Array<'collect' | 'normalize' | 'aggregate' | 'serve-local-api' | 'read-companion-api'>
      enrollmentState: 'active'
    }
  }
  productionLifecycle?: null | {
    mode: WorkspaceProductionMode
    revision: number
    persisted: boolean
    updatedAt: string | null
  }
  evidence: {
    state: WorkspaceEvidenceState
    pendingEventCount: number
    unbatchedEventCount: number
    acknowledgedEventCount: number
    invalidEventCount: number
    quarantinedEventCount: number
    pendingBatchCount: number
    acknowledgedBatchCount: number
    blockers: string[]
  }
  privacy: {
    networkRequired: false
    promptsIncluded: false
    responsesIncluded: false
    sourceCodeIncluded: false
    secretsIncluded: false
    unrestrictedLocalPathsIncluded: false
  }
}

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
  | { availability: 'unsupported-platform'; platform: string }
  | { availability: 'unavailable'; reason: 'vault-unavailable' | 'initialization-failed' }

export type DesktopReviewedProductionSummary = {
  kind: 'metrora.canonical-reviewed-production-summary'
  version: 1
  outcome: 'paused' | 'completed'
  scanned: boolean
  eligibleCount: number
  producedCount: number
  existingCount: number
  withheldCount: number
  failedCount: number
}

export type DesktopWorkspaceProductionResult = {
  summary: DesktopReviewedProductionSummary
  snapshot: DesktopWorkspaceSnapshot
}

export type DesktopWorkspaceRecoverySummary = {
  kind: 'metrora.desktop-workspace-recovery-summary'
  version: 1
  outcome: 'workspace-required' | 'paused' | 'blocked' | 'healthy' | 'reconciled'
  retryAttempted: boolean
  blocker: 'invalid-evidence' | 'quarantined-evidence' | 'blocked-evidence' | null
  receiptRepairCount: number
  production: DesktopReviewedProductionSummary | null
}

export type DesktopWorkspaceRecoveryResult = {
  summary: DesktopWorkspaceRecoverySummary
  snapshot: DesktopWorkspaceSnapshot
}

export type DesktopWorkspaceBatchResult = {
  outcome: 'created' | 'empty'
  batch?: {
    batchId: string
    batchSha256: string
    firstSequence: number
    lastSequence: number
    eventCount: number
    identityGeneration: number
  }
  snapshot: DesktopWorkspaceSnapshot
}

export type DesktopWorkspaceProductionLifecycleResult = {
  outcome: 'changed' | 'unchanged'
  snapshot: DesktopWorkspaceSnapshot
}

export type DesktopWorkspaceExportResult =
  | { outcome: 'cancelled' }
  | {
      outcome: 'exported'
      fileName: string
      verification: {
        workspaceId: string
        endpointId: string
        endpointIdentityGeneration: number
        exportedAt: string
        batchCount: number
        eventCount: number
        pendingBatchCount: number
        acknowledgedBatchCount: number
        latestBatchSha256?: string
      }
      snapshot: DesktopWorkspaceSnapshot
    }

export interface WorkspaceBridge {
  getWorkspaceStatus(): Promise<DesktopWorkspaceAvailability>
  inspectWorkspaceStatus(): Promise<DesktopWorkspaceAvailability>
  createWorkspace(input: {
    displayName: string
    slug?: string
    endpointDisplayName: string
  }): Promise<{ outcome: 'created' | 'existing'; snapshot: DesktopWorkspaceSnapshot }>
  pauseWorkspaceProduction(): Promise<DesktopWorkspaceProductionLifecycleResult>
  resumeWorkspaceProduction(): Promise<DesktopWorkspaceProductionLifecycleResult>
  produceWorkspaceMeasurements(): Promise<DesktopWorkspaceProductionResult>
  recoverWorkspaceState(): Promise<DesktopWorkspaceRecoveryResult>
  createWorkspaceBatch(): Promise<DesktopWorkspaceBatchResult>
  exportWorkspaceEvidence(): Promise<DesktopWorkspaceExportResult>
}
