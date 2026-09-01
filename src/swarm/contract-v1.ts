/**
 * Public, transport-neutral Swarm contracts.
 *
 * These types intentionally describe observable bounded work only. They do
 * not contain provider session fields, raw prompts/responses, credentials, or
 * private controller intelligence.
 */

export const SWARM_CONTRACT_VERSION = 'metrora.swarm.v1' as const
export const SWARM_SCHEMA_VERSION = 1 as const

export type SwarmJsonValue = null | string | number | boolean | { [key: string]: SwarmJsonValue } | SwarmJsonValue[]
export type SwarmJsonObject = { [key: string]: SwarmJsonValue }

export type SwarmScopeV1 = Readonly<Record<string, SwarmJsonValue>>
export type SwarmMetadataV1 = Readonly<Record<string, string | number | boolean | null>>
export type SwarmIdentityV1 = {
  id: string
  label: string
}

export type SwarmUsageV1 = Readonly<{
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}>

export type SwarmWorkerRoleV1 = 'investigator' | 'verifier' | 'evidence-reviewer'
export type SwarmWorkerProfileV1 = 'fixed-investigator-v1' | 'fixed-verifier-v1' | 'fixed-evidence-reviewer-v1'
export type SwarmWorkerResultStatusV1 = 'completed' | 'partial' | 'unavailable' | 'failed' | 'timeout' | 'cancelled'
export type SwarmWorkerEventStatusV1 = 'queued' | 'started' | 'tool-started' | 'tool-completed' | 'completed' | 'unavailable' | 'failed' | 'cancelled'
export type SwarmLifecycleStatusV1 = 'proposed' | 'preparing' | 'started' | 'completed' | 'failed' | 'cancelled'
export type SwarmRunStatusV1 = 'completed' | 'partial' | 'failed' | 'timeout' | 'cancelled'
export type SwarmSynthesisStatusV1 = 'not-requested' | 'started' | 'completed' | 'unavailable' | 'failed' | 'cancelled'

export type SwarmLimitsV1 = {
  maxToolCalls: number
  maxToolRounds: number
  maxOutputBytes: number
  timeoutMs: number
}

export type SwarmDeadlineV1 = {
  startedAt: string
  deadlineAt: string
}

export type SwarmToolActivityV1 = {
  name: string
  status: 'started' | 'completed' | 'unavailable' | 'failed' | 'cancelled'
}

export type SwarmEvidenceRefV1 = {
  id: string
  label: string
}
export type SwarmEvidenceResultStatusV1 = 'usable' | 'partial' | 'unavailable'
export type SwarmEvidenceResultV1 = {
  status: SwarmEvidenceResultStatusV1
  requiredToolNames: readonly string[]
  usedToolNames: readonly string[]
}

export type SwarmWorkerRequestV1 = {
  contractVersion: typeof SWARM_CONTRACT_VERSION
  schemaVersion: typeof SWARM_SCHEMA_VERSION
  runId: string
  workerId: string
  task: string
  role: SwarmWorkerRoleV1
  profile: SwarmWorkerProfileV1
  runtime: SwarmIdentityV1
  model: SwarmIdentityV1
  scope: SwarmScopeV1
  allowedToolNames: readonly string[]
  limits: SwarmLimitsV1
  deadline: SwarmDeadlineV1
  metadata: SwarmMetadataV1
}

export type SwarmWorkerResultV1 = {
  contractVersion: typeof SWARM_CONTRACT_VERSION
  schemaVersion: typeof SWARM_SCHEMA_VERSION
  runId: string
  workerId: string
  role: SwarmWorkerRoleV1
  profile: SwarmWorkerProfileV1
  status: SwarmWorkerResultStatusV1
  runtime: SwarmIdentityV1
  model: SwarmIdentityV1
  startedAt: string
  endedAt: string
  toolActivity: readonly SwarmToolActivityV1[]
  evidenceRefs: readonly SwarmEvidenceRefV1[]
  evidenceSummary: string
  /** Execution status is separate from whether the required evidence is usable. */
  evidenceResult?: SwarmEvidenceResultV1
  answer: string
  artifactSummary: string | null
  errors: readonly string[]
  usage: SwarmUsageV1 | null
  resultDigest: string
}

export type SwarmEventV1 =
  | {
      contractVersion: typeof SWARM_CONTRACT_VERSION
      schemaVersion: typeof SWARM_SCHEMA_VERSION
      kind: 'swarm'
      runId: string
      status: SwarmLifecycleStatusV1
      at: string
      detail?: string
    }
  | {
      contractVersion: typeof SWARM_CONTRACT_VERSION
      schemaVersion: typeof SWARM_SCHEMA_VERSION
      kind: 'worker'
      runId: string
      workerId: string
      role: SwarmWorkerRoleV1
      status: SwarmWorkerEventStatusV1
      at: string
      toolName?: string
      detail?: string
    }
  | {
      contractVersion: typeof SWARM_CONTRACT_VERSION
      schemaVersion: typeof SWARM_SCHEMA_VERSION
      kind: 'synthesis'
      runId: string
      status: Exclude<SwarmSynthesisStatusV1, 'not-requested'>
      at: string
      detail?: string
    }

export type SwarmSynthesisInputV1 = {
  contractVersion: typeof SWARM_CONTRACT_VERSION
  schemaVersion: typeof SWARM_SCHEMA_VERSION
  runId: string
  task: string
  scope: SwarmScopeV1
  workers: readonly SwarmWorkerResultV1[]
}

export type SwarmSynthesisResultV1 = {
  status: 'completed' | 'unavailable' | 'failed' | 'cancelled'
  answer: string
  evidenceSummary: string
  errors: readonly string[]
}

export type SwarmEvidenceWorkerV1 = {
  workerId: string
  role: SwarmWorkerRoleV1
  runtime: SwarmIdentityV1
  model: SwarmIdentityV1
  status: SwarmWorkerResultStatusV1
  allowedToolNames: readonly string[]
  toolNamesUsed: readonly string[]
  startedAt: string
  endedAt: string
  resultDigest: string
  answerDigest: string
  usage: SwarmUsageV1 | null
}

export type SwarmEvidenceV1 = {
  schema: 'metrora.swarm-evidence.v1'
  schemaVersion: typeof SWARM_SCHEMA_VERSION
  runId: string
  taskDigest: string
  scopeDigest: string
  workerCount: number
  workers: readonly SwarmEvidenceWorkerV1[]
  finalStatus: SwarmRunStatusV1
  cancellation: boolean
  timeout: boolean
  synthesis: {
    status: SwarmSynthesisStatusV1
    answerDigest: string | null
    evidenceDigest: string | null
  }
  methodology: {
    coordinator: 'metrora-harness-public-baseline-v1'
    assignments: 'fixed-transparent-roles-v1'
    runtimeSelection: 'manual-current-runtime-v1'
  }
  evidenceDigest: string
}

export type SwarmRunResultV1 = {
  contractVersion: typeof SWARM_CONTRACT_VERSION
  schemaVersion: typeof SWARM_SCHEMA_VERSION
  runId: string
  task: string
  status: SwarmRunStatusV1
  workers: readonly SwarmWorkerResultV1[]
  synthesis: SwarmSynthesisResultV1 | null
  evidence: SwarmEvidenceV1
}
