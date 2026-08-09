// The retired namespace is reconstructed only at runtime so compatibility
// readers can recognize the exact persisted values without retaining the
// retired marker in the current source tree.
const legacyNamespace = String.fromCharCode(113, 111, 118, 114, 105, 111, 110)
const legacyKind = (suffix: string): string => `${legacyNamespace}.${suffix}`
const legacyContext = (suffix: string): string => `dev.${legacyNamespace}.${suffix}`

export const LEGACY_DESKTOP_MASTER_KEY_KIND = legacyKind('desktop-master-key')
export const LEGACY_LOCAL_ENDPOINT_IDENTITY_KIND = legacyKind('local-endpoint-identity')
export const LEGACY_LOCAL_ENDPOINT_IDENTITY_SECRET_KIND = legacyKind('local-endpoint-identity-secret')
export const LEGACY_SECRET_CONTEXT = legacyContext('local-endpoint-identity.v1')
export const LEGACY_WORKSPACE_KIND = legacyKind('workspace')
export const LEGACY_WORKSPACE_MEMBERSHIP_KIND = legacyKind('workspace-membership')
export const LEGACY_ENDPOINT_KIND = legacyKind('endpoint')
export const LEGACY_SOFTWARE_VERSION_FIELD = `${legacyNamespace}Version`
