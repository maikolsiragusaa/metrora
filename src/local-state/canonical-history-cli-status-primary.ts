import { performance } from 'node:perf_hooks'

import { renderStatusBar } from '../format.js'
import type { DurablePeriod } from '../usage-aggregator.js'
import { observeC3CliStatusDualReadV1 } from './canonical-history-cli-primary.js'
import type { C3CliStatusDualReadResultV1 } from './canonical-history-cli-dual-read.js'

function headline(value: DurablePeriod['data']) {
  return {
    cost: value.cost,
    calls: value.calls,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheWriteTokens: value.cacheWriteTokens,
  }
}

function report(
  today: DurablePeriod,
  month: DurablePeriod,
  generationId: string | undefined,
  dualRead: readonly C3CliStatusDualReadResultV1[],
  statusLine: string | undefined,
  headlineReadMs: number,
): void {
  if (process.env.METRORA_VERBOSE !== '1') return
  process.stderr.write(`${JSON.stringify({
    kind: 'metrora-c3-analytics-lifecycle-v1',
    legacy: { today: headline(today.data), month: headline(month.data) },
    c3: { today: dualRead[0]?.c3, month: dualRead[1]?.c3 },
    generationId,
    publication: { today: today.canonicalPublication, month: month.canonicalPublication },
    dualRead: dualRead.map(result => ({ id: result.id, code: result.code, reason: result.reason })),
    primary: statusLine === undefined ? 'LEGACY_FALLBACK' : 'C3_PRIMARY',
    performance: {
      legacyRefreshMs: { today: today.legacyRefreshMs, month: month.legacyRefreshMs },
      c3PublicationMs: { today: today.canonicalPublication.timingsMs, month: month.canonicalPublication.timingsMs },
      headlineReadMs,
    },
  })}\n`)
}

function renderC3TerminalStatusLineV1(
  dualRead: readonly C3CliStatusDualReadResultV1[],
): string | undefined {
  if (dualRead.length !== 2 || !dualRead.every(result => result.code === 'C3_SUPPORTED_MATCH' && result.c3 !== undefined)) return undefined
  const today = dualRead.find(result => result.id === 'today')?.c3
  const month = dualRead.find(result => result.id === 'month')?.c3
  if (!today || !month) return undefined
  return renderStatusBar([], {
    today: { cost: today.cost, calls: today.calls },
    month: { cost: month.cost, calls: month.calls },
  })
}

export async function readC3TerminalStatusForDurablePeriodsV1(
  provider: string,
  project: readonly string[],
  exclude: readonly string[],
  today: DurablePeriod,
  month: DurablePeriod,
): Promise<string | undefined> {
  const generationId = today.canonicalPublication.status === 'published'
    && month.canonicalPublication.status === 'published'
    && today.canonicalPublication.generation?.id === month.canonicalPublication.generation?.id
    ? month.canonicalPublication.generation?.id
    : undefined
  if (generationId === undefined) {
    report(today, month, generationId, [], undefined, 0)
    return undefined
  }
  const startedAt = performance.now()
  const dualRead = await observeC3CliStatusDualReadV1(provider, project, exclude, today.data, month.data, generationId)
  const headlineReadMs = performance.now() - startedAt
  if (dualRead.length !== 2 || !dualRead.every(result => result.code === 'C3_SUPPORTED_MATCH')) {
    report(today, month, generationId, dualRead, undefined, headlineReadMs)
    return undefined
  }
  const statusLine = renderC3TerminalStatusLineV1(dualRead)
  report(today, month, generationId, dualRead, statusLine, headlineReadMs)
  return statusLine
}
