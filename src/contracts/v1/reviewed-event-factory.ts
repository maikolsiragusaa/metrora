import { normalizeExplicitModelProvider } from '../../model-provider.js'
import type { ParsedApiCall } from '../../types.js'
import type { GenAiOperationNameV1, UsageMeasurementEventV1 } from './measurement.js'
import {
  toUsageMeasurementEventV1,
  type ParsedApiCallMeasurementContextV1,
} from './measurement-adapter.js'
import { resolveMeasurementEvidenceV1 } from './provenance-mapper.js'

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
}

export type ReviewedUsageMeasurementEventResultV1 =
  | {
      status: 'created'
      profileId: string
      event: UsageMeasurementEventV1
    }
  | {
      status: 'withheld'
      reason: 'unreviewed-evidence-path' | 'model-provider-mismatch'
    }

function disclosedSessionId(disclosure: MeasurementSessionDisclosureV1): string | undefined {
  if (!disclosure || typeof disclosure !== 'object') {
    throw new Error('session disclosure must be explicit')
  }
  if (disclosure.mode === 'omit') {
    if ('sessionId' in disclosure) {
      throw new Error('omitted session disclosure cannot carry a session id')
    }
    return undefined
  }
  if (disclosure.mode !== 'include') {
    throw new Error('session disclosure mode must be omit or include')
  }
  if (typeof disclosure.sessionId !== 'string' || disclosure.sessionId.trim().length === 0) {
    throw new Error('included session id must be a non-empty string')
  }
  return disclosure.sessionId
}

export function createReviewedUsageMeasurementEventV1(
  call: ParsedApiCall,
  context: ReviewedUsageMeasurementEventContextV1,
): ReviewedUsageMeasurementEventResultV1 {
  const sessionId = disclosedSessionId(context.session)
  const evidence = resolveMeasurementEvidenceV1(call, { sessionId })
  if (!evidence) {
    return { status: 'withheld', reason: 'unreviewed-evidence-path' }
  }

  let providerName = context.genAi.providerName
  if (call.modelProvider !== undefined) {
    const declaredProvider = normalizeExplicitModelProvider(context.genAi.providerName)
    if (!declaredProvider || declaredProvider !== call.modelProvider) {
      return { status: 'withheld', reason: 'model-provider-mismatch' }
    }
    providerName = call.modelProvider
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
    genAi: { ...context.genAi, providerName },
    costEvidence: evidence.costEvidence,
    quality: evidence.quality,
  }

  return {
    status: 'created',
    profileId: evidence.profile.profileId,
    event: toUsageMeasurementEventV1(call, adapterContext),
  }
}
