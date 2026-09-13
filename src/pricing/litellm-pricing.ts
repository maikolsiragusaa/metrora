import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import { fetchWithTimeout } from '../fetch-utils.js'
import { buildCosts, safePerTokenRate, type ModelCosts } from './model-costs.js'

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
// How long a failed fetch suppresses retries. Every CLI spawn is a new process,
// so without this marker each one re-pays the full network timeout while offline.
const FAILURE_MARKER_TTL_MS = 5 * 60 * 1000
const CACHE_FILE = 'litellm-pricing.json'
const FAILURE_MARKER_FILE = 'litellm-pricing.failed.json'

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

  const markerPath = join(cacheDir, FAILURE_MARKER_FILE)
  if (await isRecentFailure(markerPath)) return null

  try {
    return await fetchAndCachePricing(cacheDir, cachePath)
  } catch {
    await markFailure(markerPath)
    return null
  }
}

async function isRecentFailure(markerPath: string): Promise<boolean> {
  try {
    const raw = await readFile(markerPath, 'utf-8')
    const marker = JSON.parse(raw) as { timestamp?: number }
    return typeof marker.timestamp === 'number' && Date.now() - marker.timestamp < FAILURE_MARKER_TTL_MS
  } catch {
    return false
  }
}

async function markFailure(markerPath: string): Promise<void> {
  try {
    await mkdir(dirname(markerPath), { recursive: true })
    const tmpPath = `${markerPath}.tmp`
    await writeFile(tmpPath, JSON.stringify({ timestamp: Date.now() }))
    await rename(tmpPath, markerPath)
  } catch {
    // Best-effort: without a marker the next spawn simply retries the network.
  }
}
