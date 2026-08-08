import { createHmac } from 'node:crypto'

import type { ParsedApiCall } from '../../types.js'
import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  UsageMeasurementEventV1Schema,
  type GenAiOperationNameV1,
  type UsageMeasurementDataV1,
  type UsageMeasurementEventV1,
} from './measurement.js'

export type MeasurementCostEvidenceV1 =
  | {
      kind: 'metered'
      source: 'provider' | 'client' | 'billing-export'
    }
  | {
      kind: 'estimated'
      method: 'token-pricing' | 'credit-conversion' | 'content-length' | 'other'
    }
  | {
      kind: 'unavailable'
    }

export type ParsedApiCallMeasurementContextV1 = {
  workspaceId: string
  endpointId: string
  /**
   * Local endpoint secret used only to pseudonymize private source identities.
   * It must contain at least 256 bits of entropy and is never copied into the
   * public event. Stable keys produce stable IDs on one endpoint; rotating the
   * key intentionally breaks linkability.
   */
  eventIdentityKey: Uint8Array
  repositoryId?: string
  projectId?: string
  sessionId?: string
  accountId?: string
  tool: {
    name: string
    version?: string
  }
  collector: {
    adapterId: string
    adapterVersion: string
    sourceKind: string
    sourceFingerprintSha256: string
  }
  genAi: {
    operationName: GenAiOperationNameV1
    providerName: string
    requestModel?: string
  }
  costEvidence: MeasurementCostEvidenceV1
  quality: UsageMeasurementDataV1['quality']
}

function costMicrosUsd(costUSD: number): number {
  if (!Number.isFinite(costUSD) || costUSD < 0) {
    throw new Error('measurement cost must be a finite, non-negative USD amount')
  }
  const amountMicrosUsd = Math.round(costUSD * 1_000_000)
  if (!Number.isSafeInteger(amountMicrosUsd)) {
    throw new Error('measurement cost exceeds the safe integer micro-USD range')
  }
  return amountMicrosUsd
}

function measurementCost(
  call: ParsedApiCall,
  evidence: MeasurementCostEvidenceV1,
): UsageMeasurementDataV1['cost'] {
  if (evidence.kind === 'unavailable') return { kind: 'unavailable' }
  const amountMicrosUsd = costMicrosUsd(call.costUSD)
  if (evidence.kind === 'metered') {
    return { kind: 'metered', amountMicrosUsd, source: evidence.source }
  }
  return { kind: 'estimated', amountMicrosUsd, method: evidence.method }
}

function measurementReasoning(call: ParsedApiCall): UsageMeasurementDataV1['reasoning'] {
  if (call.reasoningLevel === undefined && call.reasoningLevelSource === undefined) {
    return { level: 'unknown', source: 'unknown' }
  }
  if (call.reasoningLevel === undefined || call.reasoningLevelSource === undefined) {
    throw new Error('reasoning level and reasoning source must be present together')
  }
  return {
    level: call.reasoningLevel,
    source: call.reasoningLevelSource,
  }
}

function eventId(call: ParsedApiCall, context: ParsedApiCallMeasurementContextV1): string {
  if (!(context.eventIdentityKey instanceof Uint8Array) || context.eventIdentityKey.byteLength < 32) {
    throw new Error('event identity key must contain at least 32 bytes')
  }
  if (call.deduplicationKey.length === 0) {
    throw new Error('measurement source deduplication key must not be empty')
  }

  const digest = createHmac('sha256', context.eventIdentityKey)
    .update('metrora.measurement.v1\0')
    .update(context.endpointId)
    .update('\0')
    .update(context.collector.sourceFingerprintSha256)
    .update('\0')
    .update(call.deduplicationKey)
    .digest('hex')
  return `evt_${digest}`
}

function eventSubject(context: ParsedApiCallMeasurementContextV1): string {
  return `workspace/${context.workspaceId}/endpoint/${context.endpointId}`
}

/**
 * Project one already-normalized internal call into the strict public v1
 * measurement allowlist. The adapter deliberately does not infer model-provider
 * identity, cost provenance, or measurement quality from collector names.
 */
export function toUsageMeasurementEventV1(
  call: ParsedApiCall,
  context: ParsedApiCallMeasurementContextV1,
): UsageMeasurementEventV1 {
  if (context.sessionId === undefined && context.quality.sessionIdentity !== 'unknown') {
    throw new Error('session identity quality must be unknown when no sessionId is exported')
  }

  const event: UsageMeasurementEventV1 = {
    specversion: '1.0',
    id: eventId(call, context),
    source: `urn:metrora:endpoint:${context.endpointId}`,
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    time: call.timestamp,
    subject: eventSubject(context),
    datacontenttype: 'application/json',
    dataschema: USAGE_MEASUREMENT_DATA_SCHEMA_URI,
    data: {
      version: 1,
      workspaceId: context.workspaceId,
      endpointId: context.endpointId,
      ...(context.repositoryId !== undefined ? { repositoryId: context.repositoryId } : {}),
      ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
      ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
      ...(context.accountId !== undefined ? { accountId: context.accountId } : {}),
      tool: {
        name: context.tool.name,
        ...(context.tool.version !== undefined ? { version: context.tool.version } : {}),
      },
      collector: { ...context.collector },
      genAi: {
        operationName: context.genAi.operationName,
        providerName: context.genAi.providerName,
        ...(context.genAi.requestModel !== undefined ? { requestModel: context.genAi.requestModel } : {}),
        responseModel: call.model,
      },
      usage: {
        calls: 1,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        cacheReadTokens: call.usage.cacheReadInputTokens,
        cacheWriteTokens: call.usage.cacheCreationInputTokens,
        reasoningTokens: call.usage.reasoningTokens,
      },
      cost: measurementCost(call, context.costEvidence),
      reasoning: measurementReasoning(call),
      quality: { ...context.quality },
      privacy: {
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        patchesIncluded: false,
        secretsIncluded: false,
        localPathsIncluded: false,
      },
    },
  }

  return UsageMeasurementEventV1Schema.parse(event)
}
