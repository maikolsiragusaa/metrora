import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as z from 'zod/v4'

import { defaultMetroraDataDir } from './endpoint-identity.js'
import {
  enqueueMeasurementEventV1,
  LocalMeasurementProductionReceiptV1Schema,
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
  return scan.pending.length + scan.acknowledged.length
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

    let receipt: z.infer<typeof LocalMeasurementProductionReceiptV1Schema>
    try {
      receipt = LocalMeasurementProductionReceiptV1Schema.parse(
        JSON.parse(await readFile(join(productionDir, file), 'utf8')),
      )
    } catch {
      throw new MeasurementProductionRecoveryIntegrityError(
        'local production receipt could not be validated',
      )
    }

    if (file !== `${receipt.productionKeySha256}.json`) {
      throw new MeasurementProductionRecoveryIntegrityError(
        'local production receipt does not match its private index key',
      )
    }

    receiptCount += 1
    try {
      // The existing enqueue path re-reads and fully validates the private
      // receipt, including event and semantic digests, before publishing a
      // missing immutable outbox record.
      await enqueueMeasurementEventV1(receipt.record.event, {
        dataDir,
        productionKeySha256: receipt.productionKeySha256,
        ...(options.now !== undefined ? { now: options.now } : {}),
      })
    } catch {
      throw new MeasurementProductionRecoveryIntegrityError(
        'local production receipt conflicts with canonical evidence',
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
