import { claude } from './claude.js'
import { cline } from './cline.js'
import { clineCli } from './cline-cli.js'
import { codewhale } from './codewhale.js'
import { codebuff } from './codebuff.js'
import { codex } from './codex.js'
import { withCodexModelProvider } from './codex-model-provider.js'
import { copilot } from './copilot.js'
import {
  createCopilotChatJournalProvider,
  withCopilotChatJournalAccounting,
} from './copilot-chat-journal.js'
import {
  createCopilotCliResumeProvider,
  withCopilotCliResumeAccounting,
} from './copilot-cli-resume.js'
import { droid } from './droid.js'
import { devin } from './devin.js'
import { gemini } from './gemini.js'
import { hermes } from './hermes.js'
import { ibmBob } from './ibm-bob.js'
import { kiloCode } from './kilo-code.js'
import { kiro } from './kiro.js'
import { kimi } from './kimi.js'
import { kimicode } from './kimicode.js'
import { lingtaiTui } from './lingtai-tui.js'
import { mistralVibe } from './mistral-vibe.js'
import { mux } from './mux.js'
import { openclaw } from './openclaw.js'
import { openDesign } from './open-design.js'
import { pi, omp } from './pi.js'
import { qwen } from './qwen.js'
import { quickdesk } from './quickdesk.js'
import { rooCode } from './roo-code.js'
import { zerostack } from './zerostack.js'
import { grok } from './grok.js'
import { ensureProviderEnvFingerprintAuthorities } from '../provider-parse-authorities.js'
import type { Provider, SessionSource } from './types.js'
import { discoverCodexSessionPathsForFreshness } from './freshness-discovery.js'
import {
  classifyProviderDiscoveryOutcome,
  PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION,
  providerDiscoveryIsComplete,
  providerDiscoveryProviderOrder,
  type ProviderDiscoveryOutcome,
} from './discovery-outcome.js'

// Install deterministic source/profile env inputs before parser code computes a
// session-cache fingerprint. The installer is idempotent and intentionally does
// not declare Copilot's provider-wide overrides until durable present-path
// carry-forward can preserve pruned OTel history safely.
ensureProviderEnvFingerprintAuthorities()

let antigravityProvider: Provider | null = null
let antigravityLoadAttempted = false
let warpProvider: Provider | null = null
let warpLoadAttempted = false

async function loadAntigravity(): Promise<Provider | null> {
  if (antigravityLoadAttempted) return antigravityProvider
  antigravityLoadAttempted = true
  try {
    const { antigravity } = await import('./antigravity.js')
    antigravityProvider = antigravity
    return antigravity
  } catch {
    return null
  }
}

async function loadWarp(): Promise<Provider | null> {
  if (warpLoadAttempted) return warpProvider
  warpLoadAttempted = true
  try {
    const { warp } = await import('./warp.js')
    warpProvider = warp
    return warp
  } catch {
    return null
  }
}

let forgeProvider: Provider | null = null
let forgeLoadAttempted = false

async function loadForge(): Promise<Provider | null> {
  if (forgeLoadAttempted) return forgeProvider
  forgeLoadAttempted = true
  try {
    const { forge } = await import('./forge.js')
    forgeProvider = forge
    return forge
  } catch {
    return null
  }
}

let gooseProvider: Provider | null = null
let gooseLoadAttempted = false

async function loadGoose(): Promise<Provider | null> {
  if (gooseLoadAttempted) return gooseProvider
  gooseLoadAttempted = true
  try {
    const { goose } = await import('./goose.js')
    gooseProvider = goose
    return goose
  } catch {
    return null
  }
}

let cursorProvider: Provider | null = null
let cursorLoadAttempted = false

async function loadCursor(): Promise<Provider | null> {
  if (cursorLoadAttempted) return cursorProvider
  cursorLoadAttempted = true
  try {
    const { cursor } = await import('./cursor.js')
    cursorProvider = cursor
    return cursor
  } catch {
    return null
  }
}

let opencodeProvider: Provider | null = null
let opencodeLoadAttempted = false

let cursorAgentProvider: Provider | null = null
let cursorAgentLoadAttempted = false

let crushProvider: Provider | null = null
let crushLoadAttempted = false

let vercelGatewayProvider: Provider | null = null
let vercelGatewayLoadAttempted = false

async function loadVercelGateway(): Promise<Provider | null> {
  if (vercelGatewayLoadAttempted) return vercelGatewayProvider
  vercelGatewayLoadAttempted = true
  try {
    const { vercelGateway } = await import('./vercel-gateway.js')
    vercelGatewayProvider = vercelGateway
    return vercelGateway
  } catch {
    return null
  }
}

async function loadOpenCode(): Promise<Provider | null> {
  if (opencodeLoadAttempted) return opencodeProvider
  opencodeLoadAttempted = true
  try {
    const { opencode } = await import('./opencode.js')
    opencodeProvider = opencode
    return opencode
  } catch {
    return null
  }
}

async function loadCursorAgent(): Promise<Provider | null> {
  if (cursorAgentLoadAttempted) return cursorAgentProvider
  cursorAgentLoadAttempted = true
  try {
    const { cursor_agent } = await import('./cursor-agent.js')
    cursorAgentProvider = cursor_agent
    return cursor_agent
  } catch {
    return null
  }
}

async function loadCrush(): Promise<Provider | null> {
  if (crushLoadAttempted) return crushProvider
  crushLoadAttempted = true
  try {
    const { crush } = await import('./crush.js')
    crushProvider = crush
    return crush
  } catch {
    return null
  }
}

let zcodeProvider: Provider | null = null
let zcodeLoadAttempted = false

async function loadZcode(): Promise<Provider | null> {
  if (zcodeLoadAttempted) return zcodeProvider
  zcodeLoadAttempted = true
  try {
    const { zcode } = await import('./zcode.js')
    zcodeProvider = zcode
    return zcode
  } catch {
    return null
  }
}

let zedProvider: Provider | null = null
let zedLoadAttempted = false

async function loadZed(): Promise<Provider | null> {
  if (zedLoadAttempted) return zedProvider
  zedLoadAttempted = true
  try {
    const { zed } = await import('./zed.js')
    zedProvider = zed
    return zed
  } catch {
    return null
  }
}

const copilotWithCliResume = withCopilotCliResumeAccounting(copilot)
const copilotWithChatJournal = withCopilotChatJournalAccounting(copilotWithCliResume)
const internalProviders: Provider[] = [
  createCopilotChatJournalProvider(copilot),
  createCopilotCliResumeProvider(copilot),
]
const coreProviders: Provider[] = [claude, cline, clineCli, codewhale, codebuff, withCodexModelProvider(codex), copilotWithChatJournal, devin, droid, gemini, hermes, ibmBob, kiloCode, kiro, kimi, kimicode, lingtaiTui, mistralVibe, mux, openclaw, openDesign, pi, omp, qwen, quickdesk, rooCode, zerostack, grok]

// Lazily loaded providers, listed by name so --provider validation works even
// when an optional module fails to load. Must stay in sync with getAllProviders.
const lazyProviderNames = ['antigravity', 'forge', 'goose', 'cursor', 'opencode', 'cursor-agent', 'crush', 'warp', 'vercel-gateway', 'zcode', 'zed']

// Canonical set of every provider name (core + lazy), used to validate the
// --provider CLI flag. Internal source-parser namespaces are deliberately
// excluded: discovery remains exposed as the canonical provider (`copilot`).
let allProviderNamesCache: string[] | undefined
export function allProviderNames(): readonly string[] {
  allProviderNamesCache ??= [
    ...coreProviders.map(p => p.name),
    ...lazyProviderNames,
  ].sort()
  return allProviderNamesCache
}

export async function getAllProviders(): Promise<Provider[]> {
  const [ag, forge, gs, cursor, opencode, cursorAgent, crush, warp, vercelGw, zc, zd] = await Promise.all([
    loadAntigravity(), loadForge(), loadGoose(), loadCursor(), loadOpenCode(), loadCursorAgent(), loadCrush(), loadWarp(), loadVercelGateway(), loadZcode(), loadZed(),
  ])
  const all = [...coreProviders]
  if (ag) all.push(ag)
  if (forge) all.push(forge)
  if (gs) all.push(gs)
  if (cursor) all.push(cursor)
  if (opencode) all.push(opencode)
  if (cursorAgent) all.push(cursorAgent)
  if (crush) all.push(crush)
  if (warp) all.push(warp)
  if (vercelGw) all.push(vercelGw)
  if (zc) all.push(zc)
  if (zd) all.push(zd)
  return all
}

export const providers = coreProviders

// Isolate one provider's discovery. A non-complete outcome is retained as
// diagnostic state instead of being collapsed into an empty provider.
const warnedDiscoveryFailures = new Set<string>()

function warnDiscoveryOutcome(outcome: ProviderDiscoveryOutcome): void {
  if (outcome.complete || warnedDiscoveryFailures.has(outcome.provider)) return
  warnedDiscoveryFailures.add(outcome.provider)
  process.stderr.write('metrora: ' + outcome.provider + ' discovery ' + outcome.status + '; retained evidence was not reconciled' + String.fromCharCode(10))
}

function cancelled<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_, reject) => {
    const rejectCancelled = () => reject(new Error('provider discovery cancelled'))
    if (signal.aborted) rejectCancelled()
    else signal.addEventListener('abort', rejectCancelled, { once: true })
  })
}

export async function discoverProviderWithOutcome(provider: Provider, signal?: AbortSignal): Promise<ProviderDiscoveryOutcome> {
  if (signal?.aborted) return classifyProviderDiscoveryOutcome(provider.name, { cancelled: true })
  try {
    const discovered: unknown = signal
      ? await Promise.race([provider.discoverSessions(), cancelled<SessionSource[]>(signal)])
      : await provider.discoverSessions()
    return Array.isArray(discovered)
      ? classifyProviderDiscoveryOutcome(provider.name, { sources: discovered, cancelled: signal?.aborted === true })
      : classifyProviderDiscoveryOutcome(provider.name, { error: new Error('provider returned an invalid source list') })
  } catch (error) {
    return classifyProviderDiscoveryOutcome(provider.name, { error, cancelled: signal?.aborted === true })
  }
}

export type ProviderDiscoveryRun = {
  schemaVersion: typeof PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION
  complete: boolean
  outcomes: ProviderDiscoveryOutcome[]
  sources: SessionSource[]
}

export async function discoverAllSessionsWithOutcomes(
  providerFilter?: string,
  providerList?: Provider[],
  signal?: AbortSignal,
): Promise<ProviderDiscoveryRun> {
  const allProviders = providerList ?? await getAllProviders()
  const filtered = providerDiscoveryProviderOrder(allProviders.filter(provider => !providerFilter || providerFilter === 'all' || provider.name === providerFilter))
  const outcomes: ProviderDiscoveryOutcome[] = []
  for (const provider of filtered) {
    const outcome = await discoverProviderWithOutcome(provider, signal)
    outcomes.push(outcome)
    warnDiscoveryOutcome(outcome)
  }
  return {
    schemaVersion: PROVIDER_DISCOVERY_OUTCOME_SCHEMA_VERSION,
    complete: outcomes.every(providerDiscoveryIsComplete),
    outcomes,
    sources: outcomes.flatMap(outcome => [...outcome.sources]),
  }
}

export async function safeDiscoverSessions(provider: Provider, signal?: AbortSignal): Promise<SessionSource[]> {
  const outcome = await discoverProviderWithOutcome(provider, signal)
  warnDiscoveryOutcome(outcome)
  return [...outcome.sources]
}

export async function discoverAllSessions(
  providerFilter?: string,
  providerList?: Provider[],
  signal?: AbortSignal,
): Promise<SessionSource[]> {
  return (await discoverAllSessionsWithOutcomes(providerFilter, providerList, signal)).sources
}

export type FreshnessDiscoveryResult = {
  sources: SessionSource[]
  fastProviders: ReadonlySet<string>
  outcomes: ProviderDiscoveryOutcome[]
  complete: boolean
}

/**
 * Discover the source locators needed by the existing snapshot-completeness
 * contract. Providers with a path-only implementation avoid opening every
 * source file; callers must use full discovery when a path is not already
 * covered by the persisted authority manifest.
 */
export async function discoverAllSessionsForFreshness(
  providerFilter?: string,
  providerList?: Provider[],
): Promise<FreshnessDiscoveryResult> {
  const allProviders = providerList ?? await getAllProviders()
  const filtered = providerDiscoveryProviderOrder(allProviders.filter(provider => !providerFilter || providerFilter === 'all' || provider.name === providerFilter))
  const discovered: Array<{ provider: string; fast: boolean; sources: SessionSource[]; outcome: ProviderDiscoveryOutcome }> = []
  for (const provider of filtered) {
    if (provider.name === 'codex' && provider.probeRoots) {
      try {
        const sources = await discoverCodexSessionPathsForFreshness(await provider.probeRoots())
        const outcome = classifyProviderDiscoveryOutcome(provider.name, { sources })
        discovered.push({ provider: provider.name, fast: outcome.complete, sources, outcome })
        warnDiscoveryOutcome(outcome)
        continue
      } catch {
        // Fall back to the provider's full discovery path so the failure is
        // represented as a real outcome instead of an empty fast scan.
      }
    }
    const outcome = await discoverProviderWithOutcome(provider)
    discovered.push({ provider: provider.name, fast: false, sources: [...outcome.sources], outcome })
    warnDiscoveryOutcome(outcome)
  }
  const outcomes = discovered.map(value => value.outcome)
  return {
    sources: discovered.flatMap(value => value.sources),
    fastProviders: new Set(discovered.filter(value => value.fast).map(value => value.provider)),
    outcomes,
    complete: outcomes.every(providerDiscoveryIsComplete),
  }
}

export async function getProvider(name: string): Promise<Provider | undefined> {
  if (name === 'antigravity') {
    const ag = await loadAntigravity()
    return ag ?? undefined
  }
  if (name === 'forge') {
    const forge = await loadForge()
    return forge ?? undefined
  }
  if (name === 'goose') {
    const gs = await loadGoose()
    return gs ?? undefined
  }
  if (name === 'cursor') {
    const cursor = await loadCursor()
    return cursor ?? undefined
  }
  if (name === 'opencode') {
    const oc = await loadOpenCode()
    return oc ?? undefined
  }
  if (name === 'cursor-agent') {
    const ca = await loadCursorAgent()
    return ca ?? undefined
  }
  if (name === 'crush') {
    const c = await loadCrush()
    return c ?? undefined
  }
  if (name === 'warp') {
    const w = await loadWarp()
    return w ?? undefined
  }
  if (name === 'vercel-gateway') {
    const vg = await loadVercelGateway()
    return vg ?? undefined
  }
  if (name === 'zcode') {
    const z = await loadZcode()
    return z ?? undefined
  }
  if (name === 'zed') {
    const z = await loadZed()
    return z ?? undefined
  }
  return coreProviders.find(p => p.name === name)
    ?? internalProviders.find(p => p.name === name)
}
