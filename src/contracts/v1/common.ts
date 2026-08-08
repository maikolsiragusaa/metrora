import * as z from 'zod/v4'

export const METRORA_CONTRACT_VERSION = 1 as const
export const METRORA_SCHEMA_BASE_URI = 'https://schemas.metrora.dev/v1' as const
export const JSON_SCHEMA_DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema' as const

export const ContractVersionSchema = z.literal(METRORA_CONTRACT_VERSION)

export const OpaqueIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be an opaque, path-free identifier')

export const SlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const TimestampSchema = z.iso.datetime({ offset: true })
export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/)

const notNegativeZero = (value: number) => !Object.is(value, -0)
const negativeZeroMessage = 'negative zero is not allowed in canonical evidence'

export const NonNegativeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .refine(notNegativeZero, negativeZeroMessage)
export const PositiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const MicrosUsdSchema = NonNegativeIntegerSchema
export const FractionSchema = z
  .number()
  .min(0)
  .max(1)
  .refine(notNegativeZero, negativeZeroMessage)

export const DigestSetSchema = z.strictObject({
  sha256: Sha256DigestSchema,
})

export type DigestSetV1 = z.infer<typeof DigestSetSchema>

export function schemaUri(name: string): string {
  return `${METRORA_SCHEMA_BASE_URI}/${name}.schema.json`
}

export function toJsonSchema202012(schema: z.ZodType, name: string): Record<string, unknown> {
  return {
    $schema: JSON_SCHEMA_DIALECT_2020_12,
    $id: schemaUri(name),
    ...z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      reused: 'ref',
      cycles: 'throw',
    }),
  }
}
