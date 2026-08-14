import { z } from 'zod'

import { HistoricalPriceRatesV1Schema } from './history.js'

const NonEmptyIdentifierSchema = z.string().trim().min(1).max(240)
const IsoInstantSchema = z.string().datetime({ offset: true })

const EvidenceSourceSchema = z.enum(['provider', 'gateway', 'client'])

/**
 * Request-time evidence that can make a dynamic pricing rule resolvable.
 * These are deliberately bounded facts, not an executable pricing expression.
 */
export const HistoricalPricingEvidenceV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('provider-reported-tier'),
    tier: NonEmptyIdentifierSchema,
    source: EvidenceSourceSchema,
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('provider-reported-multiplier'),
    multiplier: z.number().finite().positive().max(1_000_000),
    source: EvidenceSourceSchema,
    observedAt: IsoInstantSchema,
  }),
  z.strictObject({
    kind: z.literal('quoted-rates'),
    rates: HistoricalPriceRatesV1Schema,
    source: EvidenceSourceSchema,
    observedAt: IsoInstantSchema,
  }),
])

/**
 * Source-observed delivery and billing identity. Omitted dimensions stay
 * omitted: callers must not fill them from the model owner's identity.
 */
export const HistoricalPricingContextV1Schema = z.strictObject({
  modelIdentity: NonEmptyIdentifierSchema.optional(),
  modelOwner: NonEmptyIdentifierSchema.optional(),
  inferenceProvider: NonEmptyIdentifierSchema.optional(),
  pricingAuthority: NonEmptyIdentifierSchema.optional(),
  gateway: NonEmptyIdentifierSchema.optional(),
  route: NonEmptyIdentifierSchema.optional(),
  billingTier: NonEmptyIdentifierSchema.optional(),
  region: NonEmptyIdentifierSchema.optional(),
  pricingEvidence: z.array(HistoricalPricingEvidenceV1Schema).max(8).optional(),
})

export type HistoricalPricingEvidenceV1 = z.infer<typeof HistoricalPricingEvidenceV1Schema>
export type HistoricalPricingContextV1 = z.infer<typeof HistoricalPricingContextV1Schema>
