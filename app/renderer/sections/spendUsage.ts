import { formatCompact } from '../lib/format'
import type { MenubarPayload } from '../lib/types'
import { observedTokenTotal } from '../lib/usageMetrics'

export type SpendTokenEvidenceState = 'available' | 'partial' | 'unavailable'

export type SpendTokenKpi = {
  value: string
  detail: string
  state: SpendTokenEvidenceState
}

const INCOMPLETE_TOKEN_DATA = 'Incomplete token data'
const NO_TOKEN_EVIDENCE = 'No token evidence reported'

/**
 * Whether the payload carries any known primary-counter counts: evidenced
 * detail rows, or positive counters (which can only come from records that
 * reported numbers). Mirrors the Overview counter-evidence reading.
 */
function hasKnownTokenCounts(current: MenubarPayload['current']): boolean {
  if (current.modelAccounting?.rows.some(row => row.tokenDetail)) return true
  return current.inputTokens > 0 || current.outputTokens > 0 || current.cacheReadTokens > 0 || current.cacheWriteTokens > 0
}

/**
 * M1 counter-evidence semantics, shared with the Overview usage details: a
 * reported zero is complete evidence, never a gap; mixed sets (complete
 * records alongside unevidenced ones) keep their known counts with the
 * incompleteness attached; only a genuinely evidence-free scope renders as
 * unavailable. Payloads without `usageEvidence` keep the legacy reading.
 */
function tokenEvidenceState(current: MenubarPayload['current']): SpendTokenEvidenceState {
  const evidence = current.usageEvidence
  if (evidence) {
    if (evidence === 'complete') return 'available'
    if (evidence === 'partial' || hasKnownTokenCounts(current)) return 'partial'
    return 'unavailable'
  }
  const hasLegacyEvidence =
    current.calls === 0 ||
    current.inputTokens > 0 ||
    current.outputTokens > 0 ||
    current.cacheReadTokens > 0 ||
    current.cacheWriteTokens > 0 ||
    (current.modelAccounting?.rows.some(row => row.tokenDetail) ?? false)
  return hasLegacyEvidence ? 'available' : 'unavailable'
}

/**
 * Metered-token KPI for the Spend surfaces. Known quantities are shown with
 * an incompleteness note when evidence is partial; an evidence-free scope
 * renders unavailable instead of a false zero.
 */
export function meteredTokenKpi(current: MenubarPayload['current'], baseDetail: string): SpendTokenKpi {
  const state = tokenEvidenceState(current)
  if (state === 'unavailable') {
    return { value: '—', detail: `${baseDetail} · ${NO_TOKEN_EVIDENCE}`, state }
  }
  const value = formatCompact(observedTokenTotal(current))
  if (state === 'partial') {
    return { value, detail: `${baseDetail} · ${INCOMPLETE_TOKEN_DATA}`, state }
  }
  return { value, detail: baseDetail, state }
}
