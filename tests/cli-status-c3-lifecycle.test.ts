import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function runCli(args: string[], home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      METRORA_CACHE_DIR: join(home, '.cache', 'metrora'),
      HOME: home,
      USERPROFILE: home,
      HOMEPATH: home,
      HOMEDRIVE: '',
      CODEX_HOME: join(home, '.codex'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      TZ: 'UTC',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60_000,
  })
}

describe('CLI status C3 analytics lifecycle', () => {
  it('publishes and consumes the same fresh generation for terminal status', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-lifecycle-'))
    roots.push(home)
    const projectDir = join(home, '.claude', 'projects', 'demo')
    await mkdir(projectDir, { recursive: true })
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    const sessionId = 'c3-lifecycle-session'
    const lines = [
      JSON.stringify({ type: 'user', sessionId, timestamp, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({
        type: 'assistant',
        sessionId,
        timestamp,
        message: {
          id: 'c3-message',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }),
    ].join('\n') + '\n'
    await writeFile(join(projectDir, `${sessionId}.jsonl`), lines, 'utf8')

    const result = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Today')
    expect(result.stdout).toContain('Month')

    const headPath = join(home, 'AppData', 'Local', 'Metrora', 'history-shadow', 'v1', 'head.json')
    const head = JSON.parse(await readFile(headPath, 'utf8')) as { projectionSha256: string }
    expect(head.projectionSha256).toMatch(/^[a-f0-9]{64}$/u)
    const indexPath = join(home, 'AppData', 'Local', 'Metrora', 'history-shadow', 'v1', 'headline-indexes', `${head.projectionSha256}.json`)
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as { analyticsGenerationId?: string }
    expect(index.analyticsGenerationId).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('does not publish or silently refresh C3 in snapshot mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-c3-snapshot-'))
    roots.push(home)
    const projectDir = join(home, '.claude', 'projects', 'demo')
    await mkdir(projectDir, { recursive: true })
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    const sessionId = 'c3-snapshot-session'
    await writeFile(join(projectDir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: 'user', sessionId, timestamp, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId, timestamp, message: { role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 100, output_tokens: 20 } } }),
    ].join('\n') + '\n', 'utf8')

    const fresh = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home)
    expect(fresh.status).toBe(0)
    const headPath = join(home, 'AppData', 'Local', 'Metrora', 'history-shadow', 'v1', 'head.json')
    const before = await readFile(headPath, 'utf8')
    const snapshot = runCli(['status', '--format', 'terminal', '--provider', 'claude'], home, { METRORA_READ_MODE: 'snapshot' })
    expect(snapshot.status).toBe(0)
    expect(snapshot.stdout).toContain('Today')
    expect(await readFile(headPath, 'utf8')).toBe(before)
  })
})
