import { createServer, type Server } from 'http'
import { exec } from 'child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { join, normalize, extname, dirname, sep } from 'path'
import { fileURLToPath } from 'url'
import { AddressInfo } from 'net'

import { hostname } from 'os'

import { loadPricing } from './models.js'
import { buildMenubarPayloadForRange } from './usage-aggregator.js'
import type { MenubarPayload } from './menubar-json.js'
import { periodInfoFromQuery, UsageQueryError } from './cli-date.js'
import { getMetroraCacheDir } from './product-paths.js'
import { pullDevices, linkRemote } from './sharing/host.js'
import { browse } from './sharing/discovery.js'
import { loadOrCreateIdentity } from './sharing/identity.js'
import { pairingCode } from './sharing/pairing.js'
import { getSharingDir, loadRemotes, loadShareAlways, saveShareAlways } from './sharing/store.js'
import { ShareController } from './sharing/share-controller.js'
import { sanitizeForSharing } from './sharing/sanitize.js'
import { buildContextTree, findClaudeSession, listRecentTitledSessions, snapshotRows, type ContextTreeResult, type SessionRef } from './context-tree.js'
import { buildCodexContextTree, findCodexSession, listRecentCodexSessions } from './context-tree-codex.js'

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1_000_000) reject(new Error('request body too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function writeJsonError(res: import('http').ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error }))
}

// How long a built local payload is considered fresh. A stale payload is still
// served immediately (stale-while-revalidate) while a background rebuild runs;
// the TTL only decides when that rebuild is triggered, never whether the
// caller waits.
const LOCAL_PAYLOAD_TTL_MS = 180_000
// After a failed rebuild, wait before the next request may retry it. Only
// applies when a last-good payload exists to serve meanwhile; a cold key (no
// good payload yet) always builds on request so error semantics are unchanged.
const REBUILD_FAILURE_BACKOFF_MS = 15_000
// Bounds for the last-good payload store, in memory and on disk. Entries are
// ~100-300KB each, so these caps keep both well under a few MB.
const PAYLOAD_CACHE_MAX_ENTRIES = 24
const LAST_GOOD_MAX_ENTRIES = 12
const LAST_GOOD_FILE = 'web-last-good-payloads.v1.json'

const HERE = dirname(fileURLToPath(import.meta.url))

// Locate the built React dashboard (dist/dash). Works both when running from a
// published package (dist/dash next to the bundled CLI) and from source.
function resolveDashDir(): string | null {
  const candidates = [
    process.env['METRORA_DASH_DIR'],
    join(HERE, 'dash'),
    join(HERE, '..', 'dist', 'dash'),
    join(HERE, '..', 'dash', 'dist'),
  ].filter(Boolean) as string[]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

const NOT_BUILT_PAGE =
  '<!doctype html><meta charset="utf-8">' +
  '<body style="font-family:system-ui;background:#0a0a0b;color:#e7e7ea;padding:48px;line-height:1.6">' +
  '<h2>Dashboard not built yet</h2>' +
  '<p>Build the web UI once, then reload:</p>' +
  '<pre style="background:#141417;padding:12px 16px;border-radius:8px;color:#ff8c42">cd dash &amp;&amp; npm install &amp;&amp; npm run build</pre>' +
  '<p>The CLI keeps serving the live data API in the meantime.</p></body>'

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  try {
    exec(`${cmd} ${url}`)
  } catch {
    /* user can open it manually */
  }
}

export async function runWebDashboard(opts: {
  period: string
  provider: string
  from?: string
  to?: string
  project: string[]
  exclude: string[]
  port: number
  open: boolean
}): Promise<Server> {
  await loadPricing()
  const dashDir = resolveDashDir()

  // Sharing this device serves the SANITIZED aggregate (no project names/paths
  // or per-session detail), unlike the local /api/usage which shows everything.
  const shareGetUsage = async (q: { period?: string; from?: string; to?: string }) => {
    const periodInfo = periodInfoFromQuery(q, opts.period)
    return sanitizeForSharing(await buildMenubarPayloadForRange(periodInfo, { provider: 'all', optimize: false }))
  }
  const share = new ShareController(shareGetUsage)
  if (await loadShareAlways()) await share.start(true).catch(() => {})

  // ── Local payload: stale-while-revalidate ─────────────────────────────
  // The server is long-lived, so it keeps the last GOOD payload per query key
  // and never makes a caller wait for a rebuild while one exists: a stale
  // payload is served at once and a single background build refreshes it.
  // Concurrent requests for the same key collapse into one build.
  type SwrEntry = {
    at: number
    good: MenubarPayload | null
    building: Promise<MenubarPayload> | null
    failedAt: number
  }
  const localPayloadCache = new Map<string, SwrEntry>()

  // Last-good persistence: after each successful rebuild the payload is written
  // (atomic temp+rename) so a future server process starts with real numbers.
  // Best-effort — a failed write never affects serving.
  const lastGoodFilePath = (): string => join(getMetroraCacheDir(), LAST_GOOD_FILE)

  function readPersistedLastGood(): Promise<[string, { at: number; payload: MenubarPayload }][]> {
    return (async () => {
      try {
        const raw = JSON.parse(await readFile(lastGoodFilePath(), 'utf8')) as {
          version?: number
          entries?: Record<string, { at?: number; payload?: MenubarPayload }>
        }
        if (raw.version !== 1 || !raw.entries || typeof raw.entries !== 'object') return []
        const out: [string, { at: number; payload: MenubarPayload }][] = []
        for (const [key, value] of Object.entries(raw.entries)) {
          const at = value?.at
          const payload = value?.payload
          // Minimal shape gate: a corrupt entry would render one bad frame
          // before the background rebuild replaces it; skip it instead.
          if (typeof at !== 'number' || !Number.isFinite(at)) continue
          if (!payload || typeof payload !== 'object' || typeof payload.current !== 'object' || payload.current === null) continue
          out.push([key, { at, payload }])
        }
        out.sort((a, b) => b[1].at - a[1].at)
        return out.slice(0, LAST_GOOD_MAX_ENTRIES)
      } catch {
        return []
      }
    })()
  }

  let persistPending = false
  let persistChain: Promise<void> = Promise.resolve()
  function scheduleLastGoodPersist(): void {
    persistPending = true
    persistChain = persistChain.then(async () => {
      if (!persistPending) return
      persistPending = false
      try {
        const newest = [...localPayloadCache.entries()]
          .filter(([, e]) => e.good)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, LAST_GOOD_MAX_ENTRIES)
        const entries: Record<string, { at: number; payload: MenubarPayload }> = {}
        for (const [key, e] of newest) entries[key] = { at: e.at, payload: e.good! }
        const dir = getMetroraCacheDir()
        await mkdir(dir, { recursive: true })
        const finalPath = lastGoodFilePath()
        const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
        await writeFile(tempPath, JSON.stringify({ version: 1, entries }), 'utf8')
        // Windows can briefly hold a freshly written file (AV/indexer), so the
        // rename retries the same way the session cache's save does.
        let renamed = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await rename(tempPath, finalPath)
            renamed = true
            break
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if ((code !== 'EPERM' && code !== 'EBUSY') || attempt === 2) break
            await new Promise((resolve) => { setTimeout(resolve, 10 * (attempt + 1)) })
          }
        }
        if (!renamed) await rm(tempPath, { force: true }).catch(() => {})
      } catch {
        /* best-effort persistence; serving never depends on it */
      }
    }).catch(() => { /* previous write failed; the next attempt retries */ })
  }

  // Restore last-good payloads persisted by previous runs so a freshly opened
  // dashboard paints real numbers on its very first request instead of a
  // multi-minute blank page after the session corpus has grown.
  for (const [key, value] of await readPersistedLastGood()) {
    localPayloadCache.set(key, { at: value.at, good: value.payload, building: null, failedAt: 0 })
  }

  const payloadKey = (period: string, provider: string, from?: string, to?: string): string =>
    `${period}|${provider}|${from ?? ''}|${to ?? ''}`

  const evictPayloadCache = (): void => {
    if (localPayloadCache.size <= PAYLOAD_CACHE_MAX_ENTRIES) return
    const byAge = [...localPayloadCache.entries()].sort((a, b) => a[1].at - b[1].at)
    while (localPayloadCache.size > PAYLOAD_CACHE_MAX_ENTRIES && byAge.length > 0) {
      const [oldestKey] = byAge.shift()!
      localPayloadCache.delete(oldestKey)
    }
  }

  const startPayloadBuild = (key: string, entry: SwrEntry, period: string, provider: string, from?: string, to?: string): Promise<MenubarPayload> => {
    const periodInfo = periodInfoFromQuery({ period, from, to }, opts.period)
    const build = buildMenubarPayloadForRange(periodInfo, { provider, project: opts.project, exclude: opts.exclude, optimize: false })
    const tracked = (async () => {
      try {
        const payload = await build
        entry.good = payload
        entry.at = Date.now()
        entry.failedAt = 0
        scheduleLastGoodPersist()
        return payload
      } catch (err) {
        entry.failedAt = Date.now()
        throw err
      } finally {
        entry.building = null
      }
    })()
    entry.building = tracked
    evictPayloadCache()
    // The stale-serve path returns the last-good payload without awaiting the
    // rebuild, so a rejected build would surface as an unhandled rejection and
    // kill the server. Handle it here; cold-key awaiters attach their own.
    void tracked.catch(() => {})
    return tracked
  }

  type ResolvedPayload = { payload: MenubarPayload; stale: boolean }
  const resolveLocalPayload = async (period: string, provider: string, from?: string, to?: string): Promise<ResolvedPayload> => {
    const key = payloadKey(period, provider, from, to)
    let entry = localPayloadCache.get(key)
    if (!entry) {
      entry = { at: 0, good: null, building: null, failedAt: 0 }
      localPayloadCache.set(key, entry)
    }
    if (entry.good) {
      const fresh = Date.now() - entry.at < LOCAL_PAYLOAD_TTL_MS
      if (!fresh && !entry.building) {
        const inBackoff = entry.failedAt !== 0 && Date.now() - entry.failedAt < REBUILD_FAILURE_BACKOFF_MS
        if (!inBackoff) startPayloadBuild(key, entry, period, provider, from, to)
      }
      return { payload: entry.good, stale: !fresh }
    }
    // No good payload yet (cold key): await the build so a rejection reaches
    // the caller exactly as the old blocking path did (e.g. invalid period →
    // UsageQueryError → HTTP 400).
    if (!entry.building) startPayloadBuild(key, entry, period, provider, from, to)
    const payload = await entry.building!
    return { payload, stale: false }
  }

  const getLocalPayload = (period: string, provider: string, from?: string, to?: string): Promise<MenubarPayload> =>
    resolveLocalPayload(period, provider, from, to).then((r) => r.payload)

  // Context trees re-read a whole transcript (up to 100MB), so cache each by
  // file version. Keyed on mtime: an active session invalidates itself.
  const contextTreeCache = new Map<string, Promise<ContextTreeResult>>()
  const getContextTree = (provider: 'claude' | 'codex', ref: SessionRef): Promise<ContextTreeResult> => {
    const key = `${provider}:${ref.sessionId}:${ref.mtimeMs}`
    const hit = contextTreeCache.get(key)
    if (hit) {
      // Re-insert so eviction is LRU rather than insertion order.
      contextTreeCache.delete(key)
      contextTreeCache.set(key, hit)
      return hit
    }
    const tree = provider === 'claude' ? buildContextTree(ref) : buildCodexContextTree(ref)
    contextTreeCache.set(key, tree)
    void tree.catch(() => contextTreeCache.delete(key))
    while (contextTreeCache.size > 12) {
      const oldest = contextTreeCache.keys().next().value
      if (oldest === undefined) break
      contextTreeCache.delete(oldest)
    }
    return tree
  }

  // Embed the machine's last-good payload in index.html for an instant first
  // paint with no data round-trip. Served from the stale-while-revalidate cache
  // without awaiting anything: the numbers may be from a previous run, and the
  // live /api/devices fetch right after paint refreshes them (polling while
  // stale). A cold server with no last-good yet omits the bootstrap entirely;
  // the SPA paints its loading state and the first /api/devices response fills
  // the page in. Only the local device is inlined: no remote network wait.
  const serveIndexHtml = async (res: import('http').ServerResponse, filePath: string): Promise<void> => {
    const html = await readFile(filePath, 'utf8')
    const payload = localPayloadCache.get(payloadKey(opts.period, opts.provider, opts.from, opts.to))?.good ?? null
    const devices = payload ? [{ id: 'local', name: hostname(), local: true, payload }] : []
    // Escape every '<' so a device/model/project name can't close the <script>.
    const json = JSON.stringify({ devices }).replace(/</g, String.fromCharCode(92) + 'u003c')
    const injected = payload
      ? html.replace('<script type="module"', `<script>window.__METRORA_BOOTSTRAP__=${json}</script>\n    <script type="module"`)
      : html
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(injected)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')

      // Loopback-only server. Reject any request not addressed to localhost
      // (defeats DNS rebinding, which would otherwise let a website you visit
      // read your local usage) and any cross-origin request (CSRF). The local
      // payload is unsanitized, so this guard is what keeps it on your machine.
      const reqHost = (req.headers.host ?? '').replace(/:\d+$/, '')
      const loopback = reqHost === '127.0.0.1' || reqHost === 'localhost' || reqHost === '::1' || reqHost === '[::1]'
      const origin = req.headers.origin
      const originOk = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)
      if (!loopback || !originOk) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('Forbidden')
        return
      }

      if (url.pathname === '/api/usage') {
        const period = url.searchParams.get('period') ?? opts.period
        const provider = url.searchParams.get('provider') ?? opts.provider
        const from = url.searchParams.get('from') ?? opts.from
        const to = url.searchParams.get('to') ?? opts.to
        let payload
        try {
          payload = (await resolveLocalPayload(period, provider, from, to)).payload
        } catch (err) {
          if (!(err instanceof UsageQueryError)) throw err
          writeJsonError(res, 400, err.message)
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
        return
      }

      // This machine plus every paired device, each kept separate. Remote
      // payloads arrive already sanitized (aggregate numbers only). The local
      // payload is served stale-while-revalidate, so the response is immediate
      // whenever a last-good build exists; `stale` tells the SPA to poll until
      // the background rebuild lands.
      if (url.pathname === '/api/devices') {
        const period = url.searchParams.get('period') ?? opts.period
        const provider = url.searchParams.get('provider') ?? opts.provider
        const from = url.searchParams.get('from') ?? opts.from
        const to = url.searchParams.get('to') ?? opts.to
        let results
        let stale = false
        try {
          const resolved = await resolveLocalPayload(period, provider, from, to)
          stale = resolved.stale
          results = await pullDevices(async () => resolved.payload, { period, from, to }, hostname(), {})
        } catch (err) {
          if (!(err instanceof UsageQueryError)) throw err
          writeJsonError(res, 400, err.message)
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ devices: results, stale }))
        return
      }

      // This device's own identity (name + fingerprint) for the pairing UI.
      if (url.pathname === '/api/identity') {
        const id = await loadOrCreateIdentity(getSharingDir())
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ name: id.name, fingerprint: id.fingerprint }))
        return
      }

      // Discover devices currently sharing on the local network (mDNS). Each
      // carries the confirm code to match, and whether it is already paired.
      if (url.pathname === '/api/devices/scan') {
        const dir = getSharingDir()
        const id = await loadOrCreateIdentity(dir)
        const pairedFps = new Set((await loadRemotes(dir)).map((r) => r.fingerprint))
        const found = await browse(2500)
        const list = found
          .filter((d) => d.fingerprint !== id.fingerprint)
          .map((d) => ({
            name: d.name,
            host: d.host,
            port: d.port,
            fingerprint: d.fingerprint,
            code: pairingCode(id.fingerprint, d.fingerprint),
            paired: pairedFps.has(d.fingerprint),
          }))
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ found: list }))
        return
      }

      // Pair with a chosen discovered device. Blocks until the other device
      // approves (or declines / times out), then stores the link.
      if (url.pathname === '/api/devices/pair' && req.method === 'POST') {
        if (!(req.headers['content-type'] ?? '').includes('application/json')) {
          res.writeHead(415, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'content-type must be application/json' }))
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { name: string; host: string; port: number; fingerprint: string }
        try {
          const device = await linkRemote(body)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, name: device.name }))
        } catch (err) {
          res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        }
        return
      }

      // Share-this-device controls. Status carries the pending pairing requests
      // so the SPA can poll one endpoint and surface approvals in the browser.
      if (url.pathname === '/api/share/status') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(await share.status()))
        return
      }
      if (url.pathname === '/api/share/start' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { always?: boolean }
        let startError: string | undefined
        try {
          await share.start(!!body.always)
          await saveShareAlways(!!body.always)
        } catch (err) {
          // e.g. EADDRINUSE when a CLI `metrora share` already holds the port.
          startError = err instanceof Error ? err.message : String(err)
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ...(await share.status()), error: startError }))
        return
      }
      if (url.pathname === '/api/share/stop' && req.method === 'POST') {
        await share.stop()
        await saveShareAlways(false)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(await share.status()))
        return
      }
      // Session ids are resolved against the discovered session files only,
      // never joined into a path from user input, and responses never carry
      // local file paths.
      if (url.pathname === '/api/context/sessions') {
        const provider = url.searchParams.get('provider') ?? 'claude'
        if (provider !== 'claude' && provider !== 'codex') {
          writeJsonError(res, 400, 'provider must be claude or codex')
          return
        }
        const refs = provider === 'claude' ? await listRecentTitledSessions(15) : await listRecentCodexSessions(15)
        const sessions = refs.map((r) => ({ provider, sessionId: r.sessionId, project: r.project, title: r.title, mtimeMs: r.mtimeMs, sizeBytes: r.sizeBytes }))
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ sessions }))
        return
      }
      if (url.pathname === '/api/context/tree') {
        const provider = url.searchParams.get('provider') ?? 'claude'
        const id = url.searchParams.get('id') ?? ''
        if ((provider !== 'claude' && provider !== 'codex') || !id) {
          writeJsonError(res, 400, 'provider (claude|codex) and id are required')
          return
        }
        const ref = provider === 'claude' ? await findClaudeSession(id) : await findCodexSession(id)
        if (!ref || ref.sessionId !== id) {
          writeJsonError(res, 404, `no ${provider} session ${id}`)
          return
        }
        const tree = await getContextTree(provider, ref)
        const payload = {
          ...tree,
          session: { sessionId: tree.session.sessionId, project: tree.session.project, mtimeMs: tree.session.mtimeMs, sizeBytes: tree.session.sizeBytes },
          effectiveRows: snapshotRows(tree.effective),
          fullRows: snapshotRows(tree.full),
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
        return
      }

      if (url.pathname === '/api/share/approve' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { id?: string; approve?: boolean }
        const ok = typeof body.id === 'string' && share.resolvePending(body.id, !!body.approve)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok }))
        return
      }

      if (!dashDir) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(NOT_BUILT_PAGE)
        return
      }

      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/' || pathname === '') pathname = '/index.html'
      const filePath = normalize(join(dashDir, pathname))
      if (filePath !== dashDir && !filePath.startsWith(dashDir + sep)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      try {
        if (extname(filePath) === '.html') {
          await serveIndexHtml(res, filePath)
        } else {
          const buf = await readFile(filePath)
          res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' })
          res.end(buf)
        }
      } catch {
        // Unknown path: serve index.html so the SPA can route it.
        await serveIndexHtml(res, join(dashDir, 'index.html'))
      }
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      } else {
        reject(err)
      }
    })
    server.listen(opts.port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
  // Durable handler so a post-bind socket error never crashes the process.
  server.on('error', () => {})

  void Promise.resolve().then(() => getLocalPayload(opts.period, opts.provider, opts.from, opts.to)).catch(() => {})

  const url = `http://127.0.0.1:${port}`
  if (!dashDir) {
    process.stdout.write(`\n  Dashboard UI is not built. Run: cd dash && npm install && npm run build\n`)
  }
  process.stdout.write(`\n  Metrora dashboard at ${url}\n  Press Ctrl+C to stop.\n\n`)
  if (opts.open) openBrowser(url)

  // Withdraw the mDNS advertisement and close the share server cleanly on exit.
  process.on('SIGINT', () => {
    void share.stop().finally(() => process.exit(0))
  })

  return server

  await new Promise<never>(() => {
    /* run until interrupted */
  })
}
