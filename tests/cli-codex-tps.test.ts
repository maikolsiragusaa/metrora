import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

const homes: string[] = []
vi.setConfig({ testTimeout: 30_000 })

afterEach(async () => {
  while (homes.length) await rm(homes.pop()!, { recursive: true, force: true })
})

function runCli(args: string[], home: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOMEPATH: home,
      HOMEDRIVE: '',
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CODEX_HOME: join(home, '.codex'),
      METRORA_CACHE_DIR: join(home, '.metrora-cache'),
      METRORA_CONFIG_DIR: join(home, '.metrora-config'),
      OPENCODE_DATA_DIR: join(home, '.opencode'),
      TZ: 'UTC',
    },
    encoding: 'utf-8',
    timeout: 30_000,
  })
}

describe('codex-tps CLI validation', () => {
  it('rejects sub-second watch intervals', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-tps-cli-'))
    homes.push(home)
    const result = runCli(['codex-tps', '--watch', '0.1'], home)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('watch must be 0 or at least 1 second')
  })

  it('rejects JSON watch output instead of concatenating invalid JSON documents', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-tps-cli-'))
    homes.push(home)
    const result = runCli(['codex-tps', '--json', '--watch', '1'], home)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--json cannot be combined with --watch')
  })

  it('returns a nonzero status for a missing explicit rollout', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-tps-cli-'))
    homes.push(home)
    const result = runCli(['codex-tps', join(home, 'missing.jsonl')], home)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('session file not found')
  })
})
