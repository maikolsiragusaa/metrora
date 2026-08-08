import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from './common.js'

export const ENDPOINT_KIND = 'metrora.endpoint' as const

export const EndpointTypeSchema = z.enum(['desktop', 'server', 'companion'])
export const EndpointOsSchema = z.enum(['windows', 'macos', 'linux', 'android', 'other'])
export const EndpointArchitectureSchema = z.enum(['x64', 'arm64', 'arm', 'other'])
export const EndpointCapabilitySchema = z.enum([
  'collect',
  'normalize',
  'aggregate',
  'serve-local-api',
  'read-companion-api',
])
export const EndpointKeyAlgorithmSchema = z.enum(['ecdsa-p256', 'ed25519'])

const PendingEnrollmentSchema = z.strictObject({
  state: z.literal('pending'),
  requestedAt: TimestampSchema,
})

const ActiveEnrollmentSchema = z.strictObject({
  state: z.literal('active'),
  requestedAt: TimestampSchema,
  enrolledAt: TimestampSchema,
})

const RevokedEnrollmentSchema = z.strictObject({
  state: z.literal('revoked'),
  requestedAt: TimestampSchema,
  enrolledAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema,
  reason: z.string().trim().min(1).max(240).optional(),
})

export const EndpointEnrollmentSchema = z.discriminatedUnion('state', [
  PendingEnrollmentSchema,
  ActiveEnrollmentSchema,
  RevokedEnrollmentSchema,
])

export const EndpointV1Schema = z.strictObject({
  kind: z.literal(ENDPOINT_KIND),
  version: ContractVersionSchema,
  endpointId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  displayName: z.string().trim().min(1).max(120),
  endpointType: EndpointTypeSchema,
  platform: z.strictObject({
    os: EndpointOsSchema,
    architecture: EndpointArchitectureSchema,
  }),
  identity: z.strictObject({
    keyAlgorithm: EndpointKeyAlgorithmSchema,
    publicKeyFingerprintSha256: Sha256DigestSchema,
  }),
  software: z.strictObject({
    metroraVersion: z.string().trim().min(1).max(64),
    collectorVersion: z.string().trim().min(1).max(64),
  }),
  capabilities: z.array(EndpointCapabilitySchema).min(1).max(8),
  enrollment: EndpointEnrollmentSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastSeenAt: TimestampSchema.optional(),
})

export type EndpointTypeV1 = z.infer<typeof EndpointTypeSchema>
export type EndpointCapabilityV1 = z.infer<typeof EndpointCapabilitySchema>
export type EndpointEnrollmentV1 = z.infer<typeof EndpointEnrollmentSchema>
export type EndpointV1 = z.infer<typeof EndpointV1Schema>
