import * as z from 'zod/v4'

import {
  ContractVersionSchema,
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from './common.js'

export const REPOSITORY_IDENTITY_KIND = 'metrora.repository-identity' as const

const CredentialFreeUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const parsed = new URL(value)
    return parsed.username.length === 0 && parsed.password.length === 0
  }, 'repository URLs must not contain credentials')

const RemoteRepositoryLocatorSchema = z.strictObject({
  mode: z.literal('remote'),
  canonicalUrl: CredentialFreeUrlSchema,
  canonicalUrlSha256: Sha256DigestSchema,
  host: z.string().trim().min(1).max(253).optional(),
  owner: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(160).optional(),
})

const OpaqueRepositoryLocatorSchema = z.strictObject({
  mode: z.literal('opaque'),
  canonicalUrlSha256: Sha256DigestSchema,
})

export const RepositoryLocatorSchema = z.discriminatedUnion('mode', [
  RemoteRepositoryLocatorSchema,
  OpaqueRepositoryLocatorSchema,
])

export const RepositoryIdentityV1Schema = z.strictObject({
  kind: z.literal(REPOSITORY_IDENTITY_KIND),
  version: ContractVersionSchema,
  repositoryId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema,
  vcs: z.literal('git'),
  displayName: z.string().trim().min(1).max(160),
  locator: RepositoryLocatorSchema,
  defaultBranch: z.string().trim().min(1).max(255).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type RepositoryLocatorV1 = z.infer<typeof RepositoryLocatorSchema>
export type RepositoryIdentityV1 = z.infer<typeof RepositoryIdentityV1Schema>
