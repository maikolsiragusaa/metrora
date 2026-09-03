// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LLAMA_SERVER_PORT,
  HarnessRuntimeProfileStore,
  normalizeLlamaServerPort,
  parseHarnessRuntimeProfile,
  validLlamaServerPort,
} from './harness-profile.mjs'

const mcpFixture = {
  id: 'fixture',
  serverName: 'fixture',
  enabled: true,
  transport: 'stdio' as const,
  command: 'node',
  args: ['fixture.mjs'],
  cwd: 'C:\\workspace',
  env: { MODE: 'test' },
  envRefs: { TOKEN: 'mcp:fixture:TOKEN' },
}

describe('Harness runtime profile', () => {
  it('persists non-secret preferences across a fresh store instance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-profile-'))
    try {
      const store = new HarnessRuntimeProfileStore(root)
      await store.setRuntime('llama-server')
      await store.setPort(19_876)
      await store.setLocalModel('llama-server', 'qwen2.5-coder')
      await store.setReasoning('llama-server', null, 'qwen2.5-coder', 'high')
      await store.setMcpServers([mcpFixture])
      await store.update({
        hostedConsentByProvider: { openai: 'accepted' },
        ui: { showReasoning: false, compactProcess: true, density: 'compact' },
      })

      const reloaded = new HarnessRuntimeProfileStore(root)
      const profile = await reloaded.load()
      expect(profile.runtime).toBe('llama-server')
      expect(profile.llamaServerPort).toBe(19_876)
      expect(profile.lastLocalModelByRuntime['llama-server']).toBe('qwen2.5-coder')
      expect(profile.reasoningByModel[JSON.stringify(['llama-server', null, 'qwen2.5-coder'])]).toBe('high')
      expect(profile.hostedConsentByProvider.openai).toBe('accepted')
      expect(profile.ui).toEqual({ showReasoning: false, compactProcess: true, density: 'compact' })
      expect(profile.mcpServers).toEqual([mcpFixture])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps reasoning preferences isolated by exact runtime/provider/model route', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-profile-route-'))
    try {
      const store = new HarnessRuntimeProfileStore(root)
      await store.setReasoning('hosted', 'openai', 'gpt-5', 'high')
      await store.setReasoning('hosted', 'anthropic', 'gpt-5', 'low')
      await store.setReasoning('ollama', null, 'gpt-5', 'min')
      const profile = store.read()
      expect(Object.keys(profile.reasoningByModel)).toEqual([
        JSON.stringify(['hosted', 'openai', 'gpt-5']),
        JSON.stringify(['hosted', 'anthropic', 'gpt-5']),
        JSON.stringify(['ollama', null, 'gpt-5']),
      ])
      expect(profile.reasoningByModel[JSON.stringify(['hosted', 'openai', 'gpt-5'])]).toBe('high')
      expect(profile.reasoningByModel[JSON.stringify(['hosted', 'anthropic', 'gpt-5'])]).toBe('low')
      expect(profile.reasoningByModel[JSON.stringify(['ollama', null, 'gpt-5'])]).toBe('min')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates the llama.cpp port and bounds persisted profile data', async () => {
    expect(validLlamaServerPort(1)).toBe(true)
    expect(validLlamaServerPort(65_535)).toBe(true)
    expect(validLlamaServerPort(0)).toBe(false)
    expect(validLlamaServerPort(65_536)).toBe(false)
    expect(validLlamaServerPort('8080')).toBe(false)
    expect(normalizeLlamaServerPort('bad')).toBe(DEFAULT_LLAMA_SERVER_PORT)

    const parsed = parseHarnessRuntimeProfile({
      version: 1,
      llamaServerPort: 8080,
      reasoningByModel: { 'gpt-5': 'medium', secret: 'invalid', ['x'.repeat(200)]: 'high' },
      prompt: 'must not survive',
      apiKey: 'must not survive',
    })
    expect(parsed.reasoningByModel).toEqual({ 'gpt-5': 'medium' })
    expect(parsed).not.toHaveProperty('prompt')
    expect(parsed).not.toHaveProperty('apiKey')

    const parsedMcp = parseHarnessRuntimeProfile({
      version: 1,
      mcpServers: [mcpFixture, { ...mcpFixture, id: 'bad', serverName: 'bad', cwd: 'relative' }],
    })
    expect(parsedMcp.mcpServers).toEqual([mcpFixture])

    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-profile-bytes-'))
    try {
      const store = new HarnessRuntimeProfileStore(root)
      await store.update({ lastLocalModelByRuntime: { ollama: 'safe-model' } })
      const raw = await readFile(store.path, 'utf8')
      expect(raw).not.toContain('apiKey')
      expect(raw).not.toContain('prompt')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
