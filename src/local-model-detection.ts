import {
  getCanonicalName,
  getLocalSavingsBaseline,
  getModelCosts,
  getPriceOverrideExact,
  resolveAlias,
} from './models.js'
import type { ModelCosts } from './pricing/model-costs.js'

/// Heuristic for "this looks like a local model that will never be in LiteLLM's
/// pricing JSON". We suppress the unknown-model warning for these because the
/// "update metrora" advice can't help — local Ollama models, llama.cpp tags,
/// LM Studio loads, etc. are billed locally and don't have public pricing.
/// Users still get $0 in cost reports for them (correct — local inference is
/// effectively free); the warning was just noise.
export function looksLikeLocalModel(name: string): boolean {
  // Bedrock foundation-model ids end in a -[v]<major>:<minor> version
  // (e.g. `anthropic.claude-opus-4-6-v1:0`, `openai.gpt-oss-120b-1:0`). That
  // colon is a version, not an Ollama/LM Studio `:tag`: exempt the shape
  // before the tag rule so a priced Bedrock model is never classed as free
  // local inference (which would drop it from unpriced detection and the
  // pricing-coverage denominator while its spend reads $0).
  const withoutBedrockVersion = name.replace(/-v?\d+:\d+$/, '')
  // Ollama and LM Studio tags include `:tag` (e.g. qwen3.6:35b-a3b-bf16).
  if (withoutBedrockVersion.includes(':') && !withoutBedrockVersion.startsWith('http')) return true
  // GGUF / quantized fingerprints commonly seen in local inference.
  if (/[-_](q[2-8](_[a-z0-9]+)?|bf16|fp16|gguf|f16|f32)$/i.test(name)) return true
  return false
}

/// A free route is usage identity, not a reason to discard the call or apply paid rates.
export const isExplicitFreeModel = (model: string): boolean => /(?:^|[-:])free(?:$|[-:])/i.test(model.trim())

export interface UnpricedModelUsage {
  model: string
  calls: number
  tokens: number
}

function hasBillableRate(costs: ModelCosts): boolean {
  return costs.inputCostPerToken > 0
    || costs.outputCostPerToken > 0
    || costs.cacheWriteCostPerToken > 0
    || costs.cacheReadCostPerToken > 0
}

// Exact-override lookup with the same key derivation getModelCosts uses. Lets
// the unpriced detector distinguish "explicitly declared free by the user" (a
// zero-rate override) from a zero-rate LiteLLM stub, which means "listed but
// unknown price" and must still be flagged. Only the EXACT override form is
// consulted: getModelCosts checks it before any table hit, so when one exists
// it is provably what priced the model. Prefix and case-insensitive overrides
// resolve AFTER table hits and so cannot prove the $0 was intentional; a
// zero-rate stub shadowed by one still gets flagged (the honest direction).
function exactPriceOverrideFor(model: string): ModelCosts | null {
  const withPrefix = model.replace(/@.*$/, '').replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '')
  const canonicalName = getCanonicalName(model)
  const canonical = resolveAlias(canonicalName)
  return getPriceOverrideExact(model, withPrefix, canonicalName, canonical)
}

// Render-time unpriced detection (#638): flag aggregated model rows that carry
// usage but $0 cost AND whose pricing lookup yields no billable rate right
// now. Cost is computed at parse time and cached, so a parse-time registry
// would miss cached sessions; a render-time check covers both and heals the
// moment pricing data, an alias, or a price override arrives.
//
// Rows with cost > 0 are never flagged: aggregation keys rows by DISPLAY name
// (parser.ts keys modelBreakdown via getShortModelName), which the pricing
// lookup misses, so a priced model like "Opus 4.8" would otherwise false-flag.
// $0 display-name rows ARE flagged even when the raw id would price today:
// those tokens really did enter the report at $0 (a provider priced a
// transformed name, or the session was cached before its model's pricing
// landed). Conservative by design: a display key merging priced and unpriced
// raw ids carries cost > 0 and is not flagged. Local-looking models and
// models with a local-savings mapping are excluded because $0 is their
// correct cost, as are zero-rate USER overrides (explicitly declared free).
/// Models whose $0 cost is CORRECT rather than a pricing gap, mirroring the
/// exclusions findUnpricedModels applies: local-looking models, models mapped
/// to a local-savings baseline, and models an exact zero-rate user override
/// declares free. Used to keep their calls out of the pricing-coverage
/// denominator — otherwise a 95%-ollama user reads high coverage while every
/// genuinely cost-bearing call is unpriced.
export function isExpectedFreeModel(model: string): boolean {
  if (isExplicitFreeModel(model)) return true
  if (looksLikeLocalModel(model)) return true
  if (getLocalSavingsBaseline(model)) return true
  const costs = getModelCosts(model)
  if (costs && !hasBillableRate(costs) && exactPriceOverrideFor(model)) return true
  return false
}

/// Evidence strong enough to classify a zero value as intentional at the
/// per-call pricing boundary. A local-savings mapping is deliberately excluded:
/// that mapping is a presentation/accounting overlay whose API-equivalent
/// baseline remains separately priced and may change without rewriting settled
/// history.
export function explicitZeroReasonForModel(model: string): 'free-route' | 'local-inference' | 'manual-reviewed' | undefined {
  if (isExplicitFreeModel(model)) return 'free-route'
  if (looksLikeLocalModel(model)) return 'local-inference'
  const costs = getModelCosts(model)
  if (costs && !hasBillableRate(costs) && exactPriceOverrideFor(model)) return 'manual-reviewed'
  return undefined
}

export function findUnpricedModels(
  rows: Iterable<{ model: string; calls: number; cost: number; tokens?: number }>,
): UnpricedModelUsage[] {
  const out: UnpricedModelUsage[] = []
  for (const row of rows) {
    const { model } = row
    const tokens = row.tokens ?? 0
    if (!model || model === '<synthetic>') continue
    if (row.calls <= 0 && tokens <= 0) continue
    if (row.cost > 0) continue
    if (looksLikeLocalModel(model)) continue
    if (getLocalSavingsBaseline(model)) continue
    const costs = getModelCosts(model)
    if (costs && hasBillableRate(costs)) continue
    if (costs && exactPriceOverrideFor(model)) continue
    out.push({ model, calls: row.calls, tokens })
  }
  return out.sort((a, b) => (b.tokens - a.tokens) || (b.calls - a.calls)
    || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
}
