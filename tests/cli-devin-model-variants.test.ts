import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })

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
      METRORA_CACHE_DIR: join(home, '.cache', 'metrora'),
      METRORA_CONFIG_DIR: join(home, '.config', 'metrora'),
      OPENCODE_DATA_DIR: join(home, '.opencode'),
      TZ: 'UTC',
    },
    encoding: 'utf-8',
    timeout: 30_000,
  })
}

describe('metrora report Devin model variants', () => {
  it('keeps friendly Devin effort-tier names in JSON model rows and efficiency rows', async () => {
    const home = await mkdtemp(join(tmpdir(), 'metrora-cli-devin-models-'))
    try {
      await mkdir(join(home, '.config', 'metrora'), { recursive: true })
      await writeFile(join(home, '.config', 'metrora', 'config.json'), JSON.stringify({
        devin: { acuUsdRate: 1 },
      }))

      const transcriptsDir = join(home, '.local', 'share', 'devin', 'cli', 'transcripts')
      await mkdir(transcriptsDir, { recursive: true })
      await writeFile(join(transcriptsDir, 'session-487.json'), JSON.stringify({
        schema_version: '1.4',
        session_id: 'session-487',
        agent: { model_name: 'GPT-5.4' },
        steps: [
          {
            step_id: 1,
            message: 'fix the model row',
            metadata: { is_user_input: true, created_at: '2026-04-10T09:00:00.000Z' },
          },
          {
            step_id: 2,
            message: 'editing',
            tool_calls: [{ function_name: 'Edit' }],
            metadata: {
              created_at: '2026-04-10T09:01:00.000Z',
              committed_acu_cost: 0.25,
              generation_model: 'gpt-5-3-codex-xhigh',
              metrics: { input_tokens: 100, output_tokens: 25 },
            },
          },
        ],
      }))

      const result = runCli([
        'report',
        '--format',
        'json',
        '--from',
        '2026-04-10',
        '--to',
        '2026-04-10',
        '--provider',
        'devin',
      ], home)

      expect(result.status, result.stderr).toBe(0)
      const report = JSON.parse(result.stdout) as {
        models: Array<{
          name: string
          calls: number
          cost: number
          editTurns: number
          oneShotTurns: number
          costPerEdit: number | null
        }>
      }

      expect(report.models).toHaveLength(1)
      expect(report.models[0]).toMatchObject({
        name: 'GPT-5.3 Codex (xhigh)',
        calls: 1,
        cost: 0.25,
        editTurns: 1,
        oneShotTurns: 1,
        costPerEdit: 0.25,
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
