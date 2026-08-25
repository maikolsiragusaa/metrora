import { loadOrCreateIdentity } from './identity.js'
import { PeerStore } from './pairing.js'
import { canonicalActivityQuery, canonicalCompanionQuery, ShareServer, type ActivityQuery, type UsageQuery } from './share-server.js'
import { advertise } from './discovery.js'
import { promptYesNo } from './prompt.js'
import { sanitizeForSharing } from './sanitize.js'
import { getSharingDir, loadPeers, savePeers } from './store.js'
import { loadPricing } from '../models.js'
import { buildMenubarPayloadForRange, type AggregateOpts, type PeriodInfo } from '../usage-aggregator.js'
import { periodInfoFromQuery } from '../cli-date.js'
import type { MenubarPayload } from '../menubar-json.js'
import { buildPairingBootstrap } from './pairing-bootstrap.js'
import { getLanAddresses } from './network-address.js'
import { buildCompanionCapabilitiesV1 } from './capability-contract.js'
import { toCompanionCapacityV1, unavailableCompanionCapacityV1 } from './capacity-contract.js'
import { buildCompanionProjectCatalogProjection } from './project-catalog.js'
import {
  activityPeriodQuery,
  buildActivitySessionDetail,
  buildActivitySessionsPage,
  buildActivityPullRequestsPage,
} from './activity-projection.js'
import { parseAllSessions } from '../parser.js'
import { readProjectRegistry, type ProjectRegistryReadResult } from '../project-registry.js'
import { filterProjectsByMetroraScope } from '../project-scope.js'
import type { ActivitySessionDetailPayloadV1, ActivitySessionsPageV1, ActivityPullRequestsPageV1 } from './activity-contract.js'
import type { ProjectSummary } from '../types.js'

const IDLE_TIMEOUT_MS = 10 * 60_000

export type CompanionUsageAggregator = (
  periodInfo: PeriodInfo,
  opts: AggregateOpts,
) => Promise<MenubarPayload>

export type CompanionActivityAggregator = CompanionUsageAggregator
export type CompanionCapacityReader = () => Promise<unknown>

/**
 * Canonical authorities used by the production Activity projection. Keeping
 * these dependencies explicit gives the route integration tests an isolated
 * fixture seam without introducing a second parser or accounting engine.
 */
export type CompanionActivityAuthority = {
  parseAllSessions: (range: Parameters<typeof parseAllSessions>[0], providerFilter?: string) => Promise<ProjectSummary[]>
  readProjectRegistry: () => Promise<ProjectRegistryReadResult>
}

const productionActivityAuthority: CompanionActivityAuthority = {
  parseAllSessions,
  readProjectRegistry,
}

/**
 * Build only the data the companion DTO can expose. The companion contract does
 * not use the granular timeline, so keeping that pass enabled would make a
 * cold first request pay for work that is discarded before serialization.
 */
export async function buildCompanionUsage(
  query: UsageQuery,
  aggregate: CompanionUsageAggregator = buildMenubarPayloadForRange,
): Promise<MenubarPayload> {
  const canonical = canonicalCompanionQuery(query)
  const periodInfo = periodInfoFromQuery(canonical, 'month')
  return sanitizeForSharing(await aggregate(periodInfo, {
    provider: 'all',
    optimize: false,
    timeline: false,
    metroraProjectId: canonical.projectScopeId,
    trendGranularity: canonical.granularity,
  }))
}

export async function buildCompanionCapabilities(capacityAvailable = false): Promise<ReturnType<typeof buildCompanionCapabilitiesV1>> {
  return buildCompanionCapabilitiesV1(undefined, { capacityAvailable })
}

export async function buildCompanionFoundation(
  query: UsageQuery,
  aggregate: CompanionUsageAggregator = buildMenubarPayloadForRange,
  capacityAvailable = false,
): Promise<unknown> {
  const canonical = canonicalCompanionQuery(query)
  const periodInfo = periodInfoFromQuery(canonical, 'month')
  const payload = await aggregate(periodInfo, {
    provider: 'all',
    optimize: false,
    timeline: false,
    metroraProjectId: canonical.projectScopeId,
    trendGranularity: canonical.granularity,
  })
  if (payload.mobileFoundation) {
    return {
      ...payload.mobileFoundation,
      // Foundation remains the period-scoped compatibility surface, but its
      // capability matrix must advertise the same Desktop authority that the
      // live capability route exposes.
      capabilities: buildCompanionCapabilitiesV1(payload.mobileFoundation.generatedAt, { capacityAvailable }),
    }
  }
  return {
    kind: 'metrora.companion.foundation',
    version: 1,
    generatedAt: payload.generated,
    periodLabel: payload.current.label,
    ...(canonical.granularity === 'day' || canonical.granularity === 'week' || canonical.granularity === 'month'
      ? { trendGranularity: canonical.granularity }
      : {}),
    capabilities: buildCompanionCapabilitiesV1(payload.generated, { capacityAvailable }),
    projectScope: payload.projectScope,
    activity: { available: true, freshness: 'unknown', coverage: 'unavailable', sessions: [] },
    analyze: {
      models: {
        available: false,
        freshness: 'unknown',
        coverage: 'unavailable',
        tokenCoverage: 'unavailable',
        historical: false,
        accountingCoverage: { cost: null, calls: null, tokenCost: null, tokenCalls: null },
        rows: [],
      },
      spend: { available: true, freshness: 'unknown', data: { costMicrosUsd: 0, calls: 0, sessions: 0, trend: [] } },
    },
    workspace: { available: false, reason: 'no-authority' },
  }
}

/**
 * Project the already-sanitized Electron ProviderQuotaSnapshot authority for
 * the authenticated companion. The CLI share path does not have that
 * authority, so it returns an explicit unavailable envelope instead.
 */
export async function buildCompanionCapacity(
  readCapacity?: CompanionCapacityReader,
): Promise<ReturnType<typeof toCompanionCapacityV1>> {
  if (!readCapacity) return unavailableCompanionCapacityV1()
  return toCompanionCapacityV1(await readCapacity())
}

async function buildActivityInput(
  query: ActivityQuery,
  aggregate: CompanionActivityAggregator,
  authority: CompanionActivityAuthority,
) {
  const canonicalWithCursor = canonicalActivityQuery(query)
  const { cursor, ...canonical } = canonicalWithCursor
  const periodInfo = activityPeriodQuery({ from: canonical.effectiveFrom, to: canonical.effectiveTo })
  const payload = await aggregate(periodInfo, {
    provider: canonical.provider ?? 'all',
    optimize: false,
    timeline: false,
    metroraProjectId: canonical.projectScopeId,
  })
  const registryResult = await authority.readProjectRegistry()
  const projects = filterProjectsByMetroraScope(
    await authority.parseAllSessions(periodInfo.range, 'all'),
    registryResult.registry,
    canonical.projectScopeId,
  )
  return { query: canonical, cursor, payload, projects, registry: registryResult.registry }
}

export async function buildCompanionActivitySessions(
  query: ActivityQuery,
  aggregate: CompanionActivityAggregator = buildMenubarPayloadForRange,
  authority: CompanionActivityAuthority = productionActivityAuthority,
): Promise<ActivitySessionsPageV1> {
  const input = await buildActivityInput(query, aggregate, authority)
  return buildActivitySessionsPage(input, input.cursor)
}

export async function buildCompanionActivitySessionDetail(
  query: ActivityQuery,
  id: string,
  aggregate: CompanionActivityAggregator = buildMenubarPayloadForRange,
  authority: CompanionActivityAuthority = productionActivityAuthority,
): Promise<ActivitySessionDetailPayloadV1 | null> {
  const input = await buildActivityInput(query, aggregate, authority)
  return buildActivitySessionDetail(input, id)
}

export async function buildCompanionActivityPullRequests(
  query: ActivityQuery,
  aggregate: CompanionActivityAggregator = buildMenubarPayloadForRange,
  authority: CompanionActivityAuthority = productionActivityAuthority,
): Promise<ActivityPullRequestsPageV1> {
  const input = await buildActivityInput(query, aggregate, authority)
  return buildActivityPullRequestsPage(input, input.cursor)
}

export async function buildCompanionProjectCatalog(
  buildCatalog: () => Promise<unknown> = buildCompanionProjectCatalogProjection,
): Promise<unknown> {
  return buildCatalog()
}

// Run the secure share server. On-demand by default: it stops after 10 minutes
// of no requests. `--always` keeps it up until Ctrl+C (the opt-in persistent
// mode). `--pair` opens the inherited one-time PIN fallback for legacy clients.
export async function runShareServer(opts: { port: number; pair: boolean; always: boolean }): Promise<void> {
  await loadPricing()
  const dir = getSharingDir()
  const identity = await loadOrCreateIdentity(dir)
  const peers = new PeerStore(await loadPeers(dir))

  const server = new ShareServer({
    identity,
    peers,
    getUsage: (q) => buildCompanionUsage(q),
    getCapabilities: () => buildCompanionCapabilities(false),
    getFoundation: (q) => buildCompanionFoundation(q, buildMenubarPayloadForRange, false),
    getProjectCatalog: () => buildCompanionProjectCatalog(),
    getActivitySessions: (q) => buildCompanionActivitySessions(q),
    getActivitySessionDetail: (q, id) => buildCompanionActivitySessionDetail(q, id),
    getActivityPullRequests: (q) => buildCompanionActivityPullRequests(q),
    onPeersChanged: () => savePeers(peers.list(), dir),
    approve: async (req) => {
      process.stdout.write(`\n  "${req.name}" wants access to your shared usage.\n`)
      process.stdout.write(`  Confirm this complete code matches on that device:  ${req.code}\n`)
      const ok = await promptYesNo('  Approve?', 60_000)
      process.stdout.write(ok ? `  Approved "${req.name}".\n\n` : `  Declined "${req.name}".\n\n`)
      return ok
    },
  })

  const port = await server.listen(opts.port, '0.0.0.0')
  const ip = getLanAddresses()[0] ?? '127.0.0.1'
  const connectPayload = buildPairingBootstrap(ip, port)
  const ad = advertise({ name: identity.name, port, fingerprint: identity.fingerprint })

  const shutdown = async (): Promise<void> => {
    await ad.stop().catch(() => {})
    await server.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())

  process.stdout.write(`\n  Sharing "${identity.name}" - discoverable on your local network.\n`)
  process.stdout.write('  In Metrora Mobile, scan the connection QR in the Desktop dashboard and compare the six-digit code.\n')
  process.stdout.write(`  Address: ${ip}:${port}\n`)
  process.stdout.write(`  Connection payload: ${connectPayload}\n`)
  if (opts.pair) {
    const pin = server.openPairing(120_000)
    process.stdout.write(`\n  Legacy manual fallback:\n`)
    process.stdout.write(`    metrora devices add ${ip}:${port} --pin ${pin}\n`)
  }
  process.stdout.write(`\n  ${peers.list().length} paired device(s). Press Ctrl+C to stop.\n\n`)

  if (!opts.always) {
    let last = Date.now()
    server.server.on('request', () => {
      last = Date.now()
    })
    const timer = setInterval(() => {
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        process.stdout.write('\n  Idle, stopping share. Run `metrora share` again when you need it.\n')
        process.exit(0)
      }
    }, 30_000)
    timer.unref()
  }

  await new Promise<never>(() => {
    /* run until interrupted */
  })
}
