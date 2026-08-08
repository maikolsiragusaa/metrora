// Proves the immediately preceding Kiro parse fingerprint cannot preserve
// stale, truncated legacy-input accounting after upgrade.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'

import { clearSessionCache, parseAllSessions } from '../src/parser.js'
import {
  CACHE_VERSION,
  computeEnvFingerprint,
  fingerprintFile,
  sessionCachePath,
  type SessionCache,
} from '../src/session-cache.js'
import { estimateTokensFromChars } from '../src/token-estimate.js'

const testRoot = vi.hoisted(() => {
  const separator = process.platform === 'win32' ? '\\' : '/'
  const base = process.cwd()
  const root = `${base}${base.endsWith(separator) ? '' : separator}.kiro-full-input-cache-${process.pid}-${Date.now()}`
  process.env['HOME'] = `${root}/home`
  process.env['USERPROFILE'] = `${root}/home`
  process.env['HOMEPATH'] = `${root}/home`
  process.env['HOMEDRIVE'] = ''
  return root
})

const HOME = join(testRoot, 'home')
const CACHE_DIR = join(testRoot, 'cache')
const PREVIOUS_KIRO_PARSE_VERSION = 'ide-parsing-v1-est-cost'

function kiroAgentDir(): string {
  if (process.platform === 'darwin') {
    return join(HOME, 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')
  }
  if (process.platform === 'win32') {
    return join(HOME, 'AppData', 'Roaming', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')
  }
  return join(HOME, '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')
}

function previousKiroFingerprint(): string {
  return createHash('sha256')
    .update(`parser=${PREVIOUS_KIRO_PARSE_VERSION}`)
    .digest('hex')
    .slice(0, 16)
}

async function seedLegacyChat(): Promise<{ path: string; prompt: string }> {
  const dir = join(kiroAgentDir(), 'a'.repeat(32))
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'legacy-full-input.chat')
  const prompt = 'x'.repeat(2401)

  await writeFile(path, JSON.stringify({
    executionId: 'legacy-full-input',
    actionId: 'act',
    chat: [
      { role: 'human', content: '<identity>\nYou are Kiro.\n</identity>' },
      { role: 'human', content: prompt },
      { role: 'bot', content: 'Done.' },
    ],
    metadata: {
      modelId: 'claude-haiku-4-5',
      modelProvider: 'qdev',
      workflow: 'act',
      workflowId: 'legacy-full-input-session',
      startTime: 1777333000000,
      endTime: 1777333010000,
    },
  }))

  return { path, prompt }
}

async function seedPreviousCache(sourcePath: string): Promise<void> {
  const fingerprint = await fingerprintFile(sourcePath)
  if (!fingerprint) throw new Error('failed to fingerprint Kiro fixture')

  const cache: SessionCache = {
    version: CACHE_VERSION,
    complete: true,
    providers: {
      kiro: {
        envFingerprint: previousKiroFingerprint(),
        files: {
          [sourcePath]: {
            fingerprint,
            mcpInventory: [],
            turns: [],
          },
        },
      },
    },
  }

  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(sessionCachePath(), JSON.stringify(cache))
}

beforeEach(async () => {
  process.env['HOME'] = HOME
  process.env['USERPROFILE'] = HOME
  process.env['HOMEPATH'] = HOME
  process.env['HOMEDRIVE'] = ''
  process.env['METRORA_CACHE_DIR'] = CACHE_DIR
  clearSessionCache()
  await rm(testRoot, { recursive: true, force: true })
})

afterAll(async () => {
  clearSessionCache()
  await rm(testRoot, { recursive: true, force: true })
})

describe('Kiro legacy full-input cache invalidation', () => {
  it('reparses unchanged legacy chats cached under the previous parser version', async () => {
    expect(computeEnvFingerprint('kiro')).not.toBe(previousKiroFingerprint())

    const fixture = await seedLegacyChat()
    await seedPreviousCache(fixture.path)

    const projects = await parseAllSessions(undefined, 'kiro')
    const calls = projects
      .flatMap(project => project.sessions)
      .flatMap(session => session.turns)
      .flatMap(turn => turn.assistantCalls)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.usage.inputTokens).toBe(estimateTokensFromChars(fixture.prompt.length))
  })
})
