import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { spawnSync } from 'node:child_process'

vi.setConfig({ testTimeout: 30_000 })

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  const fs = await vi.importActual<typeof import('fs')>('fs')
  const fakeHome = fs.mkdtempSync(actual.tmpdir() + '/metrora-optimize-authority-home-')
  fs.mkdirSync(fakeHome + '/.claude', { recursive: true })
  process.env['METRORA_TEST_OPTIMIZE_AUTHORITY_HOME'] = fakeHome
  return { ...actual, homedir: () => fakeHome }
})

const FAKE_HOME = process.env['METRORA_TEST_OPTIMIZE_AUTHORITY_HOME']!
const roots = [FAKE_HOME]
let fixtureNumber = 0

import { runOptimizeApply } from '../src/act/optimize-apply.js'
import { scanAndDetect } from '../src/optimize.js'
import type { ProjectSummary } from '../src/types.js'

type Fixture = {
  root: string
  project: ProjectSummary
  skillPath: string
  claudeProjectDir: string
  actionsDir: string
}

function makeProjectSummary(name: string, projectPath: string): ProjectSummary {
  return {
    project: name,
    projectPath,
    sessions: [{
      sessionId: `${name}-summary-session`,
      project: name,
      firstTimestamp: '2026-08-01T00:00:00.000Z',
      lastTimestamp: '2026-08-01T00:01:00.000Z',
      totalCostUSD: 1,
      totalSavingsUSD: 0,
      totalInputTokens: 100,
      totalOutputTokens: 20,
      totalReasoningTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      apiCalls: 1,
      turns: [],
      modelBreakdown: {},
      toolBreakdown: {},
      mcpBreakdown: {},
      bashBreakdown: {},
      categoryBreakdown: {},
      skillBreakdown: {},
      subagentBreakdown: {},
    }],
    totalCostUSD: 1,
    totalSavingsUSD: 0,
    totalApiCalls: 1,
    totalProxiedCostUSD: 0,
  }
}

function makeFixture(): Fixture {
  const id = `${++fixtureNumber}-${Date.now()}`
  const root = mkdtempSync(join(tmpdir(), 'metrora-optimize-authority-'))
  roots.push(root)
  const projectPath = join(root, 'project')
  mkdirSync(projectPath, { recursive: true })

  const claudeProjectDir = join(FAKE_HOME, '.claude', 'projects', `authority-${id}`)
  mkdirSync(claudeProjectDir, { recursive: true })
  writeFileSync(join(claudeProjectDir, 'session.jsonl'), JSON.stringify({
    type: 'user',
    sessionId: `claude-${id}`,
    timestamp: '2026-08-01T00:00:00.000Z',
    message: { role: 'user', content: 'inspect the project' },
  }) + '\n')

  const codexSessionDir = join(FAKE_HOME, '.codex', 'sessions', '2026', '08', '01')
  mkdirSync(codexSessionDir, { recursive: true })
  const codexSessionId = 'codex-' + id
  writeFileSync(join(codexSessionDir, 'rollout-' + id + '.jsonl'), [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-08-01T10:00:00.000Z', payload: { session_id: codexSessionId, model: 'gpt-5.3-codex', cwd: projectPath, originator: 'codex-cli' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-08-01T10:00:01.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inspect the project' }] } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-01T10:00:02.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } }),
  ].join('\n') + '\n')
  const skillPath = join(FAKE_HOME, '.claude', 'skills', `authority-unused-${id}`, 'SKILL.md')
  mkdirSync(join(skillPath, '..'), { recursive: true })
  writeFileSync(skillPath, '# Disposable unused skill\n')

  return {
    root,
    project: makeProjectSummary(`authority-${id}`, projectPath),
    skillPath,
    claudeProjectDir,
    actionsDir: join(root, 'actions'),
  }
}

function sink(): Writable {
  return new Writable({ write(_chunk, _encoding, callback) { callback() } })
}

function findingIds(result: Awaited<ReturnType<typeof scanAndDetect>>): string[] {
  return result.findings.map(finding => finding.id)
}

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  const configDir = join(FAKE_HOME, 'metrora-config')
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: FAKE_HOME,
      USERPROFILE: FAKE_HOME,
      HOMEPATH: FAKE_HOME,
      HOMEDRIVE: '',
      APPDATA: join(FAKE_HOME, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(FAKE_HOME, 'AppData', 'Local'),
      CLAUDE_CONFIG_DIR: join(FAKE_HOME, '.claude'),
      CODEX_HOME: join(FAKE_HOME, '.codex'),
      METRORA_CACHE_DIR: join(FAKE_HOME, 'metrora-cache'),
      METRORA_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: join(FAKE_HOME, '.config'),
      XDG_DATA_HOME: join(FAKE_HOME, '.local', 'share'),
      OPENCODE_DATA_DIR: join(FAKE_HOME, '.local', 'share', 'opencode'),
      TZ: 'UTC',
    },
    encoding: 'utf-8',
    timeout: 30_000,
  })
}

function cleanupFixture(fixture: Fixture): void {
  rmSync(fixture.claudeProjectDir, { recursive: true, force: true })
  rmSync(join(fixture.skillPath, '..', '..'), { recursive: true, force: true })
  rmSync(fixture.root, { recursive: true, force: true })
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('Optimize provider authority', () => {
  it('distinguishes Claude observed-empty evidence from non-Claude NOT_SCANNED', async () => {
    const fixture = makeFixture()
    try {
      const projects = [fixture.project]
      const claude = await scanAndDetect(projects, undefined, 'claude')
      const codex = await scanAndDetect(projects, undefined, 'codex')
      const all = await scanAndDetect(projects, undefined, 'all')

      // Claude was actually scanned and found no Skill invocation, so the
      // disposable skill is a valid unused-skills control finding.
      expect(findingIds(claude)).toContain('unused-skills')
      // Codex intentionally skipped the Claude transcript/config scan. It must
      // not reinterpret that absence as zero Claude usage.
      expect(findingIds(codex)).not.toContain('unused-skills')
      expect(findingIds(codex)).not.toContain('unused-agents')
      expect(findingIds(codex)).not.toContain('unused-commands')
      // All-provider mode retains the real Claude evidence.
      expect(findingIds(all)).toContain('unused-skills')
    } finally {
      cleanupFixture(fixture)
    }
  })

  it('isolates cached Claude, Codex, and all-provider results in either order', async () => {
    const fixture = makeFixture()
    try {
      const firstProjects = [fixture.project]
      const claudeFirst = await scanAndDetect(firstProjects, undefined, 'claude')
      const codexAfterClaude = await scanAndDetect(firstProjects, undefined, 'codex')
      expect(findingIds(claudeFirst)).toContain('unused-skills')
      expect(findingIds(codexAfterClaude)).not.toContain('unused-skills')

      const reverseProjects = [makeProjectSummary('reverse-cache', fixture.project.projectPath)]
      const codexFirst = await scanAndDetect(reverseProjects, undefined, 'codex')
      const claudeAfterCodex = await scanAndDetect(reverseProjects, undefined, 'claude')
      const allAfterClaude = await scanAndDetect(reverseProjects, undefined, 'all')
      expect(findingIds(codexFirst)).not.toContain('unused-skills')
      expect(findingIds(claudeAfterCodex)).toContain('unused-skills')
      expect(findingIds(allAfterClaude)).toContain('unused-skills')
    } finally {
      cleanupFixture(fixture)
    }
  })

  it('keeps Codex dry-run and real apply from planning or mutating Claude state', async () => {
    const fixture = makeFixture()
    const before = readFileSync(fixture.skillPath)
    try {
      await runOptimizeApply([fixture.project], undefined, {
        provider: 'codex',
        dryRun: true,
        actionsDir: fixture.actionsDir,
        output: sink(),
        errorOutput: sink(),
      })
      expect(readFileSync(fixture.skillPath)).toEqual(before)
      expect(existsSync(fixture.actionsDir)).toBe(false)

      await runOptimizeApply([fixture.project], undefined, {
        provider: 'codex',
        yes: true,
        actionsDir: fixture.actionsDir,
        output: sink(),
        errorOutput: sink(),
      })
      expect(readFileSync(fixture.skillPath)).toEqual(before)
      expect(existsSync(fixture.actionsDir)).toBe(false)
    } finally {
      cleanupFixture(fixture)
    }
  })

  it('keeps CLI text, JSON, dry-run, and real apply provider-consistent', () => {
    const fixture = makeFixture()
    const before = readFileSync(fixture.skillPath)
    const args = ['optimize', '--provider', 'codex', '--from', '2026-08-01', '--to', '2026-08-01']
    try {
      const text = runCli(args)
      const json = runCli([...args, '--format', 'json'])
      const dryRun = runCli([...args, '--apply', '--dry-run'])
      const apply = runCli([...args, '--apply', '--yes'])

      expect(text.status).toBe(0)
      expect(json.status).toBe(0)
      expect(dryRun.status).toBe(0)
      expect(apply.status).toBe(0)
      expect(text.stdout).not.toContain('unused-skills')
      expect(text.stdout).not.toContain('.claude')
      const report = JSON.parse(json.stdout) as { summary: { findingCount: number }; findings: unknown[] }
      expect(report.summary.findingCount).toBe(0)
      expect(report.findings).toEqual([])
      expect(dryRun.stdout).not.toContain('unused-skills')
      expect(dryRun.stdout).not.toContain('.claude')
      expect(apply.stdout).not.toContain('unused-skills')
      expect(readFileSync(fixture.skillPath)).toEqual(before)
      expect(existsSync(join(FAKE_HOME, 'metrora-config', 'actions'))).toBe(false)
    } finally {
      cleanupFixture(fixture)
    }
  })
  it('keeps a real Claude finding actionable in dry-run and leaves it unmutated', async () => {
    const fixture = makeFixture()
    const before = readFileSync(fixture.skillPath)
    let output = ''
    const capture = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback() } })
    try {
      await runOptimizeApply([fixture.project], undefined, {
        provider: 'claude',
        dryRun: true,
        actionsDir: fixture.actionsDir,
        output: capture,
        errorOutput: sink(),
      })
      expect(output).toContain('Appliable config-class fixes:')
      expect(output).toContain('unused')
      expect(readFileSync(fixture.skillPath)).toEqual(before)
      expect(existsSync(fixture.actionsDir)).toBe(false)
    } finally {
      cleanupFixture(fixture)
    }
  })
})
