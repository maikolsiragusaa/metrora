import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { defaultMetroraDataDir } from './endpoint-identity.js'
import {
  enqueueMeasurementEventV1,
  readValidatedLocalMeasurementProductionReceiptV1,
  scanMeasurementOutboxV1,
} from './measurement-outbox.js'

const RECEIPT_FILE = /^[a-f0-9]{64}\.json$/

export const MeasurementProductionRecoverySummaryV1Schema = z.strictObject({
  kind: z.literal('metrora.measurement-production-recovery-summary'),
  version: z.literal(1),
  receiptCount: z.number().int().nonnegative(),
  repairedEventCount: z.number().int().nonnegative(),
})

export type MeasurementProductionRecoverySummaryV1 = z.infer<
  typeof MeasurementProductionRecoverySummaryV1Schema
>

export type ReconcileMeasurementProductionReceiptsV1Options = {
  dataDir?: string
  now?: () => Date
}

export class MeasurementProductionRecoveryIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeasurementProductionRecoveryIntegrityError'
  }
}

function eventCount(scan: Awaited<ReturnType<typeof scanMeasurementOutboxV1>>): number {
  return scan.pending.length
    + (scan.legacyPending ?? []).length
    + scan.acknowledged.length
    + (scan.legacyAcknowledged ?? []).length
}

function requireUnblocked(
  scan: Awaited<ReturnType<typeof scanMeasurementOutboxV1>>,
): void {
  if (scan.invalid.length > 0 || scan.quarantined.length > 0) {
    throw new MeasurementProductionRecoveryIntegrityError(
      'local measurement evidence is invalid or quarantined',
    )
  }
}

/**
 * Reconcile private production receipts with the append-only outbox without
 * rescanning canonical usage or creating new evidence.
 *
 * A receipt is written before its public outbox event. If the desktop stops in
 * that narrow interval, this pass validates the existing receipt through the
 * canonical enqueue path and republishes only its original immutable record.
 * It does not depend on the normal post-Workspace production scope, so a
 * receipt left by an interrupted pre-fix historical pass can still be repaired
 * without restarting that historical backfill.
 */
export async function reconcileMeasurementProductionReceiptsV1(
  options: ReconcileMeasurementProductionReceiptsV1Options = {},
): Promise<MeasurementProductionRecoverySummaryV1> {
  const dataDir = options.dataDir ?? defaultMetroraDataDir()
  const before = await scanMeasurementOutboxV1({ dataDir })
  requireUnblocked(before)

  const productionDir = join(dataDir, 'outbox', 'v1', 'production')
  const files = (await readdir(productionDir)).sort()
  let receiptCount = 0

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    if (!RECEIPT_FILE.test(file)) {
      throw new MeasurementProductionRecoveryIntegrityError(
        'local production receipt filename is invalid',
      )
    }

    try {
      const productionKeySha256 = file.slice(0, -'.json'.length)
      const validated = await readValidatedLocalMeasurementProductionReceiptV1(
        dataDir,
        productionKeySha256,
      )
      if (!validated) throw new Error('local production receipt could not be validated')
      receiptCount += 1
      if (validated.legacyRecord) {
        if (!validated.sourcePresent) {
          throw new Error('historical production receipt is missing its immutable outbox event')
        }
        continue
      }
      if (!validated.sourcePresent) {
        // The existing enqueue path re-reads and fully validates the private
        // receipt before publishing the original immutable record.
        await enqueueMeasurementEventV1(validated.receipt.record.event, {
          dataDir,
          productionKeySha256,
          ...(options.now !== undefined ? { now: options.now } : {}),
        })
      }
    } catch {
      throw new MeasurementProductionRecoveryIntegrityError(
        'local production receipt could not be validated',
      )
    }
  }

  const after = await scanMeasurementOutboxV1({ dataDir })
  requireUnblocked(after)
  const repairedEventCount = eventCount(after) - eventCount(before)
  if (repairedEventCount < 0 || repairedEventCount > receiptCount) {
    throw new MeasurementProductionRecoveryIntegrityError(
      'local production receipt reconciliation produced contradictory counts',
    )
  }

  return MeasurementProductionRecoverySummaryV1Schema.parse({
    kind: 'metrora.measurement-production-recovery-summary',
    version: 1,
    receiptCount,
    repairedEventCount,
  })
}
