import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectDoctorReport, renderDoctorJson, renderDoctorTable } from '../src/doctor.js'
import { classifyDoctorError, DOCTOR_SOURCE_STATES, redactText } from '../src/doctor-source-diagnostics.js'
import { getCopilotDoctorProbeRoots } from '../src/providers/copilot-paths.js'
import { createCopilotProvider } from '../src/providers/copilot.js'
import { getCursorDoctorProbeRoots, getCursorWorkspaceStorageDir } from '../src/providers/cursor-paths.js'
import { createCursorProvider } from '../src/providers/cursor.js'
import { getKiroDoctorProbeRoots } from '../src/providers/kiro-paths.js'
import { createKiroProvider } from '../src/providers/kiro.js'
import { PROVIDER_ENV_VARS, emptyCache } from '../src/session-cache.js'
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
    expect(redactText("open 'C:\\Users\\alice\\Private Workspace\\cache.json'"))
      .not.toContain('alice')
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

  it('redacts override values and source paths in both output modes', async () => {
    const secretPath = 'C:\\Users\\alice\\Private Workspace\\cache.json'
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
    expect(renderDoctorJson(report)).not.toContain('alice')
    expect(renderDoctorTable(report, { color: false })).not.toContain('Private Workspace')
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
