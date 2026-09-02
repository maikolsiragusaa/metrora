import type {
  AdvisorAnswer,
  AdvisorBenchRun,
  AdvisorCoverage,
  AdvisorEvidence,
  AdvisorEvidenceRef,
  AdvisorJsonObject,
  AdvisorJsonValue,
  AdvisorPerformanceEvidence,
  AdvisorPresentationBlockV1,
  AdvisorPresentationIntent,
  AdvisorScope,
  AdvisorSynthesisBlockV1,
  AdvisorSynthesisDraftV1,
  AdvisorSynthesisNarrativeV1,
  AdvisorVerifiedClaimAtomV1,
} from './types'
import {
  ADVISOR_REDACTION as REDACTION,
  boundedAdvisorText,
  sanitizeAdvisorDisplayText,
  sanitizeAdvisorNarrative,
} from './privacy-text'

export {
  ADVISOR_ANSWER_TEXT_MAX_BYTES,
  ADVISOR_CONTENT_MINIMAL_TEXT_MAX_LENGTH,
  ADVISOR_MODEL_NARRATIVE_MAX_BYTES,
  boundedAdvisorText,
  containsAdvisorContributionLanguage,
  containsAdvisorForbiddenOutputClass,
  containsAdvisorSensitiveText,
  sanitizeAdvisorDisplayText,
  sanitizeAdvisorGroundedNarrative,
  sanitizeAdvisorModelOutput,
  sanitizeAdvisorNarrative,
} from './privacy-text'

const CONTENT_MINIMAL_EVIDENCE_SOURCES = ['overview', 'history', 'models', 'quota', 'bench'] as const
const CONTENT_MINIMAL_PROVIDER_NAMES = ['all', 'claude', 'codex', 'copilot', 'kimi', 'antigravity'] as const
const SAFE_ANSWER_EVIDENCE_ID_PATTERN = /^(?:spend|quota|spend-(?:claude|codex)|overview\.(?:current|history\.daily|models|projects|sessions|modelAccounting)|models\.report|quota\.(?:claude|codex|copilot|kimi|antigravity)|bench\.(?:latest|history|comparison)|bench\.performance\.(?:latest|history|comparison))$/u
const CLAIM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/u

function contentMinimalSource(value: unknown): typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_EVIDENCE_SOURCES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_EVIDENCE_SOURCES[number] : null
}
function contentMinimalProvider(value: unknown): typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] | null {
  return typeof value === 'string' && (CONTENT_MINIMAL_PROVIDER_NAMES as readonly string[]).includes(value) ? value as typeof CONTENT_MINIMAL_PROVIDER_NAMES[number] : null
}
function contentMinimalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export function contentMinimalScope(scope: AdvisorScope): AdvisorScope {
  return {
    period: scope.period,
    range: scope.range ? { from: scope.range.from, to: scope.range.to } : null,
    provider: contentMinimalProvider(scope.provider) ?? '[provider]',
    // Raw internal Project/account identities are not model-facing evidence.
    projectId: scope.projectId === 'all' ? 'all' : '[scoped-project]',
    projectName: sanitizeAdvisorDisplayText(scope.projectName),
    model: scope.model === null ? null : sanitizeAdvisorDisplayText(scope.model),
  }
}

export function contentMinimalCoverage(coverage: AdvisorCoverage): AdvisorCoverage {
  return {
    level: coverage.level,
    label: sanitizeAdvisorDisplayText(coverage.label),
    detail: sanitizeAdvisorDisplayText(coverage.detail),
    ...(coverage.state ? { state: coverage.state } : {}),
  }
}

function safeBenchIdentifier(value: string, digest = false): string {
  const pattern = digest ? /^[0-9a-f]{64}$/u : /^[A-Za-z0-9._:/-]{1,200}$/u
  return pattern.test(value) ? value : REDACTION
}

function contentMinimalBenchRun(run: AdvisorBenchRun): AdvisorJsonObject {
  return {
    runId: safeBenchIdentifier(run.runId),
    pack: { id: safeBenchIdentifier(run.pack.id), version: safeBenchIdentifier(run.pack.version), digest: safeBenchIdentifier(run.pack.digest, true) },
    scorer: { id: safeBenchIdentifier(run.scorer.id), version: safeBenchIdentifier(run.scorer.version) },
    runner: { id: safeBenchIdentifier(run.runner.id), version: safeBenchIdentifier(run.runner.version) },
    runtime: { id: safeBenchIdentifier(run.runtime.id), version: safeBenchIdentifier(run.runtime.version) },
    model: { selected: safeBenchIdentifier(run.model.selected), reported: run.model.reported === null ? null : safeBenchIdentifier(run.model.reported) },
    generationPolicy: safeBenchIdentifier(run.generationPolicy),
    status: run.status,
    aggregate: run.aggregate,
    tasks: run.tasks.slice(0, 64).map(task => ({
      taskId: safeBenchIdentifier(task.taskId),
      status: task.status,
      score: task.score,
      requestLatencyMs: task.requestLatencyMs,
      timeToFirstContentMs: task.timeToFirstContentMs,
    })),
    resultDigest: safeBenchIdentifier(run.resultDigest, true),
  }
}

function safePerformanceText(value: string | null): string | null {
  return value === null ? null : sanitizeAdvisorDisplayText(value)
}

function contentMinimalPerformanceRun(run: import('./types').AdvisorPerformanceEvidence['runs'][number]): AdvisorJsonObject {
  return {
    schemaVersion: run.schemaVersion,
    runId: safeBenchIdentifier(run.runId),
    runner: { id: safeBenchIdentifier(run.runner.id), version: safeBenchIdentifier(run.runner.version) },
    methodology: {
      id: safeBenchIdentifier(run.methodology.id),
      version: safeBenchIdentifier(run.methodology.version),
      setup: run.methodology.setup,
      argvDigest: safeBenchIdentifier(run.methodology.argvDigest, true),
    },
    model: {
      selected: sanitizeAdvisorDisplayText(run.model.selected),
      reported: safePerformanceText(run.model.reported),
      type: safePerformanceText(run.model.type),
      sizeBytes: typeof run.model.sizeBytes === 'number' && Number.isFinite(run.model.sizeBytes) ? run.model.sizeBytes : null,
      parameterCount: typeof run.model.parameterCount === 'number' && Number.isFinite(run.model.parameterCount) ? run.model.parameterCount : null,
    },
    executable: { name: sanitizeAdvisorDisplayText(run.executable.name) },
    runtime: {
      id: safeBenchIdentifier(run.runtime.id),
      buildCommit: safePerformanceText(run.runtime.buildCommit),
      buildNumber: typeof run.runtime.buildNumber === 'number' && Number.isFinite(run.runtime.buildNumber) ? run.runtime.buildNumber : null,
      version: safePerformanceText(run.runtime.version),
      backends: run.runtime.backends.slice(0, 16).map(value => sanitizeAdvisorDisplayText(value)),
    },
    // Hardware and process-environment strings are retained in the local
    // Bench record for comparison, but are deliberately not model-facing:
    // native executable output can contain machine/user identifiers.
    startedAt: contentMinimalTimestamp(run.startedAt) ?? REDACTION,
    endedAt: contentMinimalTimestamp(run.endedAt) ?? REDACTION,
    status: run.status,
    termination: { status: run.termination.status },
    failure: run.failure === null ? null : { code: sanitizeAdvisorDisplayText(run.failure.code), message: sanitizeAdvisorDisplayText(run.failure.message) },
    observedConfiguration: run.observedConfiguration,
    workloads: run.workloads.slice(0, 16).map(workload => ({
      workload: workload.workload,
      promptTokens: workload.promptTokens,
      generationTokens: workload.generationTokens,
      depth: workload.depth,
      repetitions: workload.repetitions,
      throughputTokensPerSecond: workload.throughputTokensPerSecond,
      throughputStddevTokensPerSecond: workload.throughputStddevTokensPerSecond,
      averageTimeNs: workload.averageTimeNs,
      averageLatencyMs: workload.averageLatencyMs,
      testTime: workload.testTime,
    })),
    resultDigest: safeBenchIdentifier(run.resultDigest, true),
  }
}

function contentMinimalPerformanceComparison(value: import('./types').AdvisorPerformanceEvidence['comparison']): AdvisorJsonValue {
  if (!value) return null
  const identity = (item: typeof value.left): AdvisorJsonObject => ({
    runId: safeBenchIdentifier(item.runId),
    model: sanitizeAdvisorDisplayText(item.model),
    modelType: safePerformanceText(item.modelType),
    executable: sanitizeAdvisorDisplayText(item.executable),
    endedAt: contentMinimalTimestamp(item.endedAt) ?? REDACTION,
    runtime: {
      id: safeBenchIdentifier(item.runtime.id),
      buildCommit: safePerformanceText(item.runtime.buildCommit),
      buildNumber: typeof item.runtime.buildNumber === 'number' && Number.isFinite(item.runtime.buildNumber) ? item.runtime.buildNumber : null,
      version: safePerformanceText(item.runtime.version),
      backends: item.runtime.backends.slice(0, 16).map(entry => sanitizeAdvisorDisplayText(entry)),
    },
    environment: {
      os: sanitizeAdvisorDisplayText(item.environment.os),
      arch: sanitizeAdvisorDisplayText(item.environment.arch),
      node: sanitizeAdvisorDisplayText(item.environment.node),
    },
    setup: item.setup,
    observedConfiguration: item.observedConfiguration,
  })
  return {
    schemaVersion: value.schemaVersion,
    compatible: value.compatible,
    reason: value.reason,
    left: identity(value.left),
    right: identity(value.right),
    deltas: value.deltas,
  }
}

export function contentMinimalEvidenceRefs(refs: AdvisorEvidenceRef[], options: { preserveIds?: boolean } = {}): AdvisorEvidenceRef[] {
  return refs.flatMap((ref, index) => {
    const source = contentMinimalSource(ref.source)
    if (!source) return []
    return [{
      // Evidence IDs are internal correlation keys. A stable local ordinal is
      // sufficient for the model and avoids exposing provider/account IDs.
      id: options.preserveIds && SAFE_ANSWER_EVIDENCE_ID_PATTERN.test(ref.id) ? ref.id : 'evidence-' + (index + 1),
      label: sanitizeAdvisorDisplayText(ref.label),
      source,
    }]
  })
}

export function sanitizeAdvisorAnswer(answer: AdvisorAnswer): AdvisorAnswer {
  const coverage = contentMinimalCoverage(answer.coverage)
  const safeText = (value: string) => boundedAdvisorText(sanitizeAdvisorDisplayText(value, Number.MAX_SAFE_INTEGER))
  const evidenceIdMap = new Map<string, string>()
  const evidence = answer.evidence.flatMap((ref, index) => {
    const source = contentMinimalSource(ref.source)
    if (!source) return []
    const candidate = sanitizeAdvisorDisplayText(ref.id, 64)
    const id = SAFE_ANSWER_EVIDENCE_ID_PATTERN.test(candidate) ? candidate : 'evidence-' + (index + 1)
    evidenceIdMap.set(ref.id, id)
    return [{ id, label: sanitizeAdvisorDisplayText(ref.label), source }]
  })
  const safeEvidenceRefs = (refs: AdvisorEvidenceRef[]): AdvisorEvidenceRef[] => refs.flatMap(ref => {
    const id = evidenceIdMap.get(ref.id) ?? (evidence.some(item => item.id === ref.id) ? ref.id : null)
    const source = contentMinimalSource(ref.source)
    return id && source ? [{ id, label: sanitizeAdvisorDisplayText(ref.label), source }] : []
  })
  const safeJsonValue = (value: AdvisorJsonValue, depth = 0): AdvisorJsonValue => {
    if (depth > 4) return null
    if (typeof value === 'string') return safeText(value)
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
    if (Array.isArray(value)) return value.slice(0, 32).map(item => safeJsonValue(item, depth + 1))
    return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, child]) => [sanitizeAdvisorDisplayText(key, 80), safeJsonValue(child, depth + 1)]))
  }
  const claimKinds = ['measured_total', 'observed_count', 'provider_quota_remaining', 'provider_quota_reset', 'model_identity', 'model_measured_cost', 'project_measured_cost', 'session_measured_cost', 'trend_direction', 'coverage_state', 'freshness_state', 'bench_score', 'bench_status', 'bench_comparability', 'bench_performance_throughput', 'bench_performance_latency', 'bench_performance_status', 'bench_performance_comparability'] as const
  const safeClaims = (claims: AdvisorVerifiedClaimAtomV1[] | undefined): AdvisorVerifiedClaimAtomV1[] | undefined => {
    if (!claims) return undefined
    return claims.flatMap(claim => {
      if (claim.contractVersion !== 'advisor-verified-claim-atom-v1' || claim.schemaVersion !== 1 || claim.operator !== 'equals' || !claimKinds.includes(claim.claimKind) || !CLAIM_ID_PATTERN.test(claim.id)) return []
      const evidenceRef = evidenceIdMap.get(claim.evidenceRef) ?? claim.evidenceRef
      if (!evidence.some(item => item.id === evidenceRef)) return []
      const scoreDenominator = typeof claim.scoreDenominator === 'number' && Number.isSafeInteger(claim.scoreDenominator) && claim.scoreDenominator > 0 && claim.scoreDenominator <= 64 ? claim.scoreDenominator : undefined
      return [{
        ...claim,
        value: safeJsonValue(claim.value),
        subject: claim.subject === null ? null : safeText(claim.subject),
        unit: claim.unit === null ? null : safeText(claim.unit),
        evidenceRef,
        evidencePath: /^[A-Za-z][A-Za-z0-9_.-]{0,160}$/u.test(claim.evidencePath) ? claim.evidencePath : 'invalid-path',
        scope: contentMinimalScope(claim.scope),
        scoreDenominator,
      }]
    }).slice(0, 24)
  }
  const safeClaimSelections = (claims: AdvisorSynthesisDraftV1['claims'] | undefined): AdvisorSynthesisDraftV1['claims'] | undefined => claims
    ? claims.flatMap(claim => CLAIM_ID_PATTERN.test(claim.id) ? [{ contractVersion: 'advisor-claim-selection-v1' as const, schemaVersion: 1 as const, id: claim.id }] : []).slice(0, 24)
    : undefined
  const presentationKinds: readonly AdvisorPresentationIntent[] = ['text', 'metric-cards', 'line-chart', 'bar-chart', 'comparison-table', 'quota-card', 'bench-summary', 'warning', 'evidence-disclosure']
  const safePresentation = (blocks: AdvisorPresentationBlockV1[] | undefined): AdvisorPresentationBlockV1[] | undefined => blocks ? blocks.flatMap((block): AdvisorPresentationBlockV1[] => {
    if (!presentationKinds.includes(block.kind)) return []
    if (block.kind === 'text') return [{ ...block, text: safeText(block.text), claimIds: block.claimIds.slice(0, 24) }]
    if (block.kind === 'metric-cards') return [{ ...block, title: safeText(block.title), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), cards: block.cards.slice(0, 8).map(card => ({ ...card, label: safeText(card.label), value: safeText(card.value), unit: safeText(card.unit), detail: safeText(card.detail), claimIds: card.claimIds.slice(0, 24) })) }]
    if (block.kind === 'line-chart' || block.kind === 'bar-chart') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), unit: safeText(block.unit), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), accessibilityLabel: safeText(block.accessibilityLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), series: block.series.slice(0, 8).map(series => ({ ...series, id: safeText(series.id), label: safeText(series.label), points: series.points.slice(-30).map(point => ({ label: safeText(point.label), value: point.value === null || Number.isFinite(point.value) ? point.value : null })) })) }]
    if (block.kind === 'comparison-table') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), table: { columns: block.table.columns.slice(0, 12).map(safeText), rows: block.table.rows.slice(0, 32).map(row => row.slice(0, 12).map(safeText)) } }]
    if (block.kind === 'quota-card') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), providers: block.providers.slice(0, 8).map(provider => ({ ...provider, planLabel: provider.planLabel === null ? null : safeText(provider.planLabel), observedAt: provider.observedAt === null ? null : safeText(provider.observedAt), windows: provider.windows.slice(0, 8).map((window, index) => ({ ...window, id: 'window-' + (index + 1), label: safeText(window.label), resetsAt: window.resetsAt === null ? null : safeText(window.resetsAt) })) })) }]
    if (block.kind === 'bench-summary') return [{ ...block, title: safeText(block.title), summary: safeText(block.summary), scopeLabel: safeText(block.scopeLabel), periodLabel: safeText(block.periodLabel), evidenceRefs: safeEvidenceRefs(block.evidenceRefs), run: block.run === null ? null : contentMinimalBenchRun(block.run) as unknown as AdvisorBenchRun, ...(block.performance ? { performance: { state: block.performance.state, latest: block.performance.latest === null ? null : contentMinimalPerformanceRun(block.performance.latest), runs: block.performance.runs.slice(0, 10).map(contentMinimalPerformanceRun), comparison: contentMinimalPerformanceComparison(block.performance.comparison) } as unknown as AdvisorPerformanceEvidence } : {}) }]
    if (block.kind === 'warning' || block.kind === 'evidence-disclosure') return [{ ...block, title: safeText(block.title), text: safeText(block.text), evidenceRefs: safeEvidenceRefs(block.evidenceRefs) }]
    return []
  }) : undefined
  const claims = safeClaims(answer.claims)
  const synthesisClaims = safeClaimSelections(answer.synthesis?.claims)
  const safeSynthesisBlock = (block: AdvisorSynthesisBlockV1): AdvisorSynthesisBlockV1 => ({
    claimIds: block.claimIds.slice(0, 24),
    ...(block.emphasis ? { emphasis: block.emphasis } : {}),
  })
  const safeSynthesisNarrative = (narrative: AdvisorSynthesisNarrativeV1 | undefined): AdvisorSynthesisNarrativeV1 | undefined => {
    if (!narrative) return undefined
    const interpretation = narrative.interpretation ? sanitizeAdvisorNarrative(narrative.interpretation) : ''
    const recommendation = narrative.recommendation ? sanitizeAdvisorNarrative(narrative.recommendation) : ''
    const caveats = (narrative.caveats ?? []).map(item => sanitizeAdvisorNarrative(item)).filter(Boolean).slice(0, 6)
    if (!interpretation && !recommendation && !caveats.length) return undefined
    return {
      ...(interpretation ? { interpretation } : {}),
      ...(recommendation ? { recommendation } : {}),
      ...(caveats.length ? { caveats } : {}),
    }
  }
  const synthesis = answer.synthesis ? {
    ...answer.synthesis,
    conclusion: safeSynthesisBlock(answer.synthesis.conclusion),
    why: answer.synthesis.why.map(safeSynthesisBlock).slice(0, 6),
    details: answer.synthesis.details.map(safeSynthesisBlock).slice(0, 12),
    claims: synthesisClaims ?? [],
    presentationRequests: answer.synthesis.presentationRequests.filter(request => presentationKinds.includes(request.kind)).slice(0, 8).map(request => ({ ...request, ...(request.title ? { title: safeText(request.title) } : {}), ...(request.evidenceRefs ? { evidenceRefs: request.evidenceRefs.map(ref => evidenceIdMap.get(ref) ?? ref).filter(ref => evidence.some(item => item.id === ref)) } : {}) })),
    ...(answer.synthesis.expertDetail ? { expertDetail: answer.synthesis.expertDetail.map(safeText).slice(0, 8) } : {}),
    ...(safeSynthesisNarrative(answer.synthesis.narrative) ? { narrative: safeSynthesisNarrative(answer.synthesis.narrative) } : {}),
  } : undefined
  return {
    ...answer,
    conclusion: safeText(answer.conclusion),
    scopeLabel: safeText(answer.scopeLabel),
    periodLabel: safeText(answer.periodLabel),
    evidence,
    coverage,
    assumptions: answer.assumptions.map(safeText),
    unknown: answer.unknown.map(safeText),
    nextInvestigations: answer.nextInvestigations.map(safeText),
    details: answer.details.map(safeText),
    why: (answer.why ?? []).map(safeText),
    materialLimits: (answer.materialLimits ?? []).map(safeText),
    understanding: answer.understanding ? {
      ...answer.understanding,
      summary: safeText(answer.understanding.summary),
      clarification: answer.understanding.clarification === null ? null : safeText(answer.understanding.clarification),
      boundary: answer.understanding.boundary === null ? null : safeText(answer.understanding.boundary),
    } : undefined,
    plan: answer.plan ? {
      ...answer.plan,
      clarification: answer.plan.clarification === null ? null : safeText(answer.plan.clarification),
      requestedEvidenceDomains: answer.plan.requestedEvidenceDomains.slice(0, 16),
    } : undefined,
    actionProposal: answer.actionProposal ? {
      ...answer.actionProposal,
      summary: safeText(answer.actionProposal.summary),
      target: safeText(answer.actionProposal.target),
      scope: contentMinimalScope(answer.actionProposal.scope),
      permissions: answer.actionProposal.permissions.map(safeText).slice(0, 8),
      allowedReadTools: answer.actionProposal.allowedReadTools.slice(0, 8),
    } : undefined,
    claims,
    synthesis,
    presentation: safePresentation(answer.presentation),
  }
}

/** Explicitly allowlisted model-facing evidence projection. */
export function contentMinimalEvidence(evidence: AdvisorEvidence, options: { preserveEvidenceIds?: boolean; modelFacing?: boolean } = {}): AdvisorJsonObject {
  const spend = evidence.spend
    ? {
        measuredCostUSD: evidence.spend.measuredCostUSD,
        calls: evidence.spend.calls,
        sessions: evidence.spend.sessions,
        inputTokens: evidence.spend.inputTokens ?? null,
        outputTokens: evidence.spend.outputTokens ?? null,
        cacheReadTokens: evidence.spend.cacheReadTokens ?? null,
        cacheWriteTokens: evidence.spend.cacheWriteTokens ?? null,
        pricingCoverage: evidence.spend.pricingCoverage,
        models: evidence.spend.models.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        projects: evidence.spend.projects.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        sessionsByCost: evidence.spend.sessionsByCost.map(row => ({ name: sanitizeAdvisorDisplayText(row.name), costUSD: row.costUSD, calls: row.calls })),
        trend: evidence.spend.trend
          ? {
              direction: evidence.spend.trend.direction,
              latestCostUSD: evidence.spend.trend.latestCostUSD,
              comparisonCostUSD: evidence.spend.trend.comparisonCostUSD,
              deltaUSD: evidence.spend.trend.deltaUSD,
              deltaPercent: evidence.spend.trend.deltaPercent,
              latestDate: evidence.spend.trend.latestDate,
              comparisonLabel: sanitizeAdvisorDisplayText(evidence.spend.trend.comparisonLabel),
            }
            : null,
        history: evidence.spend.history.slice(-30).map(point => ({
          date: contentMinimalTimestamp(point.date) ?? sanitizeAdvisorDisplayText(point.date),
          costUSD: point.costUSD,
          calls: point.calls,
          inputTokens: point.inputTokens,
          outputTokens: point.outputTokens,
          cacheReadTokens: point.cacheReadTokens,
          cacheWriteTokens: point.cacheWriteTokens,
        })),
        modelHistory: evidence.spend.modelHistory.slice(0, 8).map(series => ({
          model: sanitizeAdvisorDisplayText(series.model),
          points: series.points.slice(-30).map(point => ({ date: sanitizeAdvisorDisplayText(point.date), costUSD: point.costUSD, calls: point.calls })),
        })),
      }
    : null
  const modelEfficiency = evidence.modelEfficiency
    ? {
        selectedModel: evidence.modelEfficiency.selectedModel === null ? null : sanitizeAdvisorDisplayText(evidence.modelEfficiency.selectedModel),
        comparableWorkWarning: evidence.modelEfficiency.comparableWorkWarning,
        rows: evidence.modelEfficiency.rows.map(row => ({
          model: sanitizeAdvisorDisplayText(row.model),
          provider: contentMinimalProvider(row.provider) ?? '[provider]',
          calls: row.calls,
          costUSD: row.costUSD,
          inputTokens: row.inputTokens ?? null,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens ?? null,
          cacheReadTokens: row.cacheReadTokens ?? null,
          cacheWriteTokens: row.cacheWriteTokens ?? null,
          reasoningTokens: row.reasoningTokens ?? null,
          additiveReasoningTokens: row.additiveReasoningTokens ?? null,
          costPerCallUSD: row.costPerCallUSD,
          pricingState: row.pricingState,
        })),
      }
    : null
  const quota = evidence.quota
    ? {
        measuredSpendUSD: evidence.quota.measuredSpendUSD,
        measuredCalls: evidence.quota.measuredCalls,
        providers: evidence.quota.providers.filter(provider => contentMinimalProvider(provider.provider) !== null).map(provider => ({
          provider: contentMinimalProvider(provider.provider)!,
          planLabel: provider.planLabel === null ? null : sanitizeAdvisorDisplayText(provider.planLabel),
          availability: provider.availability,
          connection: provider.connection,
          freshness: provider.freshness,
          observedAt: contentMinimalTimestamp(provider.observedAt),
          windows: provider.windows.map(window => ({
            label: sanitizeAdvisorDisplayText(window.label),
            usedPercent: window.usedPercent,
            remainingPercent: window.remainingPercent,
            resetsAt: contentMinimalTimestamp(window.resetsAt),
          })),
          creditsUSD: provider.creditsUSD,
        })),
      }
    : null
  const bench = evidence.bench
    ? {
        state: evidence.bench.state,
        latest: evidence.bench.latest === null ? null : contentMinimalBenchRun(evidence.bench.latest),
        runs: evidence.bench.runs.slice(0, 10).map(contentMinimalBenchRun),
        comparison: evidence.bench.comparison === null ? null : { ...evidence.bench.comparison, comparedRunIds: evidence.bench.comparison.comparedRunIds.map(value => safeBenchIdentifier(value)) },
        performance: evidence.bench.performance
          ? {
              state: evidence.bench.performance.state,
              latest: evidence.bench.performance.latest === null ? null : contentMinimalPerformanceRun(evidence.bench.performance.latest),
              runs: evidence.bench.performance.runs.slice(0, 10).map(contentMinimalPerformanceRun),
              comparison: contentMinimalPerformanceComparison(evidence.bench.performance.comparison),
            }
          : null,
      }
    : null
  const minimalScope = contentMinimalScope(evidence.scope)
  const modelScope = options.modelFacing
    ? {
        period: minimalScope.period,
        range: minimalScope.range,
        provider: minimalScope.provider,
        project: minimalScope.projectName,
        model: minimalScope.model,
      }
    : minimalScope
  return {
    intent: evidence.intent,
    scope: modelScope,
    coverage: contentMinimalCoverage(evidence.coverage),
    refs: contentMinimalEvidenceRefs(evidence.refs, { preserveIds: options.preserveEvidenceIds }),
    spend,
    modelEfficiency,
    quota,
    bench,
    assumptions: evidence.assumptions.map(value => sanitizeAdvisorDisplayText(value)),
    unknown: evidence.unknown.map(value => sanitizeAdvisorDisplayText(value)),
    nextInvestigations: evidence.nextInvestigations.map(value => sanitizeAdvisorDisplayText(value)),
    domainCoverage: (evidence.domainCoverage ?? []).map(item => ({
      domain: item.domain,
      state: item.state,
      detail: sanitizeAdvisorDisplayText(item.detail),
      evidenceRefs: contentMinimalEvidenceRefs(item.evidenceRefs),
    })),
  }
}
