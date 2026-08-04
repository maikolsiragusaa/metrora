import type { MenubarPayload } from '../lib/types'

export type EfficiencyGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
export type EfficiencyTone = 'grade-a' | 'grade-bc' | 'grade-d' | 'grade-f'

export type EfficiencyDerivation = {
  oneShot: number
  cacheFraction: number
  retrySpendFraction: number
  retryPenalty: number
  score: number
  grade: EfficiencyGrade
  gradeTone: EfficiencyTone
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function efficiencyGrade(score: number): EfficiencyGrade {
  if (score >= 93) return 'A+'
  if (score >= 85) return 'A'
  if (score >= 75) return 'B'
  if (score >= 65) return 'C'
  if (score >= 55) return 'D'
  return 'F'
}

export function deriveEfficiency(current: MenubarPayload['current']): EfficiencyDerivation {
  const oneShot = current.oneShotRate ?? 0.6
  const cacheFraction = clamp(current.cacheHitPercent / 100, 0, 1)
  const retrySpendFraction = current.retryTax.totalUSD / Math.max(current.cost, 1e-9)
  const retryPenalty = clamp(retrySpendFraction * 4, 0, 1)
  const score = 100 * (0.45 * oneShot + 0.30 * cacheFraction + 0.25 * (1 - retryPenalty))
  const grade = efficiencyGrade(score)
  const gradeTone: EfficiencyTone = grade === 'A+' || grade === 'A'
    ? 'grade-a'
    : grade === 'D'
      ? 'grade-d'
      : grade === 'F'
        ? 'grade-f'
        : 'grade-bc'

  return { oneShot, cacheFraction, retrySpendFraction, retryPenalty, score, grade, gradeTone }
}
