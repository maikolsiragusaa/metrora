import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  MicrosUsdSchema,
  NonNegativeIntegerSchema,
  OpaqueIdSchema,
  PositiveIntegerSchema,
  Sha256DigestSchema,
  TimestampSchema,
  schemaUri,
} from './common.js'

export const MEASUREMENT_BATCH_KIND = 'metrora.measurement-batch' as const
export const USAGE_MEASUREMENT_EVENT_TYPE = 'dev.metrora.measurement.ai-usage.v1' as const
export const USAGE_MEASUREMENT_DATA_SCHEMA_URI = schemaUri('usage-measurement')

export const GenAiOperationNameSchema = z.enum([
  'chat',
  'create_agent',
  'embeddings',
  'execute_tool',
  'generate_content',
  'invoke_agent',
  'invoke_workflow',
  'retrieval',
  'text_completion',
  'other',
])

export const ReasoningLevelSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'adaptive',
])

const KnownReasoningSchema = z.strictObject({
  level: ReasoningLevelSchema,
  source: z.enum(['explicit', 'model-label']),
})

const UnknownReasoningSchema = z.strictObject({
  level: z.literal('unknown'),
  source: z.literal('unknown'),
})

export const MeasurementReasoningSchema = z.discriminatedUnion('level', [
  KnownReasoningSchema,
  UnknownReasoningSchema,
])

const MeteredCostSchema = z.strictObject({
  kind: z.literal('metered'),
  amountMicrosUsd: MicrosUsdSchema,
  source: z.enum(['provider', 'client', 'billing-export']),
})

const EstimatedCostSchema = z.strictObject({
  kind: z.literal('estimated'),
  amountMicrosUsd: MicrosUsdSchema,
  method: z.enum(['token-pricing', 'credit-conversion', 'content-length', 'other']),
})

const UnavailableCostSchema = z.strictObject({
  kind: z.literal('unavailable'),
})

export const MeasurementCostSchema = z.discriminatedUnion('kind', [
  MeteredCostSchema,
  EstimatedCostSchema,
  UnavailableCostSchema,
])

export const UsageMeasurementDataV1Schema = z.strictObject({
  version: ContractVersionSchema,
  workspaceId: OpaqueIdSchema,
  endpointId: OpaqueIdSchema,
  repositoryId: OpaqueIdSchema.optional(),
  projectId: OpaqueIdSchema.optional(),
  sessionId: OpaqueIdSchema.optional(),
  accountId: OpaqueIdSchema.optional(),
  tool: z.strictObject({
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(64).optional(),
  }),
  collector: z.strictObject({
    adapterId: OpaqueIdSchema,
    adapterVersion: z.string().trim().min(1).max(64),
    sourceKind: z.string().trim().min(1).max(120),
    sourceFingerprintSha256: Sha256DigestSchema,
  }),
  genAi: z.strictObject({
    operationName: GenAiOperationNameSchema,
    providerName: z.string().trim().min(1).max(120),
    requestModel: z.string().trim().min(1).max(240).optional(),
    responseModel: z.string().trim().min(1).max(240),
  }),
  usage: z.strictObject({
    calls: PositiveIntegerSchema,
    inputTokens: NonNegativeIntegerSchema,
    outputTokens: NonNegativeIntegerSchema,
    cacheReadTokens: NonNegativeIntegerSchema,
    cacheWriteTokens: NonNegativeIntegerSchema,
    reasoningTokens: NonNegativeIntegerSchema,
  }),
  cost: MeasurementCostSchema,
  reasoning: MeasurementReasoningSchema,
  quality: z.strictObject({
    tokenCounts: z.enum(['measured', 'derived', 'estimated', 'unknown']),
    modelIdentity: z.enum(['exact', 'normalized', 'unknown']),
    sessionIdentity: z.enum(['exact', 'derived', 'unknown']),
  }),
  privacy: z.strictObject({
    promptsIncluded: z.literal(false),
    responsesIncluded: z.literal(false),
    sourceCodeIncluded: z.literal(false),
    patchesIncluded: z.literal(false),
    secretsIncluded: z.literal(false),
    localPathsIncluded: z.literal(false),
  }),
})

const UriReferenceSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^\S+$/, 'URI references cannot contain whitespace')

export const UsageMeasurementEventV1Schema = z.strictObject({
  specversion: z.literal('1.0'),
  id: OpaqueIdSchema,
  source: UriReferenceSchema,
  type: z.literal(USAGE_MEASUREMENT_EVENT_TYPE),
  time: TimestampSchema,
  subject: z.string().trim().min(1).max(512).optional(),
  datacontenttype: z.literal('application/json'),
  dataschema: z.literal(USAGE_MEASUREMENT_DATA_SCHEMA_URI),
  data: UsageMeasurementDataV1Schema,
})

export const MeasurementBatchV1Schema = z.strictObject({
  kind: z.literal(MEASUREMENT_BATCH_KIND),
  version: ContractVersionSchema,
  batchId: OpaqueIdSchema,
  createdAt: TimestampSchema,
  producer: z.strictObject({
    endpointId: OpaqueIdSchema,
    metroraVersion: z.string().trim().min(1).max(64),
    adapterSetSha256: Sha256DigestSchema,
  }),
  semanticConventions: z.strictObject({
    cloudEvents: z.literal('1.0'),
    openTelemetryGenAi: z.strictObject({
      version: z.string().trim().min(1).max(64),
      stability: z.literal('development'),
    }),
    metrora: z.literal('1'),
  }),
  previousBatchSha256: Sha256DigestSchema.optional(),
  events: z.array(UsageMeasurementEventV1Schema).min(1).max(10_000),
})

export type GenAiOperationNameV1 = z.infer<typeof GenAiOperationNameSchema>
export type MeasurementReasoningV1 = z.infer<typeof MeasurementReasoningSchema>
export type MeasurementCostV1 = z.infer<typeof MeasurementCostSchema>
export type UsageMeasurementDataV1 = z.infer<typeof UsageMeasurementDataV1Schema>
export type UsageMeasurementEventV1 = z.infer<typeof UsageMeasurementEventV1Schema>
export type MeasurementBatchV1 = z.infer<typeof MeasurementBatchV1Schema>
