import type { ParsedApiCall } from '../../types.js'
import type { GenAiOperationNameV1, UsageMeasurementEventV1 } from './measurement.js'
import {
  toUsageMeasurementEventV1,
  type ParsedApiCallMeasurementContextV1,
} from './measurement-adapter.js'
import {
  resolveMeasurementEvidenceV1,
  type MeasurementEvidenceResolutionOptionsV1,
} from './provenance-mapper.js'

export type MeasurementSessionDisclosureV1 =
  | { mode: 'omit' }
  | { mode: 'include'; sessionId: string }

export type ReviewedUsageMeasurementEventContextV1 = {
  workspaceId: string
  endpointId: string
  eventIdentityKey: Uint8Array
  repositoryId?: string
  projectId?: string
  accountId?: string
  session: MeasurementSessionDisclosureV1
  tool: {
    name: string
    version?: string
  }
  collector: {
    /** Qovrion release/adapter implementation version, not parser provenance. */
    adapterVersion: string
    sourceFingerprintSha256: string
  }
  genAi: {
    operationName: GenAiOperationNameV1
    /** Actual model/API provider; never inferred from the collector name. */
    providerName: string
    requestModel?: string
  }
  evidence?: Omit<MeasurementEvidenceResolutionOptionsV1, 'sessionId'>
}

export type ReviewedUsageMeasurementEventResultV1 =
  | {
      status: 'created'
      profileId: string
      event: UsageMeasurementEventV1
    }
  | {
      status: 'withheld'
      reason: 'unreviewed-evidence-path'
    }

function disclosedSessionId(disclosure: MeasurementSessionDisclosureV1): string | undefined {
  if (!disclosure || typeof disclosure !== 'object') {
    throw new Error('session disclosure must be explicit')
  }
  if (disclosure.mode === 'omit') return undefined
  if (disclosure.mode !== 'include') {
    throw new Error('session disclosure mode must be omit or include')
  }
  if (typeof disclosure.sessionId !== 'string' || disclosure.sessionId.trim().length === 0) {
    throw new Error('included session id must be a non-empty string')
  }
  return disclosure.sessionId
}

/**
 * Create one public event only when the normalized call belongs to a reviewed
 * collector provenance path and its reasoning attribution is supported.
 *
 * This factory does not discover endpoint identity, AI provider, operation,
 * repository, account, or sharing intent. Those facts remain explicit inputs.
 * It also does not persist or transmit the resulting event.
 */
export function createReviewedUsageMeasurementEventV1(
  call: ParsedApiCall,
  context: ReviewedUsageMeasurementEventContextV1,
): ReviewedUsageMeasurementEventResultV1 {
  const sessionId = disclosedSessionId(context.session)
  const evidence = resolveMeasurementEvidenceV1(call, {
    ...context.evidence,
    sessionId,
  })
  if (!evidence) {
    return { status: 'withheld', reason: 'unreviewed-evidence-path' }
  }

  const adapterContext: ParsedApiCallMeasurementContextV1 = {
    workspaceId: context.workspaceId,
    endpointId: context.endpointId,
    eventIdentityKey: context.eventIdentityKey,
    ...(context.repositoryId !== undefined ? { repositoryId: context.repositoryId } : {}),
    ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(context.accountId !== undefined ? { accountId: context.accountId } : {}),
    tool: { ...context.tool },
    collector: {
      adapterId: evidence.profile.profileId,
      adapterVersion: context.collector.adapterVersion,
      sourceKind: evidence.profile.sourceKind,
      sourceFingerprintSha256: context.collector.sourceFingerprintSha256,
    },
    genAi: { ...context.genAi },
    costEvidence: evidence.costEvidence,
    quality: evidence.quality,
  }

  return {
    status: 'created',
    profileId: evidence.profile.profileId,
    event: toUsageMeasurementEventV1(call, adapterContext),
  }
}
