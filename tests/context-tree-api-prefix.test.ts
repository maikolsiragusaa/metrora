import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import type { Server } from 'http'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runWebDashboard } from '../src/web-dashboard.js'

// Issue #767 item 2: `codeburn context <session>` accepts an 8-char session id
// prefix (findClaudeSession does a startsWith match), but /api/context/tree
// additionally required the resolved ref's sessionId to equal the id passed
// in verbatim -- so the same prefix that works on the CLI 404s through the
// API. findClaudeSession is the single source of truth for prefix resolution
// on both surfaces; the API should trust it exactly like the CLI does instead
// of re-validating for an exact match afterwards.
const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SESSION_PREFIX = SESSION_ID.slice(0, 8)

describe('web dashboard /api/context/tree: session id prefix', () => {
  let server: Server
  let base: string
  let homeDir: string
  let cacheDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'codeburn-context-home-'))
    cacheDir = await mkdtemp(join(tmpdir(), 'codeburn-context-cache-'))
    process.env['HOME'] = homeDir
    process.env['CODEBURN_CACHE_DIR'] = cacheDir
    delete process.env['CLAUDE_CONFIG_DIR']

    const projectDir = join(homeDir, '.claude', 'projects', '-tmp-fixture-project')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, `${SESSION_ID}.jsonl`), JSON.stringify({
      type: 'assistant',
      sessionId: SESSION_ID,
      timestamp: '2026-07-01T00:00:00.000Z',
      cwd: '/tmp/fixture-project',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }) + '\n')

    server = await runWebDashboard({
      period: 'today', provider: 'all', project: [], exclude: [], port: 0, open: false,
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(homeDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('resolves a full session id (control case)', async () => {
    const res = await fetch(`${base}/api/context/tree?provider=claude&id=${SESSION_ID}`)
    expect(res.status).toBe(200)
    const payload = await res.json() as { session: { sessionId: string } }
    expect(payload.session.sessionId).toBe(SESSION_ID)
  })

  it('resolves an 8-char session id prefix, matching the CLI', async () => {
    const res = await fetch(`${base}/api/context/tree?provider=claude&id=${SESSION_PREFIX}`)
    expect(res.status).toBe(200)
    const payload = await res.json() as { session: { sessionId: string } }
    expect(payload.session.sessionId).toBe(SESSION_ID)
  })

  it('still 404s for an id that matches nothing', async () => {
    const res = await fetch(`${base}/api/context/tree?provider=claude&id=deadbeef`)
    expect(res.status).toBe(404)
  })
})
