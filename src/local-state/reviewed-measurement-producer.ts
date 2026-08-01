import { createHash } from 'node:crypto'

import type { ParsedApiCall } from '../types.js'
import {
  createReviewedUsageMeasurementEventV1,
  type ReviewedUsageMeasurementEventContextV1,
  type ReviewedUsageMeasurementEventResultV1,
} from '../contracts/v1/reviewed-event-factory.js'
import {
  enqueueMeasurementEventV1,
  type LocalMeasurementOutboxRecordV1,
} from './measurement-outbox.js'
import type { LoadedLocalEndpointIdentityV1 } from './endpoint-identity.js'
import { loadLocalPersonalWorkspaceV1 } from './local-workspace.js'

export type LocalReviewedMeasurementContextV1 = Omit<
  ReviewedUsageMeasurementEventContextV1,
  'workspaceId' | 'endpointId' | 'eventIdentityKey'
>

export type ProduceLocalReviewedMeasurementV1Options = {
  identity: LoadedLocalEndpointIdentityV1
  call: ParsedApiCall
  context: LocalReviewedMeasurementContextV1
  dataDir?: string
  now?: () => Date
}

export type ProduceLocalReviewedMeasurementV1Result =
  | Extract<ReviewedUsageMeasurementEventResultV1, { status: 'withheld' }>
  | {
      status: 'enqueued' | 'duplicate'
      profileId: string
      record: LocalMeasurementOutboxRecordV1
    }

export class LocalWorkspaceRequiredError extends Error {
  constructor(message = 'a local personal workspace must be created before producing reviewed measurements') {
    super(message)
    this.name = 'LocalWorkspaceRequiredError'
  }
}

function productionKeySha256(input: {
  workspaceId: string
  endpointId: string
  profileId: string
  sourceFingerprintSha256: string
  privateDeduplicationKey: string
}): string {
  if (input.privateDeduplicationKey.length === 0) {
    throw new Error('reviewed measurement source deduplication key must not be empty')
  }
  return createHash('sha256')
    .update('metrora-reviewed-production-v1\0')
    .update(input.workspaceId)
    .update('\0')
    .update(input.endpointId)
    .update('\0')
    .update(input.profileId)
    .update('\0')
    .update(input.sourceFingerprintSha256)
    .update('\0')
    .update(input.privateDeduplicationKey)
    .digest('hex')
}

/**
 * Explicitly project one already-normalized call through the reviewed evidence
 * boundary and into the durable local outbox.
 *
 * This function deliberately does not scan providers, infer source context,
 * create a workspace, choose a sharing policy, sign a batch, or use a network.
 * The caller must supply the reviewed source/tool/provider/session context.
 */
export async function produceLocalReviewedMeasurementV1(
  input: ProduceLocalReviewedMeasurementV1Options,
): Promise<ProduceLocalReviewedMeasurementV1Result> {
  const workspace = await loadLocalPersonalWorkspaceV1({
    endpointIdentity: input.identity.metadata,
    ...(input.dataDir !== undefined ? { dataDir: input.dataDir } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
  if (!workspace) throw new LocalWorkspaceRequiredError()

  const projected = createReviewedUsageMeasurementEventV1(
    input.call,
    {
      ...input.context,
      workspaceId: workspace.workspace.workspaceId,
      endpointId: workspace.endpoint.endpointId,
      eventIdentityKey: input.identity.eventIdentityKey,
    },
    { costEvidenceMode: 'immutable-assignment' },
  )
  if (projected.status === 'withheld') return projected

  const outbox = await enqueueMeasurementEventV1(projected.event, {
    productionKeySha256: productionKeySha256({
      workspaceId: workspace.workspace.workspaceId,
      endpointId: workspace.endpoint.endpointId,
      profileId: projected.profileId,
      sourceFingerprintSha256: input.context.collector.sourceFingerprintSha256,
      privateDeduplicationKey: input.call.deduplicationKey,
    }),
    ...(input.dataDir !== undefined ? { dataDir: input.dataDir } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
  return {
    status: outbox.status,
    profileId: projected.profileId,
    record: outbox.record,
  }
}
