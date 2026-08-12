import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { fetchWithTimeout } from '../fetch-utils.js'
import { buildCosts, safePerTokenRate, type ModelCosts } from './model-costs.js'

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = 'litellm-pricing.json'

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeFastMultiplier(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

function parseLiteLLMEntry(entry: unknown): ModelCosts | null {
  if (!isJsonObject(entry)) return null

  const inputCost = safePerTokenRate(entry['input_cost_per_token'])
  const outputCost = safePerTokenRate(entry['output_cost_per_token'])
  if (inputCost === null || outputCost === null) return null

  const providerSpecificEntry = isJsonObject(entry['provider_specific_entry'])
    ? entry['provider_specific_entry']
    : undefined
  return buildCosts(
    inputCost,
    outputCost,
    safePerTokenRate(entry['cache_creation_input_token_cost']),
    safePerTokenRate(entry['cache_read_input_token_cost']),
    safeFastMultiplier(providerSpecificEntry?.['fast']),
  )
}

async function fetchAndCachePricing(cacheDir: string, cachePath: string): Promise<Map<string, ModelCosts>> {
  // Bounded: the menubar shells out and blocks on this path. A half-open
  // network after wake-from-sleep must not wedge its loading spinner.
  const response = await fetchWithTimeout(LITELLM_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as unknown
  const data = isJsonObject(payload) ? payload : {}
  const pricing = new Map<string, ModelCosts>()

  for (const [name, entry] of Object.entries(data)) {
    const costs = parseLiteLLMEntry(entry)
    if (!costs) continue
    pricing.set(name, costs)
    // Also index by stripped name so lookups work without provider prefix.
    // First write wins so direct-provider entries take precedence.
    const stripped = name.replace(/^[^/]+\//, '')
    if (stripped !== name && !pricing.has(stripped)) pricing.set(stripped, costs)
  }

  await mkdir(cacheDir, { recursive: true })
  await writeFile(cachePath, JSON.stringify({
    timestamp: Date.now(),
    data: Object.fromEntries(pricing),
  }))

  return pricing
}

async function loadCachedPricing(cachePath: string): Promise<Map<string, ModelCosts> | null> {
  try {
    const raw = await readFile(cachePath, 'utf-8')
    const cached = JSON.parse(raw) as { timestamp: number; data: Record<string, ModelCosts> }
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null
    return new Map(Object.entries(cached.data))
  } catch {
    return null
  }
}

/** Load the remote/cache layer without owning Metrora's active pricing table. */
export async function loadRemotePricing(cacheDir: string): Promise<Map<string, ModelCosts> | null> {
  const cachePath = join(cacheDir, CACHE_FILE)
  const cached = await loadCachedPricing(cachePath)
  if (cached) return cached

  try {
    return await fetchAndCachePricing(cacheDir, cachePath)
  } catch {
    return null
  }
}
