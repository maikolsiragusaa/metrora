import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  OpaqueIdSchema,
  SlugSchema,
  TimestampSchema,
} from './common.js'

export const WORKSPACE_KIND = 'metrora.workspace' as const
export const WORKSPACE_MEMBERSHIP_KIND = 'metrora.workspace-membership' as const

export const WorkspaceOwnershipSchema = z.enum(['personal', 'organization'])
export const WorkspaceStatusSchema = z.enum(['active', 'suspended', 'deleted'])
export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'analyst', 'viewer'])
export const MembershipStatusSchema = z.enum(['invited', 'active', 'suspended', 'removed'])
export const PrincipalTypeSchema = z.enum(['user', 'service'])

export const WorkspaceV1Schema = z.strictObject({
  kind: z.literal(WORKSPACE_KIND),
  version: ContractVersionSchema,
  workspaceId: OpaqueIdSchema,
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(120),
  ownership: WorkspaceOwnershipSchema,
  status: WorkspaceStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const WorkspaceMembershipV1Schema = z.strictObject({
  kind: z.literal(WORKSPACE_MEMBERSHIP_KIND),
  version: ContractVersionSchema,
  membershipId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  principal: z.strictObject({
    type: PrincipalTypeSchema,
    principalId: OpaqueIdSchema,
  }),
  role: WorkspaceRoleSchema,
  status: MembershipStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type WorkspaceOwnershipV1 = z.infer<typeof WorkspaceOwnershipSchema>
export type WorkspaceStatusV1 = z.infer<typeof WorkspaceStatusSchema>
export type WorkspaceRoleV1 = z.infer<typeof WorkspaceRoleSchema>
export type MembershipStatusV1 = z.infer<typeof MembershipStatusSchema>
export type WorkspaceV1 = z.infer<typeof WorkspaceV1Schema>
export type WorkspaceMembershipV1 = z.infer<typeof WorkspaceMembershipV1Schema>
