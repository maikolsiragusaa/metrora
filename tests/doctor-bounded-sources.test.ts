import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectDoctorReport, renderDoctorJson, renderDoctorTable } from '../src/doctor.js'
import { classifyDoctorError, DOCTOR_SOURCE_STATES, inspectPath, redactOverridePath, redactText } from '../src/doctor-source-diagnostics.js'
import { getCopilotDoctorProbeRoots } from '../src/providers/copilot-paths.js'
import { createCodebuffProvider } from '../src/providers/codebuff.js'
import { createMistralVibeProvider } from '../src/providers/mistral-vibe.js'
import { createCopilotProvider } from '../src/providers/copilot.js'
import { getCursorDoctorProbeRoots, getCursorWorkspaceStorageDir } from '../src/providers/cursor-paths.js'
import { createCursorProvider } from '../src/providers/cursor.js'
import { getKiroDoctorProbeRoots } from '../src/providers/kiro-paths.js'
import { createKiroProvider } from '../src/providers/kiro.js'
import { PROVIDER_ENV_VARS, emptyCache, sessionCachePath } from '../src/session-cache.js'
import type { Provider } from '../src/providers/types.js'

const requireForTest = createRequire(import.meta.url)
type TestDb = { exec(sql: string): void; close(): void }

function createDb(path: string, sql: string): void {
  const { DatabaseSync } = requireForTest('node:sqlite') as { DatabaseSync: new (path: string) => TestDb }
  const db = new DatabaseSync(path)
  db.exec(sql)
  db.close()
}

function only(report: Awaited<ReturnType<typeof collectDoctorReport>>, name: string) {
  const row = report.providers.find(provider => provider.provider === name)
  if (!row) throw new Error(`missing Doctor row for ${name}`)
  return row
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'metrora-doctor-bounded-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('bounded source diagnostic primitive', () => {
  it('keeps all state categories explicit and does not leak unknown paths', async () => {
    expect(DOCTOR_SOURCE_STATES).toEqual([
      'PRESENT', 'PRESENT_EMPTY', 'MISSING', 'INACCESSIBLE', 'MALFORMED', 'UNSUPPORTED_VARIANT', 'UNKNOWN',
    ])
    expect(classifyDoctorError({ code: 'EACCES' }).state).toBe('INACCESSIBLE')
    expect(classifyDoctorError(new SyntaxError('invalid JSON')).state).toBe('MALFORMED')
    expect(classifyDoctorError({ message: 'database is locked' }).state).toBe('UNKNOWN')
    expect(redactText("open 'C:\\Users\\fixture\\Private Workspace\\cache.json'"))
      .not.toContain('fixture')
    const provider: Provider = {
      name: 'codex',
      displayName: 'Codex',
      modelDisplayName: model => model,
      toolDisplayName: tool => tool,
      probeRoots: async () => [
        { path: join(root, 'missing'), label: 'missing-family' },
        { path: root, label: 'empty-family' },
      ],
      discoverSessions: async () => [],
      createSessionParser: () => ({ async *parse() {} }),
    }
    const row = only(await collectDoctorReport('codex', { providers: [provider], cache: emptyCache() }), 'codex')
    expect(row.families.map(family => family.state)).toEqual(['MISSING', 'PRESENT_EMPTY'])
    expect(row.families.every(family => family.root === '<redacted-path>')).toBe(true)
  })

  it('caps generic directory evidence at the bounded entry limit', async () => {
    const largeRoot = join(root, 'large-root')
    await mkdir(largeRoot, { recursive: true })
    await Promise.all(Array.from({ length: 140 }, (_, index) => writeFile(join(largeRoot, `entry-${index}`), 'x')))
    const probe = await inspectPath(largeRoot)
    expect(probe.state).toBe('PRESENT')
    expect(probe.entries).toHaveLength(128)
  })

  it('does not migrate a legacy cache while loading a read-only Doctor report', async () => {
    const cacheDir = join(root, 'cache')
    const legacyPath = join(cacheDir, 'session-cache.json')
    vi.stubEnv('METRORA_CACHE_DIR', cacheDir)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(legacyPath, JSON.stringify(emptyCache()))
    const provider: Provider = {
      name: 'codex',
      displayName: 'Codex',
      modelDisplayName: model => model,
      toolDisplayName: tool => tool,
      discoverSessions: async () => [],
      createSessionParser: () => ({ async *parse() {} }),
    }

    await collectDoctorReport('codex', { providers: [provider], sampleLimit: 0 })
    await expect(stat(legacyPath)).resolves.toBeTruthy()
    await expect(stat(sessionCachePath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('redacts override values and source paths in both output modes', async () => {
    const secretPath = 'C:\\Users\\fixture\\Private Workspace\\cache.json'
    vi.stubEnv('CODEX_HOME', secretPath)
    const provider: Provider = {
      name: 'codex',
      displayName: 'Codex',
      modelDisplayName: model => model,
      toolDisplayName: tool => tool,
      probeRoots: async () => [{ path: secretPath, label: 'sessions' }],
      discoverSessions: async () => [],
      createSessionParser: () => ({ async *parse() {} }),
    }
    const report = await collectDoctorReport('codex', { providers: [provider], cache: emptyCache() })
    expect(report.providers[0]?.envOverrides).toEqual([{ name: 'CODEX_HOME' }])
    expect(renderDoctorJson(report)).not.toContain('fixture')
    expect(renderDoctorTable(report, { color: false })).not.toContain('Private Workspace')
  })

  it.each([
    ['Windows absolute', 'C:\\Users\\fixture\\AppData\\Roaming\\Private Workspace\\session'],
    ['Unix absolute', '/home/fixture/.config/private/workspace/session'],
    ['UNC', '\\\\server\\share\\fixture\\private\\workspace'],
    ['home', 'C:\\Users\\fixture'],
    ['APPDATA', 'C:\\Users\\fixture\\AppData\\Roaming\\private\\workspace'],
    ['LOCALAPPDATA', 'C:\\Users\\fixture\\AppData\\Local\\private\\workspace'],
    ['XDG config', '/home/fixture/.config/private/workspace'],
    ['XDG data', '/home/fixture/.local/share/private/workspace'],
    ['outside standard roots', 'D:\\private\\workspace\\session'],
    ['username component', '/srv/fixture/private/cache'],
    ['workspace-like suffix', 'C:\\Users\\fixture\\workspace-like\\project'],
    ['nested private suffix', '/home/fixture/private/one/two/three'],
    ['already symbolic', '%APPDATA%/SomePrivateWorkspace/session'],
    ['relative safe label', 'relative-safe-label'],
  ])('fully redacts %s override values', (_label, secretPath) => {
    expect(redactOverridePath(secretPath)).toBe('<override-path>')
  })

  it('keeps Kiro override diagnostics useful without emitting the configured value', async () => {
    const secretPath = join(root, 'Private Workspace', 'nested', 'session')
    vi.stubEnv('KIRO_HOME', secretPath)
    const provider: Provider = {
      name: 'kiro',
      displayName: 'Kiro',
      modelDisplayName: model => model,
      toolDisplayName: tool => tool,
      probeRoots: async () => [{ path: secretPath, label: 'cli' }],
      discoverSessions: async () => [],
      createSessionParser: () => ({ async *parse() {} }),
    }

    const report = await collectDoctorReport('kiro', { providers: [provider], cache: emptyCache() })
    const row = only(report, 'kiro')
    const json = renderDoctorJson(report)
    const table = renderDoctorTable(report, { color: false })

    expect(row.envOverrides).toEqual([{ name: 'KIRO_HOME' }])
    expect(row.families[0]).toMatchObject({ root: '<override-path>', override: 'KIRO_HOME' })
    expect(json).not.toContain(secretPath)
    expect(table).not.toContain(secretPath)
    expect(json).toContain('<override-path>')
    expect(table).toContain('override KIRO_HOME')
  })

  it('redacts relative override values from provider errors too', async () => {
    const secretValue = 'relative-private-label'
    vi.stubEnv('CODEX_HOME', secretValue)
    const provider: Provider = {
      name: 'codex',
      displayName: 'Codex',
      modelDisplayName: model => model,
      toolDisplayName: tool => tool,
      probeRoots: async () => { throw new Error(`cannot inspect ${secretValue}`) },
      discoverSessions: async () => [],
      createSessionParser: () => ({ async *parse() {} }),
    }

    const report = await collectDoctorReport('codex', { providers: [provider], cache: emptyCache() })
    const json = renderDoctorJson(report)
    const table = renderDoctorTable(report, { color: false })

    expect(json).not.toContain(secretValue)
    expect(table).not.toContain(secretValue)
    expect(json).toContain('<override-path>')
  })
})

describe('Codebuff and Mistral Vibe Doctor families', () => {
  it('distinguishes a Codebuff override as missing, empty, and present without leaking the path', async () => {
    const codebuffRoot = join(root, 'private-codebuff-root')
    vi.stubEnv('CODEBUFF_DATA_DIR', codebuffRoot)
    const provider = createCodebuffProvider()

    let row = only(await collectDoctorReport('codebuff', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'codebuff')
    expect(row.families[0]).toMatchObject({
      family: 'data',
      state: 'MISSING',
      root: '<override-path>',
      override: 'CODEBUFF_DATA_DIR',
    })
    expect(row.verdict).toContain('source is missing')

    await mkdir(codebuffRoot, { recursive: true })
    row = only(await collectDoctorReport('codebuff', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'codebuff')
    expect(row.families[0]?.state).toBe('PRESENT_EMPTY')

    await writeFile(join(codebuffRoot, 'read-only-marker'), 'present')
    row = only(await collectDoctorReport('codebuff', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'codebuff')
    expect(row.families[0]?.state).toBe('PRESENT')

    const json = renderDoctorJson({ generatedAt: new Date().toISOString(), providers: [row] })
    const table = renderDoctorTable({ generatedAt: new Date().toISOString(), providers: [row] }, { color: false })
    expect(json).not.toContain(codebuffRoot)
    expect(table).not.toContain(codebuffRoot)
  })

  it('distinguishes a Mistral Vibe VIBE_HOME root as missing, empty, and present', async () => {
    const vibeHome = join(root, 'private-vibe-home')
    const sessionsRoot = join(vibeHome, 'logs', 'session')
    vi.stubEnv('VIBE_HOME', vibeHome)
    const provider = createMistralVibeProvider()

    let row = only(await collectDoctorReport('mistral-vibe', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'mistral-vibe')
    expect(row.families[0]).toMatchObject({
      family: 'session',
      state: 'MISSING',
      root: '<override-path>',
      override: 'VIBE_HOME',
    })

    await mkdir(sessionsRoot, { recursive: true })
    row = only(await collectDoctorReport('mistral-vibe', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'mistral-vibe')
    expect(row.families[0]?.state).toBe('PRESENT_EMPTY')

    await writeFile(join(sessionsRoot, 'read-only-marker'), 'present')
    row = only(await collectDoctorReport('mistral-vibe', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'mistral-vibe')
    expect(row.families[0]?.state).toBe('PRESENT')
  })
})

describe('Cursor Doctor families', () => {
  it('uses global state plus sibling workspace storage and ignores XDG_DATA_HOME for discovery', async () => {
    const dbPath = join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    vi.stubEnv('XDG_DATA_HOME', join(root, 'wrong-xdg-data'))
    expect(getCursorDoctorProbeRoots(dbPath)).toEqual([
      { path: dbPath, label: 'global-state' },
      { path: getCursorWorkspaceStorageDir(dbPath), label: 'workspace-storage' },
    ])
    expect(getCursorDoctorProbeRoots(dbPath).every(probe => !probe.path.includes('wrong-xdg-data'))).toBe(true)
  })

  it('classifies missing, empty, present, malformed and unsupported global state', async () => {
    const dbPath = join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    const provider = createCursorProvider(dbPath)

    let row = only(await collectDoctorReport('cursor', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'cursor')
    expect(row.families.find(family => family.family === 'global-state')?.state).toBe('MISSING')

    await mkdir(join(root, 'Cursor', 'User', 'globalStorage'), { recursive: true })
    createDb(dbPath, 'CREATE TABLE cursorDiskKV (key TEXT, value TEXT)')
    row = only(await collectDoctorReport('cursor', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'cursor')
    expect(row.families.find(family => family.family === 'global-state')?.state).toBe('PRESENT_EMPTY')

    createDb(dbPath, "INSERT INTO cursorDiskKV (key, value) VALUES ('bubbleId:composer:uuid', '{}')")
    row = only(await collectDoctorReport('cursor', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'cursor')
    expect(row.families.find(family => family.family === 'global-state')?.state).toBe('PRESENT')

    await writeFile(dbPath, 'not a sqlite database')
    row = only(await collectDoctorReport('cursor', { providers: [provider], cache: emptyCache(), sampleLimit: 0 }), 'cursor')
    expect(row.families.find(family => family.family === 'global-state')?.state).toBe('MALFORMED')

    const unsupportedPath = join(root, 'Cursor', 'User', 'globalStorage', 'unsupported.vscdb')
    createDb(unsupportedPath, 'CREATE TABLE unrelated (id INTEGER)')
    row = only(await collectDoctorReport('cursor', {
      providers: [createCursorProvider(unsupportedPath)],
      cache: emptyCache(),
      sampleLimit: 0,
    }), 'cursor')
    expect(row.families.find(family => family.family === 'global-state')?.state).toBe('UNSUPPORTED_VARIANT')
  })
})

describe('Kiro Doctor families', () => {
  it('reports legacy, workspace, CLI and v2 roots separately without making optional absence fatal', async () => {
    const agent = join(root, 'kiro-agent')
    const workspace = join(root, 'workspace-storage')
    const cli = join(root, 'sessions', 'cli')
    const v2 = join(root, 'sessions')
    await mkdir(agent, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await mkdir(cli, { recursive: true })
    await mkdir(v2, { recursive: true })
    const paths = getKiroDoctorProbeRoots(agent, workspace, cli, v2)
    expect(paths.map(path => path.label)).toEqual(['legacy-ide', 'workspace-storage', 'cli', 'kiro-v2'])
    const row = only(await collectDoctorReport('kiro', {
      providers: [createKiroProvider(agent, workspace, cli, v2)],
      cache: emptyCache(),
      sampleLimit: 0,
    }), 'kiro')
    expect(row.families.map(family => family.state)).toEqual(['PRESENT_EMPTY', 'PRESENT_EMPTY', 'PRESENT_EMPTY', 'PRESENT_EMPTY'])
    expect(row.status).toBe('empty')
    expect(PROVIDER_ENV_VARS.kiro).toContain('KIRO_HOME')
  })

  it('classifies malformed CLI JSON without changing Kiro discovery', async () => {
    const agent = join(root, 'kiro-agent')
    const workspace = join(root, 'workspace-storage')
    const cli = join(root, 'sessions', 'cli')
    await mkdir(cli, { recursive: true })
    await writeFile(join(cli, 'broken.jsonl'), '{broken\n')
    const row = only(await collectDoctorReport('kiro', {
      providers: [createKiroProvider(agent, workspace, cli, join(root, 'sessions'))],
      cache: emptyCache(),
      sampleLimit: 0,
    }), 'kiro')
    expect(row.families.find(family => family.family === 'cli')?.state).toBe('MALFORMED')
    expect(row.families.some(family => family.family === 'workspace-storage' && family.state === 'MISSING')).toBe(true)
  })
})

describe('Copilot Doctor families', () => {
  it('redacts every explicit Copilot source override without changing family discovery', async () => {
    const values = {
      otel: join(root, 'private-otel', 'agent-traces.db'),
      session: join(root, 'private-copilot', 'session-state'),
      workspace: join(root, 'private-workspace'),
      global: join(root, 'private-global'),
      jetbrains: join(root, 'private-jetbrains'),
    }
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', values.otel)
    vi.stubEnv('METRORA_COPILOT_SESSION_STATE_DIR', values.session)
    vi.stubEnv('METRORA_COPILOT_WS_STORAGE_DIR', values.workspace)
    vi.stubEnv('METRORA_COPILOT_GLOBAL_STORAGE_DIR', values.global)
    vi.stubEnv('METRORA_COPILOT_JETBRAINS_DIR', values.jetbrains)

    const report = await collectDoctorReport('copilot', {
      providers: [createCopilotProvider()],
      cache: emptyCache(),
      sampleLimit: 0,
    })
    const row = only(report, 'copilot')
    const json = renderDoctorJson(report)
    const table = renderDoctorTable(report, { color: false })

    expect(row.envOverrides).toEqual(expect.arrayContaining([
      { name: 'METRORA_COPILOT_OTEL_DB' },
      { name: 'METRORA_COPILOT_SESSION_STATE_DIR' },
      { name: 'METRORA_COPILOT_WS_STORAGE_DIR' },
      { name: 'METRORA_COPILOT_GLOBAL_STORAGE_DIR' },
      { name: 'METRORA_COPILOT_JETBRAINS_DIR' },
    ]))
    expect(row.families).toHaveLength(5)
    expect(row.families.every(family => family.root === '<override-path>')).toBe(true)
    expect(row.families.map(family => family.override)).toEqual([
      'METRORA_COPILOT_OTEL_DB',
      'METRORA_COPILOT_SESSION_STATE_DIR',
      'METRORA_COPILOT_WS_STORAGE_DIR',
      'METRORA_COPILOT_GLOBAL_STORAGE_DIR',
      'METRORA_COPILOT_JETBRAINS_DIR',
    ])
    for (const value of Object.values(values)) {
      expect(json).not.toContain(value)
      expect(table).not.toContain(value)
    }
  })

  it('keeps OTel, CLI, VS Code, empty-window and JetBrains lanes separate', async () => {
    const otel = join(root, 'agent-traces.db')
    const cli = join(root, 'cli')
    const workspace = join(root, 'workspace')
    const global = join(root, 'global')
    const jetbrains = join(root, 'jetbrains')
    await mkdir(cli, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await mkdir(global, { recursive: true })
    await mkdir(join(global, 'emptyWindowChatSessions'), { recursive: true })
    await mkdir(jetbrains, { recursive: true })
    createDb(otel, `
      CREATE TABLE spans (span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, operation_name TEXT, start_time_ms INTEGER, response_model TEXT);
      CREATE TABLE span_attributes (id INTEGER PRIMARY KEY, span_id TEXT, key TEXT, value TEXT);
    `)
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', otel)
    const roots = getCopilotDoctorProbeRoots(cli, workspace, global, jetbrains)
    expect(roots.map(root => root.label)).toEqual([
      'otel-agent-traces', 'cli-session-state', 'vscode-workspace-storage',
      'empty-window-global-storage', 'jetbrains',
    ])
    const row = only(await collectDoctorReport('copilot', {
      providers: [createCopilotProvider(cli, workspace, global, jetbrains)],
      cache: emptyCache(),
      sampleLimit: 0,
    }), 'copilot')
    expect(row.families.find(family => family.family === 'otel-agent-traces')?.state).toBe('PRESENT_EMPTY')
    expect(row.families.filter(family => family.family !== 'otel-agent-traces').every(family => family.state === 'PRESENT_EMPTY')).toBe(true)
  })

  it('fails closed for a corrupt OTel database but keeps other lanes diagnostic', async () => {
    const otel = join(root, 'agent-traces.db')
    const cli = join(root, 'cli')
    await mkdir(cli, { recursive: true })
    await writeFile(otel, 'corrupt')
    vi.stubEnv('METRORA_COPILOT_OTEL_DB', otel)
    const row = only(await collectDoctorReport('copilot', {
      providers: [createCopilotProvider(cli, join(root, 'workspace'), join(root, 'global'), join(root, 'jetbrains'))],
      cache: emptyCache(),
      sampleLimit: 0,
    }), 'copilot')
    expect(row.families.find(family => family.family === 'otel-agent-traces')?.state).toBe('MALFORMED')
    expect(row.families.find(family => family.family === 'cli-session-state')?.state).toBe('PRESENT_EMPTY')
    expect(row.families.some(family => family.family === 'jetbrains')).toBe(true)
  })
})
