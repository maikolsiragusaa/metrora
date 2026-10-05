import { mkdtemp, rm, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runWebDashboard } from '../src/web-dashboard.js'

// Regression guard for the original bug: a bad `period` query used to hit
// process.exit(1) and kill the long-running dashboard server. The handlers must
// now answer 400 and keep serving.
describe('web dashboard server: invalid query returns 400 without exiting', () => {
  let server: Server
  let base: string
  let homeDir: string
  let cacheDir: string
  const prevHome = process.env['HOME']
  const prevCache = process.env['METRORA_CACHE_DIR']

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'metrora-web-home-'))
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-web-cache-'))
    process.env['HOME'] = homeDir
    process.env['METRORA_CACHE_DIR'] = cacheDir
    server = await runWebDashboard({
      period: 'today', provider: 'all', project: [], exclude: [], port: 0, open: false,
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (prevHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = prevHome
    if (prevCache === undefined) delete process.env['METRORA_CACHE_DIR']
    else process.env['METRORA_CACHE_DIR'] = prevCache
    await rm(homeDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('answers 400 for an invalid /api/usage period and keeps serving', async () => {
    const bad = await fetch(`${base}/api/usage?period=garbage`)
    expect(bad.status).toBe(400)
    expect((await bad.json() as { error: string }).error).toMatch(/Unknown period "garbage"/)

    // The bug was process.exit; if it regressed, this test process would die.
    // A successful follow-up request proves the server survived the bad one.
    const ok = await fetch(`${base}/api/usage?period=today`)
    expect(ok.status).toBe(200)
    const payload = await ok.json() as { history: { timeline?: { bucketMinutes: number; points: unknown[] } } }
    expect(payload.history.timeline?.bucketMinutes).toBe(15)
    expect(Array.isArray(payload.history.timeline?.points)).toBe(true)
  })

  it('answers 400 for an invalid /api/devices period', async () => {
    const bad = await fetch(`${base}/api/devices?period=garbage`)
    expect(bad.status).toBe(400)
    expect((await bad.json() as { error: string }).error).toMatch(/Unknown period "garbage"/)
  })
})

// Stale-while-revalidate serving: the page and the data endpoints must answer
// immediately from the last-good payload while a rebuild runs in the
// background, and the last-good payload must survive into future server
// processes so a fresh open never blocks on a multi-minute rebuild.
describe('web dashboard server: stale-while-revalidate payload serving', () => {
  const prevHome = process.env['HOME']
  const prevCache = process.env['METRORA_CACHE_DIR']
  const prevDash = process.env['METRORA_DASH_DIR']
  let homeDir: string
  let cacheDir: string
  let dashDir: string
  let server: Server
  let base: string
  let secondServer: Server
  let secondBase: string
  let garbageServer: Server
  let garbageBase: string

  const waitUntil = async (check: () => boolean | Promise<boolean>, ms: number): Promise<void> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // tests/setup/env-isolation.ts re-applies the worker sandbox before every
  // test (wiping HOME / METRORA_CACHE_DIR / METRORA_DASH_DIR), so this describe
  // re-points them at its own fixtures after that wipe — including during the
  // beforeAll server starts, whose request handlers read env per request.
  const applyFixtures = (): void => {
    process.env['HOME'] = homeDir
    process.env['METRORA_CACHE_DIR'] = cacheDir
    process.env['METRORA_DASH_DIR'] = dashDir
  }

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'metrora-swr-home-'))
    cacheDir = await mkdtemp(join(tmpdir(), 'metrora-swr-cache-'))
    dashDir = await mkdtemp(join(tmpdir(), 'metrora-swr-dash-'))
    await writeFile(join(dashDir, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>', 'utf8')
    applyFixtures()
    server = await runWebDashboard({ period: 'today', provider: 'all', project: [], exclude: [], port: 0, open: false })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  beforeEach(applyFixtures)

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => secondServer.close(() => resolve()))
    await new Promise<void>((resolve) => garbageServer.close(() => resolve()))
    if (prevHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = prevHome
    if (prevCache === undefined) delete process.env['METRORA_CACHE_DIR']
    else process.env['METRORA_CACHE_DIR'] = prevCache
    if (prevDash === undefined) delete process.env['METRORA_DASH_DIR']
    else process.env['METRORA_DASH_DIR'] = prevDash
    await rm(homeDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rm(dashDir, { recursive: true, force: true })
  })

  it('serves /api/devices with a stale flag and no devices error on a cold server', async () => {
    const res = await fetch(`${base}/api/devices?period=today`)
    expect(res.status).toBe(200)
    const body = await res.json() as { devices: { id: string; local: boolean }[]; stale: boolean }
    expect(Array.isArray(body.devices)).toBe(true)
    expect(body.devices[0]?.local).toBe(true)
    expect(typeof body.stale).toBe('boolean')
    expect(body.stale).toBe(false) // cold key: the build was awaited, so it is fresh
  })

  it('persists the last-good payload into the cache dir', { timeout: 20_000 }, async () => {
    await waitUntil(() => existsSync(join(cacheDir, 'web-last-good-payloads.v1.json')), 10_000)
    expect(existsSync(join(cacheDir, 'web-last-good-payloads.v1.json'))).toBe(true)
    // And a completed rebuild left no temp files behind.
    await waitUntil(async () => !(await readdir(cacheDir)).some((f) => f.endsWith('.tmp')), 10_000)
  })

  it('a fresh server process hydrates the persisted payload into the first paint', async () => {
    secondServer = await runWebDashboard({ period: 'today', provider: 'all', project: [], exclude: [], port: 0, open: false })
    secondBase = `http://127.0.0.1:${(secondServer.address() as AddressInfo).port}`
    const res = await fetch(`${secondBase}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('window.__METRORA_BOOTSTRAP__=')
    expect(html).toContain('"id":"local"')
  })

  it('a server whose period never builds omits the bootstrap and still answers 400', async () => {
    garbageServer = await runWebDashboard({ period: 'garbage', provider: 'all', project: [], exclude: [], port: 0, open: false })
    garbageBase = `http://127.0.0.1:${(garbageServer.address() as AddressInfo).port}`
    const res = await fetch(`${garbageBase}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('window.__METRORA_BOOTSTRAP__=')
    const api = await fetch(`${garbageBase}/api/usage?period=garbage`)
    expect(api.status).toBe(400)
    expect((await api.json() as { error: string }).error).toMatch(/Unknown period "garbage"/)
  })
})
