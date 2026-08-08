import * as z from 'zod/v4'

import { CollectorProvenanceProfilesV1 } from '../contracts/v1/collector-provenance.js'

export const COLLECTOR_INVENTORY_KIND = 'metrora.collector-inventory' as const

export const CollectorLoadingModeV1Schema = z.enum(['core', 'lazy'])
export const CollectorReviewStatusV1Schema = z.enum(['approved', 'priority', 'pending'])
export const CollectorShareEligibilityV1Schema = z.enum(['approved', 'withheld'])
export const CollectorAutomatedEvidenceV1Schema = z.enum([
  'parser-fixture-parity',
  'focused-tests',
  'unassessed',
])
export const CollectorManualValidationV1Schema = z.enum([
  'not-blocking',
  'required-before-share',
])

export const CollectorInventoryEntryV1Schema = z.strictObject({
  provider: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  modulePath: z.string().regex(/^src\/providers\/[a-z0-9-]+\.ts$/),
  loading: CollectorLoadingModeV1Schema,
  documentationPath: z.string().regex(/^docs\/providers\/[a-z0-9-]+\.md$/).nullable(),
  sourceFamily: z.string().min(1).max(80),
  reviewWave: z.number().int().min(0).max(3),
  reviewStatus: CollectorReviewStatusV1Schema,
  shareEligibility: CollectorShareEligibilityV1Schema,
  automatedEvidence: CollectorAutomatedEvidenceV1Schema,
  manualValidation: CollectorManualValidationV1Schema,
  provenanceProfileIds: z.array(z.string().min(1).max(120)).max(4),
})

export const CollectorInventoryV1Schema = z.strictObject({
  kind: z.literal(COLLECTOR_INVENTORY_KIND),
  version: z.literal(1),
  entries: z.array(CollectorInventoryEntryV1Schema).length(39),
})

export type CollectorInventoryEntryV1 = z.infer<typeof CollectorInventoryEntryV1Schema>
export type CollectorInventoryV1 = z.infer<typeof CollectorInventoryV1Schema>

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as object)) deepFreeze(child)
  return Object.freeze(value)
}

type EntryInput = z.input<typeof CollectorInventoryEntryV1Schema>

function entry(input: EntryInput): CollectorInventoryEntryV1 {
  return CollectorInventoryEntryV1Schema.parse(input)
}

const approved = (
  provider: string,
  modulePath: string,
  documentationPath: string,
  loading: 'core' | 'lazy',
  sourceFamily: string,
  provenanceProfileIds: string[],
): CollectorInventoryEntryV1 => entry({
  provider,
  modulePath,
  loading,
  documentationPath,
  sourceFamily,
  reviewWave: 0,
  reviewStatus: 'approved',
  shareEligibility: 'approved',
  automatedEvidence: 'parser-fixture-parity',
  manualValidation: 'not-blocking',
  provenanceProfileIds,
})

const priority = (
  provider: string,
  modulePath: string,
  documentationPath: string,
  loading: 'core' | 'lazy',
  sourceFamily: string,
  reviewWave: 1 | 2,
): CollectorInventoryEntryV1 => entry({
  provider,
  modulePath,
  loading,
  documentationPath,
  sourceFamily,
  reviewWave,
  reviewStatus: 'priority',
  shareEligibility: 'withheld',
  automatedEvidence: 'focused-tests',
  manualValidation: 'required-before-share',
  provenanceProfileIds: [],
})

const pending = (
  provider: string,
  modulePath: string,
  documentationPath: string | null,
  loading: 'core' | 'lazy',
): CollectorInventoryEntryV1 => entry({
  provider,
  modulePath,
  loading,
  documentationPath,
  sourceFamily: 'unassessed',
  reviewWave: 3,
  reviewStatus: 'pending',
  shareEligibility: 'withheld',
  automatedEvidence: 'unassessed',
  manualValidation: 'required-before-share',
  provenanceProfileIds: [],
})

const entries = [
  approved('claude', 'src/providers/claude.ts', 'docs/providers/claude.md', 'core', 'jsonl-and-desktop-session-files', ['claude-jsonl-usage-v1']),
  approved('codex', 'src/providers/codex.ts', 'docs/providers/codex.md', 'core', 'rollout-jsonl', ['codex-rollout-token-count-v1', 'codex-rollout-content-fallback-v1']),
  approved('gemini', 'src/providers/gemini.ts', 'docs/providers/gemini.md', 'core', 'session-json-or-jsonl-message-usage', ['gemini-message-usage-v1']),
  approved('zed', 'src/providers/zed.ts', 'docs/providers/zed.md', 'lazy', 'sqlite-zstd-json', ['zed-request-token-usage-v1', 'zed-cumulative-remainder-v1']),

  priority('antigravity', 'src/providers/antigravity.ts', 'docs/providers/antigravity.md', 'lazy', 'protobuf-rpc-cache-and-statusline', 1),
  priority('copilot', 'src/providers/copilot.ts', 'docs/providers/copilot.md', 'core', 'otel-sqlite-and-legacy-multi-store', 1),
  priority('opencode', 'src/providers/opencode.ts', 'docs/providers/opencode.md', 'lazy', 'sqlite-or-file-storage', 1),

  priority('cursor', 'src/providers/cursor.ts', 'docs/providers/cursor.md', 'lazy', 'sqlite-mixed-measured-estimated', 2),
  priority('kiro', 'src/providers/kiro.ts', 'docs/providers/kiro.md', 'core', 'chat-json-estimated', 2),
  priority('mistral-vibe', 'src/providers/mistral-vibe.ts', 'docs/providers/mistral-vibe.md', 'core', 'session-meta-and-jsonl', 2),
  priority('openclaw', 'src/providers/openclaw.ts', 'docs/providers/openclaw.md', 'core', 'agent-jsonl', 2),
  priority('warp', 'src/providers/warp.ts', 'docs/providers/warp.md', 'lazy', 'sqlite-weighted-estimation', 2),

  pending('cline', 'src/providers/cline.ts', 'docs/providers/cline.md', 'core'),
  pending('cline-cli', 'src/providers/cline-cli.ts', 'docs/providers/cline-cli.md', 'core'),
  pending('codebuff', 'src/providers/codebuff.ts', 'docs/providers/codebuff.md', 'core'),
  pending('codewhale', 'src/providers/codewhale.ts', 'docs/providers/codewhale.md', 'core'),
  pending('crush', 'src/providers/crush.ts', 'docs/providers/crush.md', 'lazy'),
  pending('cursor-agent', 'src/providers/cursor-agent.ts', 'docs/providers/cursor-agent.md', 'lazy'),
  pending('devin', 'src/providers/devin.ts', 'docs/providers/devin.md', 'core'),
  pending('droid', 'src/providers/droid.ts', 'docs/providers/droid.md', 'core'),
  pending('forge', 'src/providers/forge.ts', 'docs/providers/forge.md', 'lazy'),
  pending('goose', 'src/providers/goose.ts', 'docs/providers/goose.md', 'lazy'),
  pending('grok', 'src/providers/grok.ts', 'docs/providers/grok.md', 'core'),
  pending('hermes', 'src/providers/hermes.ts', 'docs/providers/hermes.md', 'core'),
  pending('ibm-bob', 'src/providers/ibm-bob.ts', 'docs/providers/ibm-bob.md', 'core'),
  pending('kilo-code', 'src/providers/kilo-code.ts', 'docs/providers/kilo-code.md', 'core'),
  pending('kimi', 'src/providers/kimi.ts', 'docs/providers/kimi.md', 'core'),
  pending('kimicode', 'src/providers/kimicode.ts', 'docs/providers/kimicode.md', 'core'),
  pending('lingtai-tui', 'src/providers/lingtai-tui.ts', 'docs/providers/lingtai-tui.md', 'core'),
  pending('mux', 'src/providers/mux.ts', 'docs/providers/mux.md', 'core'),
  pending('omp', 'src/providers/pi.ts', 'docs/providers/omp.md', 'core'),
  pending('open-design', 'src/providers/open-design.ts', 'docs/providers/open-design.md', 'core'),
  pending('pi', 'src/providers/pi.ts', 'docs/providers/pi.md', 'core'),
  pending('quickdesk', 'src/providers/quickdesk.ts', 'docs/providers/quickdesk.md', 'core'),
  pending('qwen', 'src/providers/qwen.ts', 'docs/providers/qwen.md', 'core'),
  pending('roo-code', 'src/providers/roo-code.ts', 'docs/providers/roo-code.md', 'core'),
  pending('vercel-gateway', 'src/providers/vercel-gateway.ts', 'docs/providers/vercel-gateway.md', 'lazy'),
  pending('zcode', 'src/providers/zcode.ts', 'docs/providers/zcode.md', 'lazy'),
  pending('zerostack', 'src/providers/zerostack.ts', 'docs/providers/zerostack.md', 'core'),
].sort((a, b) => a.provider.localeCompare(b.provider))

export const CollectorInventoryV1 = deepFreeze(CollectorInventoryV1Schema.parse({
  kind: COLLECTOR_INVENTORY_KIND,
  version: 1,
  entries,
}))

export function collectorInventoryEntryV1(provider: string): CollectorInventoryEntryV1 | undefined {
  return CollectorInventoryV1.entries.find(candidate => candidate.provider === provider)
}

export function collectorInventorySummaryV1(): {
  total: number
  approved: number
  priority: number
  pending: number
  documented: number
  documentationGaps: string[]
} {
  const documentationGaps = CollectorInventoryV1.entries
    .filter(candidate => candidate.documentationPath === null)
    .map(candidate => candidate.provider)
  return {
    total: CollectorInventoryV1.entries.length,
    approved: CollectorInventoryV1.entries.filter(candidate => candidate.reviewStatus === 'approved').length,
    priority: CollectorInventoryV1.entries.filter(candidate => candidate.reviewStatus === 'priority').length,
    pending: CollectorInventoryV1.entries.filter(candidate => candidate.reviewStatus === 'pending').length,
    documented: CollectorInventoryV1.entries.filter(candidate => candidate.documentationPath !== null).length,
    documentationGaps,
  }
}

export function reviewedProvenanceProfileIdsV1(): string[] {
  return CollectorProvenanceProfilesV1.map(profile => profile.profileId).sort()
}

function publicEvidenceStatus(item: CollectorInventoryEntryV1): string {
  if (item.shareEligibility === 'approved') return 'signed-approved'
  if (item.automatedEvidence === 'focused-tests') return 'source-documented'
  return 'local-only'
}

export function renderCollectorInventoryMarkdownV1(): string {
  const lines = [
    '# Metrora collector inventory v1',
    '',
    'Status: **local collector coverage inventory; signed sharing remains fail-closed**.',
    '',
    'This file is generated from `CollectorInventoryV1`. Local analysis and signed Workspace eligibility are intentionally separate: a registered collector may remain useful in local reports while its fields are withheld from signed measurements until the concrete source path passes the stricter provenance review.',
    '',
    '## Public status labels',
    '',
    '- **signed-approved:** fixture parity and path-specific provenance profiles authorize the listed source for signed Workspace measurements.',
    '- **source-documented:** the source family and focused behavior are documented, but signed Workspace approval is withheld.',
    '- **local-only:** the operational collector is registered for local analysis while its signed-evidence audit remains incomplete.',
    '',
    'These labels describe current evidence boundaries. They are not a public implementation sequence or priority ranking.',
    '',
    '| Provider | Loading | Source family | Documentation | Local analysis | Evidence | Signed Workspace |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of CollectorInventoryV1.entries) {
    lines.push(`| ${item.provider} | ${item.loading} | ${item.sourceFamily} | ${item.documentationPath ?? 'missing'} | available | ${publicEvidenceStatus(item)} | ${item.shareEligibility} |`)
  }
  const summary = collectorInventorySummaryV1()
  const documentationGaps = summary.documentationGaps.length > 0
    ? summary.documentationGaps.join(', ')
    : 'none'
  lines.push(
    '',
    '## Current totals',
    '',
    `- Registered local collectors: **${summary.total}**.`,
    `- Approved for signed Workspace measurements: **${summary.approved} collectors / ${reviewedProvenanceProfileIdsV1().length} path-specific profiles**.`,
    `- Local collectors with signed sharing withheld: **${summary.total - summary.approved}**.`,
    `- Provider documentation present: **${summary.documented}**.`,
    `- Documentation gaps: **${documentationGaps}**.`,
    '',
    '## Approval gate',
    '',
    'A collector can become signed-approved only when its concrete source path has fixture parity, field-level token/model/session/reasoning/cost provenance, privacy review, pricing reconciliation rules, and manual validation where the source depends on a live IDE, RPC process or mutable database.',
    '',
    'Approval never replaces the inherited parser. It authorizes a narrow, tested projection of that parser output into Metrora signed measurements.',
    '',
  )
  return lines.join('\n')
}
