// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { HarnessCapabilityStore } from './harness-capability-store.mjs'
import { probeHostedProvider } from './harness-hosted-adapter.mjs'
import { HarnessRuntimeProfileStore } from './harness-profile.mjs'
import { probeLlamaServerMain } from './local-runtime.mjs'
import { reasoningMetadata, reasoningProfileKey } from './harness-runtime-types.js'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('Harness layered reasoning capability resolver', () => {
  it('keeps an unannotated llama.cpp model at Provider default until a bounded declaration is saved, then survives restart and model switching', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-capabilities-'))
    try {
      const profile = new HarnessRuntimeProfileStore(root)
      await profile.load()
      const route = 'metrora-local-llama-server'
      const fetchImpl = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
        return jsonResponse({ data: [{ id: 'custom.gguf' }] })
      }) as typeof fetch
      const discovered = await probeLlamaServerMain(fetchImpl, undefined, 'http://127.0.0.1:8080')
      expect(discovered.capabilities[0]?.reasoningEfforts).toBeUndefined()

      const resolver = new HarnessCapabilityStore(profile)
      expect(resolver.decorateLocalProbe(discovered, route).capabilities[0]?.reasoningEfforts).toBeUndefined()
      expect(resolver.resolve(route, 'custom.gguf')).toBeUndefined()

      await profile.setReasoningCapabilities('llama-server', null, 'custom.gguf', ['budget_tokens:8192', 'vendor-tier-2'])
      const declared = resolver.decorateLocalProbe(discovered, route)
      expect(declared.capabilities[0]).toMatchObject({ reasoningEfforts: ['budget_tokens:8192', 'vendor-tier-2'], reasoningSource: 'user', reasoningAutomatic: false })

      const restartedProfile = new HarnessRuntimeProfileStore(root)
      await restartedProfile.load()
      const restartedResolver = new HarnessCapabilityStore(restartedProfile)
      expect(restartedResolver.resolve(route, 'custom.gguf')).toEqual({ efforts: ['budget_tokens:8192', 'vendor-tier-2'], source: 'user', automatic: false })

      await restartedProfile.setReasoningCapabilities('llama-server', null, 'model-a', ['effort-a'])
      await restartedProfile.setReasoningCapabilities('llama-server', null, 'model-b', ['effort-b'])
      await restartedProfile.setReasoning('llama-server', null, 'model-a', 'effort-a')
      await restartedProfile.setReasoning('llama-server', null, 'model-b', 'effort-b')
      expect(restartedProfile.read().reasoningByModel[reasoningProfileKey('llama-server', null, 'model-a')]).toBe('effort-a')
      expect(restartedProfile.read().reasoningByModel[reasoningProfileKey('llama-server', null, 'model-b')]).toBe('effort-b')
      expect(restartedResolver.resolve(route, 'model-a')?.efforts).toEqual(['effort-a'])
      expect(restartedResolver.resolve(route, 'model-b')?.efforts).toEqual(['effort-b'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the reviewed exact OpenCode Zen catalog when the model list has no reasoning array, without inventing levels', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-catalog-'))
    try {
      const profile = new HarnessRuntimeProfileStore(root)
      await profile.load()
      const result = await probeHostedProvider('opencode-zen', async () => 'secret-value', (async () => jsonResponse({ data: [{ id: 'gpt-5.6-sol' }, { id: 'deepseek-v4-flash' }] })) as typeof fetch)
      expect(result.models[0]?.reasoningEfforts).toBeUndefined()
      expect(result.models[1]?.reasoningEfforts).toBeUndefined()
      const resolver = new HarnessCapabilityStore(profile)
      const decorated = resolver.decorateHostedProbe(result, 'metrora-hosted-opencode-zen')
      expect(decorated.models[0]).toMatchObject({ reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasoningSource: 'catalog', reasoningAutomatic: true })
      expect(decorated.models[1]).toMatchObject({ reasoningEfforts: ['low', 'high', 'max'], reasoningSource: 'catalog', reasoningAutomatic: true })

      resolver.remember('metrora-hosted-opencode-zen', [{ id: 'gpt-5.6-sol', reasoningMetadataPresent: true, reasoningEfforts: [] }])
      expect(resolver.resolve('metrora-hosted-opencode-zen', 'gpt-5.6-sol')).toEqual({ efforts: [], source: 'provider', automatic: true })
      expect(reasoningMetadata({ reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 81_920 }] })).toEqual({ present: true, efforts: [] })
      expect(reasoningMetadata({ reasoning: true })).toEqual({ present: false, efforts: [] })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps an unknown custom model unresolved until explicitly configured', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-unknown-'))
    try {
      const profile = new HarnessRuntimeProfileStore(root)
      await profile.load()
      const resolver = new HarnessCapabilityStore(profile)
      resolver.remember('metrora-local-llama-server', [{ id: 'my-local-model' }])
      expect(resolver.resolve('metrora-local-llama-server', 'my-local-model')).toBeUndefined()
      await profile.setReasoningCapabilities('llama-server', null, 'my-local-model', ['custom-exact-id'])
      expect(resolver.resolve('metrora-local-llama-server', 'my-local-model')).toEqual({ efforts: ['custom-exact-id'], source: 'user', automatic: false })
      expect(resolver.resolve('metrora-local-llama-server', 'my-local-model')?.efforts).not.toContain('low')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
