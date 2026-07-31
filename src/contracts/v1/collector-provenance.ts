import * as z from 'zod/v4'

import type { ParsedApiCall } from '../../types.js'
import { ContractVersionSchema } from './common.js'

export const COLLECTOR_PROVENANCE_PROFILE_KIND = 'qovrion.collector-provenance-profile' as const

export const FactProvenanceSchema = z.enum(['measured', 'derived', 'estimated', 'unknown'])
export const IdentityProvenanceSchema = z.enum(['exact', 'normalized', 'derived', 'unknown'])
export const ReasoningAttributionCapabilitySchema = z.enum(['explicit', 'model-label', 'unknown'])

export const CollectorProvenanceProfileV1Schema = z.strictObject({
  kind: z.literal(COLLECTOR_PROVENANCE_PROFILE_KIND),
  version: ContractVersionSchema,
  profileId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  collector: z.enum(['claude', 'codex']),
  parserVersion: z.string().min(1).max(240),
  sourceKind: z.string().min(1).max(120),
  facts: z.strictObject({
    tokens: z.strictObject({
      input: FactProvenanceSchema,
      output: FactProvenanceSchema,
      cacheRead: FactProvenanceSchema,
      cacheWrite: FactProvenanceSchema,
      reasoning: FactProvenanceSchema,
    }),
    modelIdentity: IdentityProvenanceSchema,
    sessionIdentity: IdentityProvenanceSchema,
    reasoningAttribution: z.array(ReasoningAttributionCapabilitySchema).min(1).max(3),
    cost: z.strictObject({
      basis: z.literal('local-token-pricing'),
      tokenBasis: z.enum(['measured', 'estimated-content-length', 'mixed']),
      metered: z.literal(false),
      requiresPricingCoverage: z.literal(true),
    }),
  }),
  privacy: z.strictObject({
    promptsRequired: z.literal(false),
    responsesRequired: z.literal(false),
    sourceCodeRequired: z.literal(false),
    patchesRequired: z.literal(false),
    localPathsRequired: z.literal(false),
  }),
})

export type FactProvenanceV1 = z.infer<typeof FactProvenanceSchema>
export type CollectorProvenanceProfileV1 = z.infer<typeof CollectorProvenanceProfileV1Schema>

const CLAUDE_PARSER_VERSION = 'advisor-usage-v1-skills-rich-capture-v1-cross-provider-pr-v1'
const CODEX_PARSER_VERSION = 'mcp-attribution-v5-est-cost-active-timing-mcp-wait-rich-capture-v1-cross-provider-pr-v1-reasoning-attribution-v1'

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const privacyWithoutContent = {
  promptsRequired: false,
  responsesRequired: false,
  sourceCodeRequired: false,
  patchesRequired: false,
  localPathsRequired: false,
} as const

export const CLAUDE_JSONL_PROFILE_V1 = deepFreeze(CollectorProvenanceProfileV1Schema.parse({
  kind: COLLECTOR_PROVENANCE_PROFILE_KIND,
  version: 1,
  profileId: 'claude-jsonl-usage-v1',
  collector: 'claude',
  parserVersion: CLAUDE_PARSER_VERSION,
  sourceKind: 'claude-jsonl',
  facts: {
    tokens: {
      input: 'measured',
      output: 'measured',
      cacheRead: 'derived',
      cacheWrite: 'derived',
      reasoning: 'unknown',
    },
    modelIdentity: 'normalized',
    sessionIdentity: 'exact',
    reasoningAttribution: ['model-label', 'unknown'],
    cost: {
      basis: 'local-token-pricing',
      tokenBasis: 'mixed',
      metered: false,
      requiresPricingCoverage: true,
    },
  },
  privacy: privacyWithoutContent,
}))

export const CODEX_TOKEN_COUNT_PROFILE_V1 = deepFreeze(CollectorProvenanceProfileV1Schema.parse({
  kind: COLLECTOR_PROVENANCE_PROFILE_KIND,
  version: 1,
  profileId: 'codex-rollout-token-count-v1',
  collector: 'codex',
  parserVersion: CODEX_PARSER_VERSION,
  sourceKind: 'codex-rollout-jsonl-token-count',
  facts: {
    tokens: {
      input: 'measured',
      output: 'measured',
      cacheRead: 'measured',
      cacheWrite: 'unknown',
      reasoning: 'measured',
    },
    modelIdentity: 'normalized',
    sessionIdentity: 'exact',
    reasoningAttribution: ['explicit', 'model-label', 'unknown'],
    cost: {
      basis: 'local-token-pricing',
      tokenBasis: 'measured',
      metered: false,
      requiresPricingCoverage: true,
    },
  },
  privacy: privacyWithoutContent,
}))

export const CODEX_CONTENT_FALLBACK_PROFILE_V1 = deepFreeze(CollectorProvenanceProfileV1Schema.parse({
  kind: COLLECTOR_PROVENANCE_PROFILE_KIND,
  version: 1,
  profileId: 'codex-rollout-content-fallback-v1',
  collector: 'codex',
  parserVersion: CODEX_PARSER_VERSION,
  sourceKind: 'codex-rollout-jsonl-content-fallback',
  facts: {
    tokens: {
      input: 'estimated',
      output: 'estimated',
      cacheRead: 'unknown',
      cacheWrite: 'unknown',
      reasoning: 'unknown',
    },
    modelIdentity: 'normalized',
    sessionIdentity: 'exact',
    reasoningAttribution: ['explicit', 'model-label', 'unknown'],
    cost: {
      basis: 'local-token-pricing',
      tokenBasis: 'estimated-content-length',
      metered: false,
      requiresPricingCoverage: true,
    },
  },
  privacy: privacyWithoutContent,
}))

export const CollectorProvenanceProfilesV1 = deepFreeze([
  CLAUDE_JSONL_PROFILE_V1,
  CODEX_TOKEN_COUNT_PROFILE_V1,
  CODEX_CONTENT_FALLBACK_PROFILE_V1,
] as const)

/**
 * Resolve only collector paths whose provenance has been reviewed. Returning
 * undefined is intentional: unknown collectors must not receive optimistic
 * quality or cost defaults merely because they already produce ParsedApiCall.
 */
export function collectorProvenanceProfileForCall(
  call: Pick<ParsedApiCall, 'provider' | 'isEstimated'>,
): CollectorProvenanceProfileV1 | undefined {
  if (call.provider === 'claude') return CLAUDE_JSONL_PROFILE_V1
  if (call.provider === 'codex') {
    return call.isEstimated
      ? CODEX_CONTENT_FALLBACK_PROFILE_V1
      : CODEX_TOKEN_COUNT_PROFILE_V1
  }
  return undefined
}
