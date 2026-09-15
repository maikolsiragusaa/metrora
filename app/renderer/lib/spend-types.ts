export type ProjectSpendProjection = {
  name: string
  cost: number
  savingsUSD: number
  sessions: number
  calls?: number
  avgCostPerSession: number
  dailySpend?: Array<{ date: string; cost: number }>
  sessionDetails?: Array<{
    cost: number
    savingsUSD: number
    calls: number
    inputTokens: number
    outputTokens: number
    date: string
    models: Array<{ name: string; cost: number; savingsUSD: number }>
  }>
}
