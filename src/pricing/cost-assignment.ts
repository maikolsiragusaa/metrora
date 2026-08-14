import { z } from 'zod'

const NonNegativeSafeMicrosSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const NonEmptyIdentifierSchema = z.string().trim().min(1).max(240)
const OptionalIdentifierSchema = NonEmptyIdentifierSchema.optional()
const IsoInstantSchema = z.string().datetime({ offset: true })

export const CostAssignmentOriginV1Schema = z.enum([
  'reviewed-book',
  'local-observation',
])

export const CostAssignmentRateSelectionV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('base') }),
  z.strictObject({
    kind: z.literal('prompt-input-tokens-above'),
    tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    kind: z.literal('pricing-policy'),
    policyId: NonEmptyIdentifierSchema,
    conditionKinds: z.array(NonEmptyIdentifierSchema).min(1).max(8),
  }),
  z.strictObject({
    kind: z.literal('pricing-evidence'),
    evidenceKind: z.enum(['provider-reported-tier', 'provider-reported-multiplier', 'quoted-rates']),
  }),
])

/** Compact, non-secret explanation for a reconstructed price assignment. */
export const CostAssignmentPricingProvenanceV1Schema = z.strictObject({
  pricingAuthority: OptionalIdentifierSchema,
  pricingModel: OptionalIdentifierSchema,
  modelIdentity: OptionalIdentifierSchema,
  modelOwner: OptionalIdentifierSchema,
  inferenceProvider: OptionalIdentifierSchema,
  gateway: OptionalIdentifierSchema,
  route: OptionalIdentifierSchema,
  billingTier: OptionalIdentifierSchema,
  region: OptionalIdentifierSchema,
  validFrom: z.strictObject({
    basis: z.enum(['official-effective', 'reviewed-effective', 'first-observed']),
    at: IsoInstantSchema,
  }).optional(),
  validUntil: IsoInstantSchema.optional(),
  sourceKind: z.enum([
    'official-provider',
    'official-route',
    'litellm',
    'models-dev',
    'openrouter',
    'manual-reviewed',
  ]).optional(),
})

const MeteredCostAssignmentV1Schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('metered'),
  amountMicrosUsd: NonNegativeSafeMicrosSchema,
  source: z.enum(['provider', 'client', 'billing-export']),
})

const TokenPriceCostAssignmentV1Schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('token-price'),
  amountMicrosUsd: NonNegativeSafeMicrosSchema,
  priceRecordId: NonEmptyIdentifierSchema,
  priceOrigin: CostAssignmentOriginV1Schema,
  rateSelection: CostAssignmentRateSelectionV1Schema,
  pricingProvenance: CostAssignmentPricingProvenanceV1Schema.optional(),
})

const ExplicitZeroCostAssignmentV1Schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('explicit-zero'),
  amountMicrosUsd: z.literal(0),
  reason: z.enum(['free-route', 'free-model', 'local-inference', 'manual-reviewed']),
  priceRecordId: NonEmptyIdentifierSchema.optional(),
  priceOrigin: CostAssignmentOriginV1Schema.optional(),
  pricingProvenance: CostAssignmentPricingProvenanceV1Schema.optional(),
})

const LegacyFrozenCostAssignmentV1Schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('legacy-frozen'),
  amountMicrosUsd: NonNegativeSafeMicrosSchema,
  reason: z.enum([
    'inherited-token-pricing',
    'collector-estimate',
    'unknown',
  ]),
})

const UnavailableCostAssignmentV1Schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('unavailable'),
  reason: z.enum([
    'no-price-record',
    'missing-required-rate',
    'conflicting-evidence',
  ]),
})

const CostAssignmentUnionV1Schema = z.discriminatedUnion('kind', [
  MeteredCostAssignmentV1Schema,
  TokenPriceCostAssignmentV1Schema,
  ExplicitZeroCostAssignmentV1Schema,
  LegacyFrozenCostAssignmentV1Schema,
  UnavailableCostAssignmentV1Schema,
])

export const CostAssignmentV1Schema = CostAssignmentUnionV1Schema.superRefine((assignment, context) => {
  if (assignment.kind !== 'explicit-zero') return
  if ((assignment.priceRecordId === undefined) !== (assignment.priceOrigin === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'explicit-zero priceRecordId and priceOrigin must be present together',
    })
  }
})

export type CostAssignmentOriginV1 = z.infer<typeof CostAssignmentOriginV1Schema>
export type CostAssignmentRateSelectionV1 = z.infer<typeof CostAssignmentRateSelectionV1Schema>
export type CostAssignmentPricingProvenanceV1 = z.infer<typeof CostAssignmentPricingProvenanceV1Schema>
export type CostAssignmentV1 = z.infer<typeof CostAssignmentV1Schema>
export type SettledCostAssignmentV1 = Exclude<CostAssignmentV1, { kind: 'unavailable' }>

export function costUsdToMicrosV1(costUSD: number): number {
  if (!Number.isFinite(costUSD) || costUSD < 0) {
    throw new Error('cost assignment requires a finite, non-negative USD amount')
  }
  const amountMicrosUsd = Math.round(costUSD * 1_000_000)
  if (!Number.isSafeInteger(amountMicrosUsd)) {
    throw new Error('cost assignment exceeds the safe integer micro-USD range')
  }
  return amountMicrosUsd
}

export function settledCostMicrosV1(assignment: CostAssignmentV1): number | undefined {
  return assignment.kind === 'unavailable' ? undefined : assignment.amountMicrosUsd
}

export function settledCostUsdV1(assignment: CostAssignmentV1): number | undefined {
  const micros = settledCostMicrosV1(assignment)
  return micros === undefined ? undefined : micros / 1_000_000
}

export function costAssignmentMatchesUsdV1(
  assignmentValue: CostAssignmentV1 | unknown,
  costUSD: number,
): boolean {
  const assignment = CostAssignmentV1Schema.parse(assignmentValue)
  return validatedCostAssignmentMatchesUsdV1(assignment, costUSD)
}

/** Compare a cost only after the assignment has already passed V1 validation. */
export function validatedCostAssignmentMatchesUsdV1(
  assignment: CostAssignmentV1,
  costUSD: number,
): boolean {
  const micros = settledCostMicrosV1(assignment)
  if (micros === undefined) return false
  return micros === costUsdToMicrosV1(costUSD)
}

export function assertCostAssignmentMatchesUsdV1(
  assignmentValue: CostAssignmentV1 | unknown,
  costUSD: number,
): CostAssignmentV1 {
  const assignment = CostAssignmentV1Schema.parse(assignmentValue)
  if (!validatedCostAssignmentMatchesUsdV1(assignment, costUSD)) {
    throw new Error('cost assignment does not match the call cost at micro-USD precision')
  }
  return assignment
}
