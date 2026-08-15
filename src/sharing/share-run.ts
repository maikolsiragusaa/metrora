import { loadOrCreateIdentity } from './identity.js'
import { PeerStore } from './pairing.js'
import { ShareServer, type UsageQuery } from './share-server.js'
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

const IDLE_TIMEOUT_MS = 10 * 60_000

export type CompanionUsageAggregator = (
  periodInfo: PeriodInfo,
  opts: AggregateOpts,
) => Promise<MenubarPayload>

/**
 * Build only the data the companion DTO can expose. The companion contract does
 * not use the granular timeline, so keeping that pass enabled would make a
 * cold first request pay for work that is discarded before serialization.
 */
export async function buildCompanionUsage(
  query: UsageQuery,
  aggregate: CompanionUsageAggregator = buildMenubarPayloadForRange,
): Promise<MenubarPayload> {
  const periodInfo = periodInfoFromQuery(query, 'month')
  return sanitizeForSharing(await aggregate(periodInfo, {
    provider: 'all',
    optimize: false,
    timeline: false,
    metroraProjectId: query.projectScopeId,
    trendGranularity: query.granularity,
  }))
}

export async function buildCompanionCapabilities(): Promise<ReturnType<typeof buildCompanionCapabilitiesV1>> {
  return buildCompanionCapabilitiesV1()
}

export async function buildCompanionFoundation(
  query: UsageQuery,
  aggregate: CompanionUsageAggregator = buildMenubarPayloadForRange,
): Promise<unknown> {
  const periodInfo = periodInfoFromQuery(query, 'month')
  const payload = await aggregate(periodInfo, {
    provider: 'all',
    optimize: false,
    timeline: false,
    metroraProjectId: query.projectScopeId,
    trendGranularity: query.granularity,
  })
  return payload.mobileFoundation ?? {
    kind: 'metrora.companion.foundation',
    version: 1,
    generatedAt: payload.generated,
    periodLabel: payload.current.label,
    ...(query.granularity === 'day' || query.granularity === 'week' || query.granularity === 'month'
      ? { trendGranularity: query.granularity }
      : {}),
    capabilities: buildCompanionCapabilitiesV1(payload.generated),
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
    getCapabilities: () => buildCompanionCapabilities(),
    getFoundation: (q) => buildCompanionFoundation(q),
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
