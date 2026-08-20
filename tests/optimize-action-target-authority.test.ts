import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { Writable } from 'node:stream'

import { runAction } from '../src/act/apply.js'
import { undoAction } from '../src/act/undo.js'
import { planFindings, planFor, type PlanContext } from '../src/act/plans.js'
import { runOptimizeApply } from '../src/act/optimize-apply.js'
import { ACTION_TARGET_AUTHORITY, FINDING_EVIDENCE_REQUIREMENT } from '../src/optimize-provider-authority.js'
import { scanAndDetect, type FindingApply, type FindingId, type WasteAction, type WasteFinding } from '../src/optimize.js'
import type { ActionKind } from '../src/act/types.js'
import type { ProjectSummary } from '../src/types.js'

vi.setConfig({ testTimeout: 30_000 })

const roots: string[] = []
const CMD_FIX: WasteAction = { type: 'command', label: '', text: '' }

type Fixture = {
  root: string
  home: string
  project: string
  claudeJson: string
  projectMcp: string
  settings: string
  keeper: string
  actionsDir: string
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'metrora-action-target-'))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(project, { recursive: true })
  return {
    root,
    home,
    project,
    claudeJson: join(home, '.claude.json'),
    projectMcp: join(project, '.mcp.json'),
    settings: join(project, '.claude', 'settings.json'),
    keeper: join(root, 'keeper'),
    actionsDir: join(root, 'actions'),
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function makeFinding(id: FindingId, fix: WasteAction, apply?: FindingApply): WasteFinding {
  return { id, title: id, explanation: '', impact: 'medium', tokensSaved: 1000, fix, ...(apply ? { apply } : {}) }
}

function context(fx: Fixture, provider: string): PlanContext {
  return {
    homeDir: fx.home,
    cwd: fx.project,
    shell: '/bin/zsh',
    provider,
    claudeVersion: () => '2.1.130',
  }
}

type Io = {
  output: Writable
  errorOutput: Writable
  stdout: () => string
  stderr: () => string
}

function captureIo(): Io {
  let stdout = ''
  let stderr = ''
  return {
    output: new Writable({ write(chunk, _encoding, callback) { stdout += chunk.toString(); callback() } }),
    errorOutput: new Writable({ write(chunk, _encoding, callback) { stderr += chunk.toString(); callback() } }),
    stdout: () => stdout.replace(/\u001b\[[0-9;]*m/g, ''),
    stderr: () => stderr.replace(/\u001b\[[0-9;]*m/g, ''),
  }
}

function mcpRemoveSetup(fx: Fixture): void {
  writeJson(fx.claudeJson, { mcpServers: { server: { command: 'node' } } })
}

type PlanCase = {
  name: string
  finding: (fx: Fixture) => WasteFinding
  setup: (fx: Fixture) => void
  actionKind: ActionKind
  authority: 'claude-targeted' | 'provider-neutral'
}

const planCases: PlanCase[] = [
  {
    name: 'mcp-low-coverage',
    setup: mcpRemoveSetup,
    finding: () => makeFinding('mcp-low-coverage', CMD_FIX, { kind: 'mcp-remove', servers: ['server'] }),
    actionKind: 'mcp-remove',
    authority: 'claude-targeted',
  },
  {
    name: 'build-folder-reads',
    setup: () => {},
    finding: () => makeFinding('build-folder-reads', {
      type: 'paste',
      destination: 'claude-md',
      label: '',
      text: 'Avoid generated folders.',
    }),
    actionKind: 'claude-md-rule',
    authority: 'claude-targeted',
  },
  {
    name: 'unused-mcp',
    setup: mcpRemoveSetup,
    finding: () => makeFinding('unused-mcp', CMD_FIX, { kind: 'mcp-remove', servers: ['server'] }),
    actionKind: 'mcp-remove',
    authority: 'claude-targeted',
  },
  {
    name: 'mcp-project-scope',
    setup: fx => {
      mcpRemoveSetup(fx)
      mkdirSync(fx.keeper, { recursive: true })
    },
    finding: fx => makeFinding('mcp-project-scope', CMD_FIX, {
      kind: 'mcp-project-scope',
      servers: [{ server: 'server', keepProjects: [fx.keeper], removeProjects: [] }],
    }),
    actionKind: 'mcp-project-scope',
    authority: 'claude-targeted',
  },
  {
    name: 'mcp-deferral-off',
    setup: fx => writeJson(fx.settings, { env: { ENABLE_TOOL_SEARCH: 'false' } }),
    finding: fx => makeFinding('mcp-deferral-off', CMD_FIX, {
      kind: 'defer-enable',
      cause: 'env-false',
      settingPath: fx.settings,
      settingScope: 'settings',
      value: 'false',
    }),
    actionKind: 'defer-enable',
    authority: 'claude-targeted',
  },
  {
    name: 'mcp-alwaysload-hygiene',
    setup: fx => writeJson(fx.projectMcp, { mcpServers: { server: { command: 'node', alwaysLoad: true } } }),
    finding: fx => makeFinding('mcp-alwaysload-hygiene', CMD_FIX, {
      kind: 'defer-alwaysload',
      servers: [{ server: 'server', paths: [fx.projectMcp] }],
    }),
    actionKind: 'defer-alwaysload',
    authority: 'claude-targeted',
  },
  {
    name: 'mcp-defer-threshold',
    setup: fx => writeJson(fx.settings, { env: { ENABLE_TOOL_SEARCH: 'auto:50' } }),
    finding: fx => makeFinding('mcp-defer-threshold', CMD_FIX, {
      kind: 'defer-threshold',
      settingPath: fx.settings,
      settingScope: 'settings',
      value: 'auto:50',
      recommendedPercent: 10,
      removeOverride: false,
    }),
    actionKind: 'defer-threshold',
    authority: 'claude-targeted',
  },
  {
    name: 'unused-skills',
    setup: fx => {
      mkdirSync(join(fx.home, '.claude', 'skills', 'skill'), { recursive: true })
      writeFileSync(join(fx.home, '.claude', 'skills', 'skill', 'SKILL.md'), 'skill\n')
    },
    finding: () => makeFinding('unused-skills', CMD_FIX, { kind: 'archive', names: ['skill'] }),
    actionKind: 'archive-skill',
    authority: 'claude-targeted',
  },
  {
    name: 'unused-agents',
    setup: fx => {
      mkdirSync(join(fx.home, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(fx.home, '.claude', 'agents', 'agent.md'), 'agent\n')
    },
    finding: () => makeFinding('unused-agents', CMD_FIX, { kind: 'archive', names: ['agent'] }),
    actionKind: 'archive-agent',
    authority: 'claude-targeted',
  },
  {
    name: 'unused-commands',
    setup: fx => {
      mkdirSync(join(fx.home, '.claude', 'commands'), { recursive: true })
      writeFileSync(join(fx.home, '.claude', 'commands', 'command.md'), 'command\n')
    },
    finding: () => makeFinding('unused-commands', CMD_FIX, { kind: 'archive', names: ['command'] }),
    actionKind: 'archive-command',
    authority: 'claude-targeted',
  },
  {
    name: 'claude-md-rule',
    setup: () => {},
    finding: () => makeFinding('read-edit-ratio', {
      type: 'paste',
      destination: 'claude-md',
      label: '',
      text: 'Read before editing.',
    }),
    actionKind: 'claude-md-rule',
    authority: 'claude-targeted',
  },
  {
    name: 'bash-output-cap',
    setup: () => {},
    finding: () => makeFinding('bash-output-cap', {
      type: 'paste',
      destination: 'shell-config',
      label: '',
      text: 'export BASH_MAX_OUTPUT_LENGTH=15000',
    }),
    actionKind: 'shell-config',
    authority: 'claude-targeted',
  },
]

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('Optimize action-target authority', () => {
  it('classifies every current automatic plan and fails Claude targets closed for Codex', () => {
    expect(ACTION_TARGET_AUTHORITY).toMatchObject({
      'mcp-remove': 'claude-targeted',
      'mcp-project-scope': 'claude-targeted',
      'defer-enable': 'claude-targeted',
      'defer-alwaysload': 'claude-targeted',
      'defer-threshold': 'claude-targeted',
      'archive-skill': 'claude-targeted',
      'archive-agent': 'claude-targeted',
      'archive-command': 'claude-targeted',
      'claude-md-rule': 'claude-targeted',
      'shell-config': 'claude-targeted',
    })

    expect(FINDING_EVIDENCE_REQUIREMENT).toMatchObject({
      'mcp-low-coverage': 'explicit-claude-scope',
      'mcp-project-scope': 'explicit-claude-scope',
    })

    for (const row of planCases) {
      const fx = makeFixture()
      row.setup(fx)
      const finding = row.finding(fx)
      expect(ACTION_TARGET_AUTHORITY[row.actionKind]).toBe(row.authority)
      expect(FINDING_EVIDENCE_REQUIREMENT[finding.id]).toBeDefined()

      const codex = planFindings([finding], context(fx, 'codex'))[0]!
      const claude = planFindings([finding], context(fx, 'claude'))[0]!
      const all = planFindings([finding], context(fx, 'all'))[0]!
      const allAutomatic = !['mcp-low-coverage', 'mcp-project-scope'].includes(finding.id)

      expect(codex.plan !== null, row.name).toBe(row.authority === 'provider-neutral')
      expect(claude.plan, row.name).not.toBeNull()
      expect(all.plan !== null, row.name).toBe(allAutomatic)
      expect(planFor(finding, context(fx, 'all')) !== null, row.name).toBe(allAutomatic)
      if (row.authority === 'claude-targeted') {
        expect(codex.notes.join('\n')).toContain('not auto-appliable under provider=codex')
      }
    }
  })

  it('rejects --only for every Claude-targeted automatic plan under Codex', async () => {
    const previousExitCode = process.exitCode
    try {
      for (const row of planCases.filter(item => item.authority === 'claude-targeted')) {
        const fx = makeFixture()
        row.setup(fx)
        const finding = row.finding(fx)
        process.exitCode = undefined
        const io = captureIo()
        await runOptimizeApply([], undefined, {
          provider: 'codex',
          findings: [finding],
          only: finding.id,
          actionsDir: fx.actionsDir,
          ctx: context(fx, 'codex'),
          output: io.output,
          errorOutput: io.errorOutput,
        })
        expect(process.exitCode, row.name).toBe(2)
        expect(io.stderr(), row.name).toContain(finding.id)
        expect(io.stderr(), row.name).toContain('not-appliable')
        expect(existsSync(fx.actionsDir), row.name).toBe(false)
      }
    } finally {
      process.exitCode = previousExitCode
    }
  })

  it('rejects --only for ambiguous ProjectSummary MCP actions under all', async () => {
    const previousExitCode = process.exitCode
    try {
      for (const id of ['mcp-low-coverage', 'mcp-project-scope'] as const) {
        const fx = makeFixture()
        mcpRemoveSetup(fx)
        const finding = id === 'mcp-low-coverage'
          ? makeFinding(id, CMD_FIX, { kind: 'mcp-remove', servers: ['server'] })
          : makeFinding(id, CMD_FIX, {
            kind: 'mcp-project-scope',
            servers: [{ server: 'server', keepProjects: [fx.keeper], removeProjects: [] }],
          })
        process.exitCode = undefined
        const io = captureIo()
        await runOptimizeApply([], undefined, {
          provider: 'all',
          findings: [finding],
          only: id,
          actionsDir: fx.actionsDir,
          ctx: context(fx, 'all'),
          output: io.output,
          errorOutput: io.errorOutput,
        })
        expect(process.exitCode, id).toBe(2)
        expect(io.stderr(), id).toContain(id)
        expect(io.stderr(), id).toContain('not-appliable')
        expect(existsSync(fx.actionsDir), id).toBe(false)
      }
    } finally {
      process.exitCode = previousExitCode
    }
  })
  it('rejects a crafted mcp-low-coverage plan at runOptimizeApply, including --only', async () => {
    const fx = makeFixture()
    mcpRemoveSetup(fx)
    const original = readFileSync(fx.claudeJson)
    const finding = makeFinding('mcp-low-coverage', CMD_FIX, { kind: 'mcp-remove', servers: ['server'] })

    const dryIo = captureIo()
    await runOptimizeApply([], undefined, {
      provider: 'codex',
      findings: [finding],
      dryRun: true,
      actionsDir: fx.actionsDir,
      ctx: context(fx, 'codex'),
      output: dryIo.output,
      errorOutput: dryIo.errorOutput,
    })
    expect(dryIo.stdout()).toContain('mcp-low-coverage')
    expect(dryIo.stdout()).toContain('not auto-appliable')
    expect(readFileSync(fx.claudeJson)).toEqual(original)
    expect(existsSync(fx.actionsDir)).toBe(false)

    const applyIo = captureIo()
    await runOptimizeApply([], undefined, {
      provider: 'codex',
      findings: [finding],
      yes: true,
      actionsDir: fx.actionsDir,
      ctx: context(fx, 'codex'),
      output: applyIo.output,
      errorOutput: applyIo.errorOutput,
    })
    expect(applyIo.stdout()).toContain('not auto-appliable')
    expect(readFileSync(fx.claudeJson)).toEqual(original)
    expect(existsSync(fx.actionsDir)).toBe(false)
    const allIo = captureIo()
    await runOptimizeApply([], undefined, {
      provider: 'all',
      findings: [finding],
      dryRun: true,
      actionsDir: fx.actionsDir,
      ctx: context(fx, 'all'),
      output: allIo.output,
      errorOutput: allIo.errorOutput,
    })
    expect(allIo.stdout()).toContain('not auto-appliable')
    expect(planFor(finding, context(fx, 'all'))).toBeNull()
    expect(readFileSync(fx.claudeJson)).toEqual(original)
    expect(existsSync(fx.actionsDir)).toBe(false)

    const previousExitCode = process.exitCode
    try {
      process.exitCode = undefined
      const onlyIo = captureIo()
      await runOptimizeApply([], undefined, {
        provider: 'codex',
        findings: [finding],
        only: 'mcp-low-coverage',
        actionsDir: fx.actionsDir,
        ctx: context(fx, 'codex'),
        output: onlyIo.output,
        errorOutput: onlyIo.errorOutput,
      })
      expect(process.exitCode).toBe(2)
      expect(onlyIo.stderr()).toContain('mcp-low-coverage')
      expect(onlyIo.stderr()).toContain('not-appliable')
      expect(readFileSync(fx.claudeJson)).toEqual(original)
      expect(existsSync(fx.actionsDir)).toBe(false)
    } finally {
      process.exitCode = previousExitCode
    }
  })

  it('rejects crafted mcp-project-scope under Codex but preserves the Claude plan and undo', async () => {
    const codexFx = makeFixture()
    mcpRemoveSetup(codexFx)
    const original = readFileSync(codexFx.claudeJson)
    const finding = makeFinding('mcp-project-scope', CMD_FIX, {
      kind: 'mcp-project-scope',
      servers: [{ server: 'server', keepProjects: [codexFx.keeper], removeProjects: [] }],
    })

    const dryIo = captureIo()
    await runOptimizeApply([], undefined, {
      provider: 'codex',
      findings: [finding],
      dryRun: true,
      actionsDir: codexFx.actionsDir,
      ctx: context(codexFx, 'codex'),
      output: dryIo.output,
      errorOutput: dryIo.errorOutput,
    })
    expect(dryIo.stdout()).toContain('mcp-project-scope')
    expect(dryIo.stdout()).toContain('not auto-appliable')
    expect(readFileSync(codexFx.claudeJson)).toEqual(original)
    expect(existsSync(codexFx.keeper)).toBe(false)
    expect(existsSync(codexFx.actionsDir)).toBe(false)

    await runOptimizeApply([], undefined, {
      provider: 'codex',
      findings: [finding],
      yes: true,
      actionsDir: codexFx.actionsDir,
      ctx: context(codexFx, 'codex'),
      output: captureIo().output,
      errorOutput: captureIo().errorOutput,
    })
    expect(readFileSync(codexFx.claudeJson)).toEqual(original)
    expect(existsSync(codexFx.keeper)).toBe(false)
    expect(existsSync(codexFx.actionsDir)).toBe(false)

    const allFx = makeFixture()
    mcpRemoveSetup(allFx)
    const allFinding = makeFinding('mcp-project-scope', CMD_FIX, {
      kind: 'mcp-project-scope',
      servers: [{ server: 'server', keepProjects: [allFx.keeper], removeProjects: [] }],
    })
    const allDryIo = captureIo()
    await runOptimizeApply([], undefined, {
      provider: 'all',
      findings: [allFinding],
      dryRun: true,
      actionsDir: allFx.actionsDir,
      ctx: context(allFx, 'all'),
      output: allDryIo.output,
      errorOutput: allDryIo.errorOutput,
    })
    expect(allDryIo.stdout()).toContain('not auto-appliable')
    expect(planFor(allFinding, context(allFx, 'all'))).toBeNull()
    expect(readFileSync(allFx.claudeJson)).toEqual(readFileSync(codexFx.claudeJson))
    expect(existsSync(allFx.keeper)).toBe(false)
    expect(existsSync(allFx.actionsDir)).toBe(false)

    await runOptimizeApply([], undefined, {
      provider: 'all',
      findings: [allFinding],
      yes: true,
      actionsDir: allFx.actionsDir,
      ctx: context(allFx, 'all'),
      output: captureIo().output,
      errorOutput: captureIo().errorOutput,
    })
    expect(readFileSync(allFx.claudeJson)).toEqual(readFileSync(codexFx.claudeJson))
    expect(existsSync(allFx.keeper)).toBe(false)
    expect(existsSync(allFx.actionsDir)).toBe(false)
    const claudeFx = makeFixture()
    mcpRemoveSetup(claudeFx)
    const claudeFinding = makeFinding('mcp-project-scope', CMD_FIX, {
      kind: 'mcp-project-scope',
      servers: [{ server: 'server', keepProjects: [claudeFx.keeper], removeProjects: [] }],
    })
    mkdirSync(claudeFx.keeper, { recursive: true })
    const plan = planFor(claudeFinding, context(claudeFx, 'claude'))
    expect(plan).not.toBeNull()
    const record = await runAction(plan!, claudeFx.actionsDir)
    expect(JSON.parse(readFileSync(claudeFx.claudeJson, 'utf-8')).mcpServers).toEqual({})
    expect(JSON.parse(readFileSync(join(claudeFx.keeper, '.mcp.json'), 'utf-8')).mcpServers).toEqual({ server: { command: 'node' } })
    await undoAction({ id: record.id }, { actionsDir: claudeFx.actionsDir })
    expect(readFileSync(claudeFx.claudeJson)).toEqual(readFileSync(codexFx.claudeJson))
    expect(existsSync(join(claudeFx.keeper, '.mcp.json'))).toBe(false)
  })

  it('keeps Codex MCP reporting while rejecting its current Claude-targeted mutation', async () => {
    const fx = makeFixture()
    mcpRemoveSetup(fx)
    const inventory = Array.from({ length: 12 }, (_, i) => 'mcp__server__tool-' + i)
    const makeSession = (sessionId: string): ProjectSummary['sessions'][number] => ({
      sessionId,
      project: 'codex-reporting',
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
      mcpBreakdown: { server: { calls: 0 } },
      bashBreakdown: {},
      categoryBreakdown: {},
      skillBreakdown: {},
      subagentBreakdown: {},
      mcpInventory: inventory,
    })
    const project: ProjectSummary = {
      project: 'codex-reporting',
      projectPath: fx.project,
      sessions: [makeSession('one'), makeSession('two')],
      totalCostUSD: 2,
      totalSavingsUSD: 0,
      totalApiCalls: 2,
      totalProxiedCostUSD: 0,
    }
    const result = await scanAndDetect([project], undefined, 'codex')
    const finding = result.findings.find(item => item.id === 'mcp-low-coverage')
    expect(finding).toBeDefined()

    const io = captureIo()
    await runOptimizeApply([project], undefined, {
      provider: 'codex',
      findings: [finding!],
      dryRun: true,
      actionsDir: fx.actionsDir,
      ctx: context(fx, 'codex'),
      output: io.output,
      errorOutput: io.errorOutput,
    })
    expect(io.stdout()).toContain('mcp-low-coverage')
    expect(io.stdout()).toContain('not auto-appliable')
    const original = readFileSync(fx.claudeJson)
    expect(readFileSync(fx.claudeJson)).toEqual(original)
    expect(existsSync(fx.actionsDir)).toBe(false)
  })

  it('uses the same provider-aware action eligibility on the real CLI path', () => {
    const fx = makeFixture()
    const codexDir = join(fx.home, '.codex', 'sessions', '2026', '08', '01')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(join(codexDir, 'rollout.jsonl'), [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-08-01T10:00:00.000Z', payload: { session_id: 'cli-codex', model: 'gpt-5.3-codex', cwd: fx.project, originator: 'codex-cli' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-08-01T10:00:01.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'inspect' }] } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-08-01T10:00:02.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } }),
    ].join('\n') + '\n')
    mcpRemoveSetup(fx)

    const env = {
      ...process.env,
      HOME: fx.home,
      USERPROFILE: fx.home,
      HOMEPATH: fx.home,
      HOMEDRIVE: '',
      APPDATA: join(fx.home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(fx.home, 'AppData', 'Local'),
      CLAUDE_CONFIG_DIR: join(fx.home, '.claude'),
      CODEX_HOME: join(fx.home, '.codex'),
      METRORA_CACHE_DIR: join(fx.home, 'metrora-cache'),
      METRORA_CONFIG_DIR: join(fx.home, 'metrora-config'),
      XDG_CONFIG_HOME: join(fx.home, '.config'),
      XDG_DATA_HOME: join(fx.home, '.local', 'share'),
      OPENCODE_DATA_DIR: join(fx.home, '.local', 'share', 'opencode'),
      TZ: 'UTC',
    }
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'optimize', '--provider', 'codex', '--from', '2026-08-01', '--to', '2026-08-01', '--apply', '--dry-run'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf-8',
      timeout: 30_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('.claude')
    expect(result.stdout).not.toContain('mcp-low-coverage')
    expect(existsSync(fx.actionsDir)).toBe(false)
  })
})
