import type { AdvisorCoverageLevel, AdvisorEvidence } from './types'

export function sameEvidenceScope(left: AdvisorEvidence['scope'], right: AdvisorEvidence['scope']): boolean {
  return left.period === right.period
    && left.provider === right.provider
    && left.projectId === right.projectId
    && left.projectName === right.projectName
    && left.model === right.model
    && left.range?.from === right.range?.from
    && left.range?.to === right.range?.to
}

export function hasMixedEvidenceScopes(items: AdvisorEvidence[]): boolean {
  return items.length > 1 && items.some(item => !sameEvidenceScope(item.scope, items[0]!.scope))
}

export function mergeEvidence(items: AdvisorEvidence[], fallback: AdvisorEvidence): AdvisorEvidence {
  if (hasMixedEvidenceScopes(items)) {
    return {
      intent: 'unknown',
      question: fallback.question,
      scope: fallback.scope,
      refs: [],
      coverage: { level: 'unavailable', label: 'Conflicting evidence scopes', detail: 'Tool evidence from different scopes was rejected instead of being combined.' },
      assumptions: [],
      unknown: ['The local model requested evidence from different scopes; no cross-scope facts were combined.'],
      nextInvestigations: ['Repeat the investigation with one explicit period, Project, provider, and model scope.'],
    }
  }
  const last = items[items.length - 1]!
  const usable = items.filter(item => item.coverage.level !== 'unavailable')
  const level: AdvisorCoverageLevel = items.length > 0 && items.every(item => item.coverage.level === 'high')
    ? 'high'
    : usable.length
      ? 'partial'
      : 'unavailable'
  const coverage = level === 'high'
    ? { level: 'high' as const, label: 'High coverage', detail: 'All requested evidence tools returned usable canonical records.' }
    : level === 'partial'
      ? { level: 'partial' as const, label: 'Partial coverage', detail: 'Some requested evidence is usable; other dimensions remain limited or unavailable.' }
      : { level: 'unavailable' as const, label: 'Unavailable', detail: 'The requested canonical evidence was not available.' }
  const unique = <T>(values: T[]) => Array.from(new Set(values))
  const refs = Array.from(new Map(items.flatMap(item => item.refs).map(ref => [ref.id + '|' + ref.label, ref])).values())
  const spendRows = items.flatMap(item => item.spend ? [item.spend] : [])
  const modelRows = items.flatMap(item => item.modelEfficiency ? [item.modelEfficiency] : [])
  const quotaRows = items.flatMap(item => item.quota ? [item.quota] : [])
  const spend = spendRows[0] ? {
    ...spendRows[0],
    models: unique(spendRows.flatMap(item => item.models.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.models).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    projects: unique(spendRows.flatMap(item => item.projects.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.projects).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
    sessionsByCost: unique(spendRows.flatMap(item => item.sessionsByCost.map(row => row.name + '|' + row.calls + '|' + row.costUSD)).map(key => spendRows.flatMap(item => item.sessionsByCost).find(row => row.name + '|' + row.calls + '|' + row.costUSD === key)!)),
  } : undefined
  const modelEfficiency = modelRows[0] ? {
    ...modelRows[modelRows.length - 1],
    rows: unique(modelRows.flatMap(item => item.rows.map(row => row.provider + '|' + row.model)).map(key => modelRows.flatMap(item => item.rows).find(row => row.provider + '|' + row.model === key)!)),
    comparableWorkWarning: modelRows.some(item => item.comparableWorkWarning),
  } : undefined
  const quota = quotaRows[0] ? {
    ...quotaRows[quotaRows.length - 1],
    providers: unique(quotaRows.flatMap(item => item.providers.map(row => row.provider)).map(provider => quotaRows.flatMap(item => item.providers).find(row => row.provider === provider)!)),
  } : undefined
  return {
    ...last,
    refs,
    coverage,
    assumptions: unique(items.flatMap(item => item.assumptions)),
    unknown: unique(items.flatMap(item => item.unknown)),
    nextInvestigations: unique(items.flatMap(item => item.nextInvestigations)),
    ...(modelEfficiency ? { modelEfficiency } : {}),
    ...(quota ? { quota } : {}),
    ...(spend ? {
      spend: {
        ...spend,
        history: spendRows.flatMap(item => item.history).slice(-30),
        modelHistory: spendRows.flatMap(item => item.modelHistory).slice(-8),
      },
    } : {}),
    domainCoverage: Array.from(new Map(items.flatMap(item => item.domainCoverage ?? []).map(item => [item.domain, item])).values()),
  }
}
