import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  DigestSetSchema,
  MicrosUsdSchema,
  NonNegativeIntegerSchema,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from './common.js'

export const IN_TOTO_STATEMENT_V1 = 'https://in-toto.io/Statement/v1' as const
export const METRORA_USAGE_EVIDENCE_PREDICATE_V1 =
  'https://schemas.metrora.dev/attestations/usage-evidence/v1' as const
export const EVIDENCE_PREDICATE_KIND = 'metrora.usage-evidence' as const

export const InTotoSubjectV1Schema = z.strictObject({
  name: z.string().trim().min(1).max(512),
  digest: DigestSetSchema,
})

export const EvidenceMaterialV1Schema = z.strictObject({
  name: z.string().trim().min(1).max(240),
  kind: z.enum(['source-record', 'pricing-table', 'adapter-manifest', 'measurement-batch']),
  digest: DigestSetSchema,
  mediaType: z.string().trim().min(1).max(160).optional(),
})

export const EvidenceAggregateClaimV1Schema = z.strictObject({
  claimId: OpaqueIdSchema,
  type: z.literal('aggregate-usage'),
  period: z.strictObject({
    from: TimestampSchema,
    to: TimestampSchema,
  }),
  dimensions: z.strictObject({
    repositoryId: OpaqueIdSchema.optional(),
    projectId: OpaqueIdSchema.optional(),
    toolName: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(240).optional(),
  }),
  totals: z.strictObject({
    calls: NonNegativeIntegerSchema,
    sessions: NonNegativeIntegerSchema,
    inputTokens: NonNegativeIntegerSchema,
    outputTokens: NonNegativeIntegerSchema,
    cacheReadTokens: NonNegativeIntegerSchema,
    cacheWriteTokens: NonNegativeIntegerSchema,
    reasoningTokens: NonNegativeIntegerSchema,
    costMicrosUsd: MicrosUsdSchema,
  }),
  assurance: z.strictObject({
    sourceCoverage: z.enum(['complete', 'partial', 'unknown']),
    tokenCounts: z.enum(['measured', 'mixed', 'estimated', 'unknown']),
    pricing: z.enum(['measured', 'mixed', 'estimated', 'unavailable']),
  }),
})

export const UsageEvidencePredicateV1Schema = z.strictObject({
  kind: z.literal(EVIDENCE_PREDICATE_KIND),
  version: ContractVersionSchema,
  evidenceId: OpaqueIdSchema,
  createdAt: TimestampSchema,
  workspaceId: OpaqueIdSchema,
  endpointId: OpaqueIdSchema,
  producer: z.strictObject({
    name: z.literal('metrora'),
    version: z.string().trim().min(1).max(64),
  }),
  measurementBatch: z.strictObject({
    batchId: OpaqueIdSchema,
    sha256: Sha256DigestSchema,
  }),
  canonicalization: z.literal('RFC8785'),
  contentPolicy: z.strictObject({
    promptsIncluded: z.literal(false),
    responsesIncluded: z.literal(false),
    sourceCodeIncluded: z.literal(false),
    patchesIncluded: z.literal(false),
    secretsIncluded: z.literal(false),
    localPathsIncluded: z.literal(false),
  }),
  materials: z.array(EvidenceMaterialV1Schema).min(1).max(10_000),
  claims: z.array(EvidenceAggregateClaimV1Schema).min(1).max(10_000),
  previousEvidenceSha256: Sha256DigestSchema.optional(),
})

export const UsageEvidenceStatementV1Schema = z.strictObject({
  _type: z.literal(IN_TOTO_STATEMENT_V1),
  subject: z.array(InTotoSubjectV1Schema).min(1).max(128),
  predicateType: z.literal(METRORA_USAGE_EVIDENCE_PREDICATE_V1),
  predicate: UsageEvidencePredicateV1Schema,
})

export type InTotoSubjectV1 = z.infer<typeof InTotoSubjectV1Schema>
export type EvidenceMaterialV1 = z.infer<typeof EvidenceMaterialV1Schema>
export type EvidenceAggregateClaimV1 = z.infer<typeof EvidenceAggregateClaimV1Schema>
export type UsageEvidencePredicateV1 = z.infer<typeof UsageEvidencePredicateV1Schema>
export type UsageEvidenceStatementV1 = z.infer<typeof UsageEvidenceStatementV1Schema>

export function parseUsageEvidenceStatementV1(input: unknown): UsageEvidenceStatementV1 {
  const statement = UsageEvidenceStatementV1Schema.parse(input)
  const expectedSubjectName = `metrora:measurement-batch:${statement.predicate.measurementBatch.batchId}`
  const hasBatchSubject = statement.subject.some((subject) =>
    subject.name === expectedSubjectName &&
    subject.digest.sha256 === statement.predicate.measurementBatch.sha256,
  )

  if (!hasBatchSubject) {
    throw new Error('usage evidence subject must bind the declared measurement batch digest')
  }

  return statement
}
