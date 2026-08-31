import {
  ACTION_KIND_RUN_CORE_COMPATIBILITY,
  type ActionOperationStatus,
  type ActionResultCountsV1,
  computeActionProposalDigest,
  createCoreCompatibilityAction,
  coreCompatibilityPackIdentity,
  TrustedActionAuthorityV1,
} from './action-contract-v1.js'
import {
  cancelCoreCompatibilityAction,
  executeApprovedCoreCompatibility,
  readCoreCompatibilityAction,
  recordCoreCompatibilityProposal,
} from './core-compatibility-operation-v1.js'
import type { CoreCompatibilityActionRecordV1 } from './core-compatibility-state-v1.js'

export type MetroraHarnessActionStatus = ActionOperationStatus
export type MetroraHarnessActionEvent = {
  actionId: string
  kind: typeof ACTION_KIND_RUN_CORE_COMPATIBILITY
  status: MetroraHarnessActionStatus
  model: string
  originatingSurface: 'desktop'
  runtime: { id: string }
  proposalDigest: string
  pack: ReturnType<typeof coreCompatibilityPackIdentity>
  checks: { planned: number; completed: number }
  progress: { planned: number; completed: number }
  cancellation: { requested: boolean }
  timeout: { perRequestMs: number; operationMs: number; triggered: boolean }
  result: { history: 'saved' | 'duplicate'; counts: ActionResultCountsV1 } | null
  evidence: { available: boolean; history: 'saved' | 'duplicate' } | null
  failure: { category: string; message: string } | null
  updatedAt: string
}

export type MetroraHarnessActBridgeOptions = {
  actionsDir?: string
  dataDir?: string
  now?: () => Date
  authority?: TrustedActionAuthorityV1
  emit?: (event: MetroraHarnessActionEvent) => void
}

export type CoreCompatibilityTargetId = 'ollama-local' | 'llama-server'

function boundedMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value)
  return raw
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/(?:\b[A-Za-z]:[\\/][^\s"'<>|]+|\b(?:file|vscode-file):\/\/[^\s"'<>|]+)/giu, '[redacted]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|auth(?:entication)?[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|password|credential|token)\b\s*(?:=|:)\s*[^\s,;]+/giu, '[redacted]')
    .replace(/[\r\n]+/gu, ' ')
    .trim()
    .slice(0, 240)
}

function actionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new Error('Harness action id is invalid.')
  return value
}
function proposalDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error('Harness proposal digest is invalid.')
  return value
}
function counts(operation: CoreCompatibilityActionRecordV1['operation']): ActionResultCountsV1 | null {
  return operation.resultCounts ? { ...operation.resultCounts } : null
}
function project(record: CoreCompatibilityActionRecordV1): MetroraHarnessActionEvent {
  const resultCounts = counts(record.operation)
  return {
    actionId: record.id,
    kind: ACTION_KIND_RUN_CORE_COMPATIBILITY,
    status: record.status,
    model: record.contract.target.model,
    originatingSurface: 'desktop',
    runtime: { id: record.contract.target.runtime.id },
    proposalDigest: computeActionProposalDigest(record.contract),
    pack: coreCompatibilityPackIdentity(),
    checks: { planned: record.operation.checksPlanned, completed: record.operation.checksCompleted },
    progress: { planned: record.operation.progress.planned, completed: record.operation.progress.completed },
    cancellation: { requested: record.operation.cancellation.requested },
    timeout: { ...record.operation.timeout },
    result: resultCounts && record.operation.result ? { history: record.operation.result.history, counts: resultCounts } : null,
    evidence: record.operation.evidenceReferences[0] ? { available: true, history: record.operation.evidenceReferences[0].history } : null,
    failure: record.operation.failure ? { category: record.operation.failure.category, message: boundedMessage(record.operation.failure.message) } : null,
    updatedAt: record.at,
  }
}

/** Trusted-process bridge for the one accepted Harness action kind. */
export function createMetroraHarnessActBridge(options: MetroraHarnessActBridgeOptions = {}) {
  const now = options.now ?? (() => new Date())
  const authority = options.authority ?? new TrustedActionAuthorityV1({ now })
  const readOptions = { actionsDir: options.actionsDir, dataDir: options.dataDir, now }
  const emit = (record: CoreCompatibilityActionRecordV1): MetroraHarnessActionEvent => {
    const event = project(record)
    options.emit?.(event)
    return event
  }

  async function readRecord(action: string): Promise<CoreCompatibilityActionRecordV1 | null> {
    return readCoreCompatibilityAction(actionId(action), readOptions)
  }
  async function read(action: string): Promise<MetroraHarnessActionEvent | null> {
    const record = await readRecord(action)
    return record ? emit(record) : null
  }
  async function proposeCoreCompatibility(model: string, target: CoreCompatibilityTargetId = 'ollama-local'): Promise<MetroraHarnessActionEvent> {
    if (target !== 'ollama-local') {
      throw new Error('Core Compatibility exact semantics are currently supported only for Ollama; llama-server uses a different runtime contract and no action was prepared.')
    }
    if (typeof model !== 'string' || !model.trim()) throw new Error('An explicit local Ollama model is required for Core Compatibility.')
    const contract = createCoreCompatibilityAction({ model: model.trim(), originatingSurface: 'desktop' })
    const record = await recordCoreCompatibilityProposal(contract, { actionsDir: options.actionsDir, now })
    return emit(record)
  }
  async function approveAndExecuteCoreCompatibility(input: { actionId: string; proposalDigest: string; signal?: AbortSignal }): Promise<MetroraHarnessActionEvent> {
    const current = await readRecord(actionId(input.actionId))
    if (!current) throw new Error('Harness action proposal was not found.')
    const expectedDigest = computeActionProposalDigest(current.contract)
    if (proposalDigest(input.proposalDigest) !== expectedDigest) throw new Error('Harness action proposal changed; approval was rejected.')
    if (current.status !== 'proposed') throw new Error('Harness action is no longer awaiting confirmation.')
    // The renderer supplies no contract or approval token. The trusted host
    // re-reads the persisted proposal and signs that exact contract here.
    const approved = authority.issueApprovalAfterTrustedUserConfirmation(current.contract)
    let lastEvent = emit(current)
    let stopped = false
    const publish = async () => {
      if (stopped) return
      try {
        const record = await readRecord(input.actionId)
        if (record) {
          const next = project(record)
          if (JSON.stringify(next) !== JSON.stringify(lastEvent)) {
            lastEvent = emit(record)
          }
        }
      } catch {
        // The canonical operation records a journal failure. The final
        // execution result remains the authoritative failure projection.
      }
    }
    const poll = setInterval(() => { void publish() }, 100)
    poll.unref?.()
    try {
      const record = await executeApprovedCoreCompatibility(
        approved,
        { authority, actionsDir: options.actionsDir, dataDir: options.dataDir, now, signal: input.signal },
      )
      return emit(record)
    } finally {
      stopped = true
      clearInterval(poll)
    }
  }
  async function cancel(action: string): Promise<MetroraHarnessActionEvent | null> {
    const result = await cancelCoreCompatibilityAction(actionId(action), readOptions)
    if ('record' in result && result.record) return emit(result.record)
    return read(action)
  }
  return {
    proposeCoreCompatibility,
    approveAndExecuteCoreCompatibility,
    cancelCoreCompatibility: cancel,
    readCoreCompatibility: read,
  }
}
