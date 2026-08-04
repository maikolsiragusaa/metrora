import type { YieldJsonReport } from '../lib/types'

export type CostPerOutcomeDerivation = {
  costPerCommit: number | null
  costPerProductiveSession: number | null
  productivePercent: number
  revertedPercent: number
  abandonedPercent: number
}

export function deriveCostPerOutcome(report: YieldJsonReport): CostPerOutcomeDerivation {
  const commits = report.details.reduce((sum, detail) => sum + detail.commitCount, 0)
  const productive = report.summary.productive
  return {
    costPerCommit: commits > 0 ? report.summary.total.costUSD / commits : null,
    costPerProductiveSession: productive.sessions > 0 ? productive.costUSD / productive.sessions : null,
    productivePercent: productive.costPercent,
    revertedPercent: report.summary.reverted.costPercent,
    abandonedPercent: report.summary.abandoned.costPercent,
  }
}
