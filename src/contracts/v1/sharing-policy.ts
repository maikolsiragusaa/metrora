import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  OpaqueIdSchema,
  PositiveIntegerSchema,
  TimestampSchema,
} from './common.js'
import { WorkspaceRoleSchema } from './workspace.js'

export const SHARING_POLICY_KIND = 'metrora.sharing-policy' as const

export const ShareableDatasetSchema = z.enum([
  'aggregate-usage',
  'model-usage',
  'tool-usage',
  'repository-usage',
  'session-metadata',
  'evidence-summary',
])

const EndpointRecipientSchema = z.strictObject({
  type: z.literal('endpoint'),
  endpointIds: z.array(OpaqueIdSchema).min(1).max(128),
})

const WorkspaceRoleRecipientSchema = z.strictObject({
  type: z.literal('workspace-role'),
  roles: z.array(WorkspaceRoleSchema).min(1).max(4),
})

export const SharingRecipientSchema = z.discriminatedUnion('type', [
  EndpointRecipientSchema,
  WorkspaceRoleRecipientSchema,
])

const RollingWindowSchema = z.strictObject({
  type: z.literal('rolling-days'),
  days: PositiveIntegerSchema.max(3650),
})

const BoundedWindowSchema = z.strictObject({
  type: z.literal('bounded'),
  from: TimestampSchema,
  to: TimestampSchema,
})

export const SharingWindowSchema = z.discriminatedUnion('type', [
  RollingWindowSchema,
  BoundedWindowSchema,
])

export const SharingDisclosureSchema = z.strictObject({
  repositoryIdentity: z.enum(['none', 'opaque-id', 'display-name']),
  sessionIdentity: z.enum(['none', 'opaque-id']),
  localPaths: z.enum(['none', 'basename']),
  prompts: z.literal('none'),
  responses: z.literal('none'),
  sourceCode: z.literal('none'),
  patches: z.literal('none'),
  secrets: z.literal('none'),
})

export const SharingPolicyV1Schema = z.strictObject({
  kind: z.literal(SHARING_POLICY_KIND),
  version: ContractVersionSchema,
  policyId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  revision: PositiveIntegerSchema,
  status: z.enum(['active', 'disabled']),
  recipient: SharingRecipientSchema,
  datasets: z.array(ShareableDatasetSchema).min(1).max(6),
  window: SharingWindowSchema,
  disclosure: SharingDisclosureSchema,
  limits: z.strictObject({
    minimumRefreshSeconds: PositiveIntegerSchema.min(5).max(86400),
    maximumRecordsPerResponse: PositiveIntegerSchema.max(100_000),
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type ShareableDatasetV1 = z.infer<typeof ShareableDatasetSchema>
export type SharingRecipientV1 = z.infer<typeof SharingRecipientSchema>
export type SharingWindowV1 = z.infer<typeof SharingWindowSchema>
export type SharingDisclosureV1 = z.infer<typeof SharingDisclosureSchema>
export type SharingPolicyV1 = z.infer<typeof SharingPolicyV1Schema>
