import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, it, expect } from 'vitest'

const CLI_PLAN_TIMEOUT_MS = 10_000

function runCli(args: string[], home: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home, // os.homedir() uses USERPROFILE on Windows
      HOMEPATH: home,
      HOMEDRIVE: '',
    },
    encoding: 'utf-8',
  })
}

describe('codeburn plan command', () => {
  it('persists provider-keyed plans and clears on reset', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      const setResult = runCli(['plan', 'set', 'claude-max'], home)
      expect(setResult.status).toBe(0)

      const setCodexResult = runCli(['plan', 'set', 'custom', '--monthly-usd', '200', '--provider', 'codex'], home)
      expect(setCodexResult.status).toBe(0)

      const configPath = join(home, '.config', 'codeburn', 'config.json')
      const configRaw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(configRaw) as { plans?: { claude?: { id?: string; monthlyUsd?: number }; codex?: { id?: string; monthlyUsd?: number } } }
      expect(config.plans?.claude?.id).toBe('claude-max')
      expect(config.plans?.claude?.monthlyUsd).toBe(200)
      expect(config.plans?.codex?.id).toBe('custom')
      expect(config.plans?.codex?.monthlyUsd).toBe(200)

      const resetResult = runCli(['plan', 'reset'], home)
      expect(resetResult.status).toBe(0)

      const afterResetRaw = await readFile(configPath, 'utf-8')
      const afterReset = JSON.parse(afterResetRaw) as { plan?: unknown; plans?: unknown }
      expect(afterReset.plan).toBeUndefined()
      expect(afterReset.plans).toBeUndefined()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('resets one provider without removing other plans', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      expect(runCli(['plan', 'set', 'claude-max'], home).status).toBe(0)
      expect(runCli(['plan', 'set', 'custom', '--monthly-usd', '200', '--provider', 'codex'], home).status).toBe(0)
      expect(runCli(['plan', 'reset', '--provider', 'codex'], home).status).toBe(0)

      const configPath = join(home, '.config', 'codeburn', 'config.json')
      const configRaw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(configRaw) as { plans?: { claude?: { id?: string }; codex?: unknown } }
      expect(config.plans?.claude?.id).toBe('claude-max')
      expect(config.plans?.codex).toBeUndefined()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('resets the all-provider plan without removing provider-specific plans', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      expect(runCli(['plan', 'set', 'claude-max'], home).status).toBe(0)
      expect(runCli(['plan', 'reset', '--provider', 'all'], home).status).toBe(0)

      const configPath = join(home, '.config', 'codeburn', 'config.json')
      const configRaw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(configRaw) as { plans?: { claude?: { id?: string }; all?: unknown } }
      expect(config.plans?.claude?.id).toBe('claude-max')
      expect(config.plans?.all).toBeUndefined()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('shows all configured plans as json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      expect(runCli(['plan', 'set', 'claude-max'], home).status).toBe(0)
      expect(runCli(['plan', 'set', 'custom', '--monthly-usd', '200', '--provider', 'codex'], home).status).toBe(0)

      const result = runCli(['plan', '--format', 'json'], home)
      expect(result.status).toBe(0)
      const payload = JSON.parse(result.stdout) as { id?: string; provider?: string; plans?: { claude?: { id?: string }; codex?: { id?: string } } }
      expect(payload.id).toBe('claude-max')
      expect(payload.provider).toBe('claude')
      expect(payload.plans?.claude?.id).toBe('claude-max')
      expect(payload.plans?.codex?.id).toBe('custom')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('filters shown plans by provider', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      expect(runCli(['plan', 'set', 'claude-max'], home).status).toBe(0)
      expect(runCli(['plan', 'set', 'custom', '--monthly-usd', '200', '--provider', 'codex'], home).status).toBe(0)

      const result = runCli(['plan', '--format', 'json', '--provider', 'codex'], home)
      expect(result.status).toBe(0)
      const payload = JSON.parse(result.stdout) as { id?: string; provider?: string; plans?: unknown }
      expect(payload.id).toBe('custom')
      expect(payload.provider).toBe('codex')
      expect(payload.plans).toMatchObject({ codex: { id: 'custom' } })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('rejects all-provider scope for preset plans', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      const result = runCli(['plan', 'set', 'claude-max', '--provider', 'all'], home)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('omit --provider or use --provider claude')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)

  it('shows invalid reset-day value in error output', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-cli-plan-'))

    try {
      const result = runCli(['plan', 'set', 'claude-max', '--reset-day', '99'], home)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('--reset-day must be an integer from 1 to 28; got 99.')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, CLI_PLAN_TIMEOUT_MS)
})
