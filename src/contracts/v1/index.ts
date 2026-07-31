import {
  toJsonSchema202012,
} from './common.js'
import { EndpointV1Schema } from './endpoint.js'
import { UsageEvidenceStatementV1Schema } from './evidence.js'
import { MeasurementBatchV1Schema, UsageMeasurementDataV1Schema, UsageMeasurementEventV1Schema } from './measurement.js'
import { RepositoryIdentityV1Schema } from './repository.js'
import { SharingPolicyV1Schema } from './sharing-policy.js'
import { WorkspaceMembershipV1Schema, WorkspaceV1Schema } from './workspace.js'

export * from './common.js'
export * from './endpoint.js'
export * from './evidence.js'
export * from './measurement-adapter.js'
export * from './measurement.js'
export * from './repository.js'
export * from './sharing-policy.js'
export * from './workspace.js'

export const PublicContractSchemasV1 = {
  workspace: WorkspaceV1Schema,
  workspaceMembership: WorkspaceMembershipV1Schema,
  endpoint: EndpointV1Schema,
  repositoryIdentity: RepositoryIdentityV1Schema,
  sharingPolicy: SharingPolicyV1Schema,
  usageMeasurement: UsageMeasurementDataV1Schema,
  usageMeasurementEvent: UsageMeasurementEventV1Schema,
  measurementBatch: MeasurementBatchV1Schema,
  usageEvidenceStatement: UsageEvidenceStatementV1Schema,
} as const

export const PublicContractJsonSchemasV1 = {
  workspace: toJsonSchema202012(WorkspaceV1Schema, 'workspace'),
  workspaceMembership: toJsonSchema202012(WorkspaceMembershipV1Schema, 'workspace-membership'),
  endpoint: toJsonSchema202012(EndpointV1Schema, 'endpoint'),
  repositoryIdentity: toJsonSchema202012(RepositoryIdentityV1Schema, 'repository-identity'),
  sharingPolicy: toJsonSchema202012(SharingPolicyV1Schema, 'sharing-policy'),
  usageMeasurement: toJsonSchema202012(UsageMeasurementDataV1Schema, 'usage-measurement'),
  usageMeasurementEvent: toJsonSchema202012(UsageMeasurementEventV1Schema, 'usage-measurement-event'),
  measurementBatch: toJsonSchema202012(MeasurementBatchV1Schema, 'measurement-batch'),
  usageEvidenceStatement: toJsonSchema202012(UsageEvidenceStatementV1Schema, 'usage-evidence-statement'),
} as const
