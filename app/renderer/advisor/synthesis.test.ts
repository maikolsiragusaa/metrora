import { describe, expect, it } from 'vitest'

import { buildSpendEvidence } from './evidence'
import { buildAdvisorVerifiedClaimAtoms, renderAdvisorVerifiedSynthesis, renderAdvisorVerifiedClaimAtom, verifyAdvisorVerifiedClaimAtom } from './claim-atoms'
import { createAdvisorConformanceFixture } from './conformance'
import { isAdvisorNaturalNarrativeSupported, parseAdvisorSynthesisDraft, verifyAdvisorSynthesis } from './synthesis'
import { buildBenchEvidence } from './special-evidence'
import type { AdvisorBenchRun, AdvisorEvidence, AdvisorScope, AdvisorVerifiedClaimAtomV1 } from './types'

const scope: AdvisorScope = {
  period: 'week',
  range: null,
  provider: 'all',
  projectId: 'all',
  projectName: 'All projects',
  model: null,
}

function parsedDraft(options: {
  claims?: string[]
  conclusionClaimIds?: string[]
  whyClaimIds?: string[][]
  detailsClaimIds?: string[][]
  conclusion?: Record<string, unknown>
  narrative?: Record<string, unknown>
} = {}) {
  return parseAdvisorSynthesisDraft(JSON.stringify({
    contractVersion: 'advisor-synthesis-draft-v1',
    schemaVersion: 1,
    conclusion: options.conclusion ?? { claimIds: options.conclusionClaimIds ?? ['measured-total-cost'] },
    why: (options.whyClaimIds ?? [['observed-calls']]).map(claimIds => ({ claimIds })),
    details: (options.detailsClaimIds ?? [['observed-sessions']]).map(claimIds => ({ claimIds })),
    claims: (options.claims ?? ['measured-total-cost', 'observed-calls', 'observed-sessions']).map(id => ({ id })),
    presentationRequests: [],
    ...(options.narrative ? { narrative: options.narrative } : {}),
  }))
}

function renderableAtom(overrides: Partial<AdvisorVerifiedClaimAtomV1> = {}): AdvisorVerifiedClaimAtomV1 {
  return {
    contractVersion: 'advisor-verified-claim-atom-v1',
    schemaVersion: 1,
    id: 'presentation-test',
    claimKind: 'coverage_state',
    subject: null,
    metric: 'coverage',
    value: 'high',
    unit: null,
    operator: 'equals',
    evidenceRef: 'overview.current',
    evidencePath: 'coverage.level',
    scope,
    ...overrides,
  }
}

describe('Advisor typed verified claim atoms', () => {
  const fixture = createAdvisorConformanceFixture()
  const evidence = buildSpendEvidence('What changed in spend?', scope, fixture.overview)

  it('rejects a material block with no selected claim atom', () => {
    const draft = parsedDraft({ claims: [], conclusionClaimIds: [], whyClaimIds: [[]], detailsClaimIds: [[]] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(false)
  })

  it('rejects a block that points at an atom that was not selected', () => {
    const draft = parsedDraft({ detailsClaimIds: [['missing-atom']] })
    expect(draft).not.toBeNull()
    expect(verifyAdvisorSynthesis(draft!, evidence).reason).toContain('unselected claim atom')
  })

  it('rejects legacy or arbitrary factual block prose before verification', () => {
    expect(parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: { text: 'Metrora measured $12 and Claude caused the increase.', claimIds: ['measured-total-cost'] },
      why: [],
      details: [],
      claims: [{ id: 'measured-total-cost' }],
      presentationRequests: [],
    }))).toBeNull()
  })

  it.each(['Claude is the cheapest model.', 'Claude is more efficient.'])('does not accept true model identity as unsupported semantic prose: %s', text => {
    const draft = parseAdvisorSynthesisDraft(JSON.stringify({
      contractVersion: 'advisor-synthesis-draft-v1',
      schemaVersion: 1,
      conclusion: { text, claimIds: ['model-identity-0'] },
      why: [],
      details: [],
      claims: [{ id: 'model-identity-0' }],
      presentationRequests: [],
    }))
    expect(draft).toBeNull()
  })

  it('rejects a claim-kind/path mismatch even when the value is real', () => {
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'model-identity-0')!
    expect(verifyAdvisorVerifiedClaimAtom({ ...atom, claimKind: 'model_measured_cost', metric: 'cost', evidencePath: 'spend.models.0.costUSD', value: atom.value }, evidence)).toBe(false)
  })

  it('keeps Project calls as calls and rejects the old sessions alias', () => {
    const atoms = buildAdvisorVerifiedClaimAtoms(evidence)
    const atom = atoms.find(item => item.id === 'project-observed-calls-0')!
    expect(atom).toMatchObject({
      claimKind: 'observed_count',
      metric: 'calls',
      unit: 'calls',
      value: 2,
      evidencePath: 'spend.projects.0.calls',
    })
    expect(atoms.filter(item => item.claimKind === 'observed_count' && item.evidencePath.endsWith('.calls')).every(item => item.metric === 'calls' && item.unit === 'calls')).toBe(true)
    expect(verifyAdvisorVerifiedClaimAtom(atom, evidence)).toBe(true)
    expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).toContain('calls')
    expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).toContain('chiamate')
    expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).not.toContain('sessions')
    expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).not.toContain('sessioni')
    expect(verifyAdvisorVerifiedClaimAtom({ ...atom, metric: 'sessions', unit: 'sessions' }, evidence)).toBe(false)
  })

  it('rejects an evidence reference that does not own the typed path', () => {
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'measured-total-cost')!
    expect(verifyAdvisorVerifiedClaimAtom({ ...atom, evidenceRef: 'overview.projects' }, evidence)).toBe(false)
  })

  it('verifies and renders a measured-cost atom without model-authored factual prose', () => {
    const draft = parsedDraft({ claims: ['model-measured-cost-0'], conclusionClaimIds: ['model-measured-cost-0'], whyClaimIds: [], detailsClaimIds: [] })
    const atom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'model-measured-cost-0')!
    expect(verifyAdvisorSynthesis(draft!, evidence).valid).toBe(true)
    expect(verifyAdvisorVerifiedClaimAtom(atom, evidence)).toBe(true)
    expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).toContain('Observed spend for gpt-safe')
    expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).toContain('spesa osservata')
  })

  it('renders multiple verified atoms in the model-selected order', () => {
    const draft = parsedDraft({
      claims: ['model-measured-cost-1', 'model-measured-cost-0'],
      conclusionClaimIds: ['model-measured-cost-1', 'model-measured-cost-0'],
      whyClaimIds: [],
      detailsClaimIds: [],
    })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(verification.claims.map(atom => atom.id)).toEqual(['model-measured-cost-1', 'model-measured-cost-0'])
    const rendered = renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'Which model cost more?')
    expect(rendered.conclusion.indexOf('local-safe')).toBeLessThan(rendered.conclusion.indexOf('gpt-safe'))
  })

  it('retains verified facts while dropping ungrounded contribution narrative', () => {
    const draft = parsedDraft({
      claims: ['measured-total-cost'],
      conclusionClaimIds: ['measured-total-cost'],
      whyClaimIds: [],
      detailsClaimIds: [],
      narrative: { interpretation: 'Project Z is an observed contributor in the spend breakdown.' },
    })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(verification.narrative).toBeUndefined()
    expect(verification.claims.map(atom => atom.id)).toEqual(['measured-total-cost'])
  })

  it('accepts grounded descriptive contributors but rejects unsupported identity, rank, and causality', () => {
    expect(isAdvisorNaturalNarrativeSupported('Project A is an observed contributor in the spend breakdown.', evidence)).toBe(true)
    expect(isAdvisorNaturalNarrativeSupported('Project Z is a contributor in the spend breakdown.', evidence)).toBe(false)
    expect(isAdvisorNaturalNarrativeSupported('Project A is the top contributor in the spend breakdown.', evidence)).toBe(false)
    expect(isAdvisorNaturalNarrativeSupported('gpt-safe is the top contributor in the model spend breakdown.', evidence)).toBe(true)
    expect(isAdvisorNaturalNarrativeSupported('Project A caused the spend increase.', evidence)).toBe(false)
  })

  it('keeps bounded interpretation and recommendation separate from typed facts', () => {
    const draft = parsedDraft({
      claims: ['measured-total-cost'],
      conclusionClaimIds: ['measured-total-cost'],
      whyClaimIds: [],
      detailsClaimIds: [],
      narrative: {
        interpretation: 'This is meaningful relative to the available evidence.',
        recommendation: 'Review the provider breakdown before changing your setup.',
      },
    })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(verification.narrative?.interpretation).toContain('meaningful')
    const rendered = renderAdvisorVerifiedSynthesis({ ...draft!, narrative: verification.narrative }, verification.claims, 'Is this a lot?')
    expect(rendered.conclusion).toContain('Metrora measured $12.00')
    expect(rendered.conclusion).toContain('meaningful')
    expect(rendered.conclusion).toContain('Review the provider breakdown')
  })

  it('renders the canonical measured total in both supported languages', () => {
    const draft = parsedDraft({ claims: ['measured-total-cost'], conclusionClaimIds: ['measured-total-cost'], whyClaimIds: [], detailsClaimIds: [] })
    const verification = verifyAdvisorSynthesis(draft!, evidence)
    expect(verification.valid).toBe(true)
    expect(renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'What changed in spend?').conclusion).toContain('Metrora measured')
    expect(renderAdvisorVerifiedSynthesis(draft!, verification.claims, 'Quanto ho speso?').conclusion).toContain('Hai speso')
  })

  it('keeps the scored-check denominator in the verified Bench score claim', () => {
    const run: AdvisorBenchRun = {
      runId: 'bench-run',
      pack: { id: 'metrora.bench.core', version: '1.0.0', digest: 'a'.repeat(64) },
      scorer: { id: 'metrora.bench-scoring', version: '1' },
      runner: { id: 'ollama-task-pack-v1', version: '1.0.0' },
      runtime: { id: 'ollama-local', version: '0.12.6' },
      model: { selected: 'qwen3:8b', reported: 'qwen3:8b' },
      generationPolicy: 'one-bounded-request-per-task-temperature-0-seed-1729-numPredict-64',
      status: 'completed',
      aggregate: { planned: 6, attempted: 6, passed: 5, failed: 1, unavailable: 0, cancelled: 0, scoreNumerator: 5, scoreDenominator: 6, scoreValue: 5 / 6 },
      tasks: [],
      resultDigest: 'b'.repeat(64),
    }
    const evidence = buildBenchEvidence('What happened in the Bench?', scope, { state: 'AVAILABLE', runs: [run], latest: run, comparison: null })
    const scoreAtom = buildAdvisorVerifiedClaimAtoms(evidence).find(item => item.id === 'bench-score')!
    expect(scoreAtom.scoreDenominator).toBe(6)
    expect(verifyAdvisorVerifiedClaimAtom(scoreAtom, evidence)).toBe(true)
    expect(renderAdvisorVerifiedClaimAtom(scoreAtom, 'en')).toContain('83% of 6 scored checks')
    expect(renderAdvisorVerifiedClaimAtom(scoreAtom, 'it')).toContain('83% su 6 controlli valutati')
  })

  it('renders supported factual enums through closed EN/IT presentation labels', () => {
    const cases: Array<{ atom: Partial<AdvisorVerifiedClaimAtomV1>; raw: string; en: string; it: string }> = [
      { atom: { claimKind: 'coverage_state', metric: 'coverage', value: 'high' }, raw: 'high', en: 'high', it: 'elevata' },
      { atom: { claimKind: 'coverage_state', metric: 'coverage', value: 'partial' }, raw: 'partial', en: 'partial', it: 'parziale' },
      { atom: { claimKind: 'coverage_state', metric: 'coverage', value: 'unavailable' }, raw: 'unavailable', en: 'unavailable', it: 'non disponibile' },
      { atom: { claimKind: 'freshness_state', metric: 'freshness', value: 'fresh', subject: 'codex', evidencePath: 'quota.providers.0.freshness', evidenceRef: 'quota.codex' }, raw: 'fresh', en: 'up to date', it: 'aggiornata' },
      { atom: { claimKind: 'freshness_state', metric: 'freshness', value: 'stale', subject: 'claude', evidencePath: 'quota.providers.0.freshness', evidenceRef: 'quota.claude' }, raw: 'stale', en: 'not up to date', it: 'non aggiornata' },
      { atom: { claimKind: 'freshness_state', metric: 'freshness', value: 'unavailable', subject: 'claude', evidencePath: 'quota.providers.0.freshness', evidenceRef: 'quota.claude' }, raw: 'unavailable', en: 'unavailable', it: 'non disponibile' },
      { atom: { claimKind: 'bench_status', metric: 'status', value: 'completed', evidencePath: 'bench.latest.status', evidenceRef: 'bench.latest' }, raw: 'completed', en: 'completed', it: 'completato' },
      { atom: { claimKind: 'bench_status', metric: 'status', value: 'unavailable', evidencePath: 'bench.latest.status', evidenceRef: 'bench.latest' }, raw: 'unavailable', en: 'unavailable', it: 'non disponibile' },
      { atom: { claimKind: 'bench_status', metric: 'status', value: 'cancelled', evidencePath: 'bench.latest.status', evidenceRef: 'bench.latest' }, raw: 'cancelled', en: 'cancelled', it: 'annullato' },
      { atom: { claimKind: 'bench_comparability', metric: 'comparability', value: 'compatible', evidencePath: 'bench.comparison.compatibility', evidenceRef: 'bench.comparison' }, raw: 'compatible', en: 'comparable', it: 'comparabile' },
      { atom: { claimKind: 'bench_comparability', metric: 'comparability', value: 'incompatible', evidencePath: 'bench.comparison.compatibility', evidenceRef: 'bench.comparison' }, raw: 'incompatible', en: 'not comparable', it: 'non comparabile' },
    ]
    for (const item of cases) {
      const atom = renderableAtom(item.atom)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).toContain(item.en)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).toContain(item.it)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).not.toContain(item.raw)
    }
  })

  it('uses mainstream provider names and hides unknown enum tokens', () => {
    for (const [subject, label] of [['codex', 'Codex'], ['claude', 'Claude']] as const) {
      const atom = renderableAtom({ claimKind: 'freshness_state', metric: 'freshness', value: 'fresh', subject, evidencePath: 'quota.providers.0.freshness', evidenceRef: 'quota.' + subject })
      expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).toContain(label)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).toContain(label)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'en')).not.toContain(subject)
      expect(renderAdvisorVerifiedClaimAtom(atom, 'it')).not.toContain(subject)
    }
    const unknown = renderableAtom({ value: 'internal-schema-token' })
    expect(renderAdvisorVerifiedClaimAtom(unknown, 'en')).not.toContain('internal-schema-token')
    expect(renderAdvisorVerifiedClaimAtom(unknown, 'it')).not.toContain('internal-schema-token')
  })
})
