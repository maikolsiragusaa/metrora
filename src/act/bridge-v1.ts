import {
  ACTION_CONTRACT_VERSION,
  ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
  ACTION_SCHEMA_VERSION,
  type ActionContractV1,
  type ApprovedActionV1,
  TrustedActionAuthorityV1,
  createCoreConformanceBenchAction,
} from './action-contract-v1.js'
import { CORE_TASK_PACK_ID, CORE_TASK_PACK_VERSION } from '../bench/task-pack-v1.js'
import {
  cancelCoreConformanceBenchAction,
  executeApprovedCoreConformanceBench,
  readCoreConformanceAction,
  recordCoreConformanceProposal,
  type BenchActionCancellationResult,
  type CoreBenchActionRecordV1,
} from './bench-operation-v1.js'
import { projectActionForMobile, type ActionMobileProjectionV1 } from './projection-v1.js'

export type CoreConformanceProposalInputV1 = {
  model: string
  timeoutMs?: number
}

export type CoreConformanceConfirmationSummaryV1 = {
  contractVersion: typeof ACTION_CONTRACT_VERSION
  schemaVersion: typeof ACTION_SCHEMA_VERSION
  actionId: string
  kind: typeof ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH
  title: 'Core conformance'
  model: string
  runtime: 'Ollama local'
  checksPlanned: 6
  network: 'Local only'
  apiCost: 'None'
  result: 'Saved to Bench history'
  proposalDigest: string
  pack: { packId: typeof CORE_TASK_PACK_ID; version: typeof CORE_TASK_PACK_VERSION; digest: string }
}

export type ActionBridgeOptionsV1 = {
  authority: TrustedActionAuthorityV1
}

export type ActionBridgeV1 = {
  contractVersion: typeof ACTION_CONTRACT_VERSION
  schemaVersion: typeof ACTION_SCHEMA_VERSION
  proposeCoreConformance(input: CoreConformanceProposalInputV1): Promise<{
    proposal: ActionContractV1
    confirmation: CoreConformanceConfirmationSummaryV1
  }>
  executeCoreConformance(approved: ApprovedActionV1): Promise<CoreBenchActionRecordV1>
  status(actionId: string): Promise<ActionMobileProjectionV1 | null>
  cancel(actionId: string): Promise<BenchActionCancellationResult>
}

function confirmationSummary(proposal: ActionContractV1): CoreConformanceConfirmationSummaryV1 {
  return {
    contractVersion: ACTION_CONTRACT_VERSION,
    schemaVersion: ACTION_SCHEMA_VERSION,
    actionId: proposal.actionId,
    kind: ACTION_KIND_RUN_CORE_CONFORMANCE_BENCH,
    title: 'Core conformance',
    model: proposal.target.model,
    runtime: 'Ollama local',
    checksPlanned: proposal.limits.checksPlanned,
    network: 'Local only',
    apiCost: 'None',
    result: 'Saved to Bench history',
    proposalDigest: proposal.approval.proposalDigest,
    pack: { packId: proposal.target.pack.packId, version: proposal.target.pack.version, digest: proposal.target.pack.digest },
  }
}

/**
 * Minimal trusted-process bridge. It has no approval method: the host obtains
 * an approval token from TrustedActionAuthorityV1 after a real user event and
 * passes only that signed token plus the exact proposal to execute.
 */
export function createActionBridgeV1(options: ActionBridgeOptionsV1): ActionBridgeV1 {
  const { authority } = options
  return {
    contractVersion: ACTION_CONTRACT_VERSION,
    schemaVersion: ACTION_SCHEMA_VERSION,
    async proposeCoreConformance(input): Promise<{ proposal: ActionContractV1; confirmation: CoreConformanceConfirmationSummaryV1 }> {
      const proposal = createCoreConformanceBenchAction({ ...input, originatingSurface: 'desktop' })
      await recordCoreConformanceProposal(proposal)
      return { proposal, confirmation: confirmationSummary(proposal) }
    },
    async executeCoreConformance(approved): Promise<CoreBenchActionRecordV1> {
      if (approved.contract.originatingSurface !== 'desktop') throw new Error('the desktop bridge accepts only desktop-originated proposals')
      return executeApprovedCoreConformanceBench(approved, { authority })
    },
    async status(actionId): Promise<ActionMobileProjectionV1 | null> {
      const record = await readCoreConformanceAction(actionId)
      return record ? projectActionForMobile(record) : null
    },
    async cancel(actionId): Promise<BenchActionCancellationResult> {
      return cancelCoreConformanceBenchAction(actionId)
    },
  }
}
