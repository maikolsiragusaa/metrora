import { getDateRange } from '../cli-date.js'
import { renderStatusBar } from '../format.js'
import {
  readC3CliStatusBatchV1,
} from './canonical-history-cli-dual-read.js'

export { observeC3CliStatusDualReadV1 } from './canonical-history-cli-dual-read.js'

export async function readC3TerminalStatusLineV1(provider: string, expectedGenerationId?: string): Promise<string | undefined> {
  try {
    const results = await readC3CliStatusBatchV1([
      { id: 'today', range: getDateRange('today').range, provider },
      { id: 'month', range: getDateRange('month').range, provider },
    ], { expectedGenerationId })
    if (!results.every(result => result.code === 'C3_SUPPORTED_MATCH' && result.c3 !== undefined)) return undefined
    return renderStatusBar([], {
      today: { cost: results[0]!.c3!.cost, calls: results[0]!.c3!.calls },
      month: { cost: results[1]!.c3!.cost, calls: results[1]!.c3!.calls },
    })
  } catch {
    return undefined
  }
}
