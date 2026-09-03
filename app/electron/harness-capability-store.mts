import {
  harnessProviderRoute,
  hostedProviderRoute,
  reasoningProfileKey,
  type HarnessHostedProbe,
  type HarnessHostedProvider,
  type HarnessLocalProbe,
  type HarnessReasoningCapability,
  type HarnessReasoningEffort,
  type HarnessRuntimeId,
  type HarnessRuntimeProfileV1,
} from './harness-runtime-types.js'
import { reviewedOssReasoningCapability, reviewedReasoningCapability } from './harness-reasoning-catalog.mjs'

type CapabilityRow = {
  modelId?: string
  id?: string
  reasoningEfforts?: HarnessReasoningEffort[]
  reasoningMetadataPresent?: boolean
}
type ProfileReader = { read(): HarnessRuntimeProfileV1 }

function cacheKey(route: string, model: string): string { return `${route}\u0000${model}` }

function userProfileKey(route: string, model: string): string | null {
  const local = (['ollama', 'lmstudio', 'llama-server'] as HarnessRuntimeId[]).find(runtime => harnessProviderRoute(runtime) === route)
  if (local) return reasoningProfileKey(local, null, model)
  const hosted = (['openai', 'anthropic', 'gemini', 'openrouter', 'opencode-zen'] as HarnessHostedProvider[]).find(provider => hostedProviderRoute(provider) === route)
  return hosted ? reasoningProfileKey('hosted', hosted, model) : null
}

function providerCapability(row: CapabilityRow): HarnessReasoningCapability | undefined {
  if (!row.reasoningMetadataPresent && !Object.prototype.hasOwnProperty.call(row, 'reasoningEfforts')) return undefined
  return { efforts: [...(row.reasoningEfforts ?? [])], source: 'provider', automatic: true }
}

export class HarnessCapabilityStore {
  private readonly providerCapabilities = new Map<string, HarnessReasoningCapability>()

  constructor(private readonly profile: ProfileReader) {}

  clearRoute(route: string): void {
    const prefix = `${route}\u0000`
    for (const key of this.providerCapabilities.keys()) if (key.startsWith(prefix)) this.providerCapabilities.delete(key)
  }

  remember(route: string, rows: ReadonlyArray<CapabilityRow>): void {
    this.clearRoute(route)
    for (const row of rows) {
      const model = row.modelId ?? row.id
      const capability = model ? providerCapability(row) : undefined
      if (model && capability) this.providerCapabilities.set(cacheKey(route, model), capability)
    }
  }

  resolve(route: string, model: string): HarnessReasoningCapability | undefined {
    const provider = this.providerCapabilities.get(cacheKey(route, model))
    if (provider) return provider
    const catalog = reviewedReasoningCapability(route, model)
    if (catalog) return catalog
    const oss = reviewedOssReasoningCapability(route, model)
    if (oss) return oss
    const key = userProfileKey(route, model)
    const declared = key ? this.profile.read().reasoningCapabilitiesByModel[key] : undefined
    return declared !== undefined ? { efforts: [...declared], source: 'user', automatic: false } : undefined
  }

  getReasoningEfforts(route: string, model: string): readonly HarnessReasoningEffort[] | undefined {
    return this.resolve(route, model)?.efforts
  }

  decorateLocalProbe(result: HarnessLocalProbe, route: string): HarnessLocalProbe {
    this.remember(route, result.capabilities)
    return { ...result, capabilities: result.capabilities.map(capability => ({ ...capability, ...this.project(capability, route) })) }
  }

  decorateHostedProbe(result: HarnessHostedProbe, route: string): HarnessHostedProbe {
    this.remember(route, result.models)
    return { ...result, models: result.models.map(model => ({ ...model, ...this.project(model, route) })) }
  }

  private project(row: CapabilityRow, route: string): Partial<Pick<CapabilityRow, 'reasoningEfforts' | 'reasoningMetadataPresent'> & { reasoningSource: HarnessReasoningCapability['source']; reasoningAutomatic: boolean }> {
    const model = row.modelId ?? row.id
    const resolved = model ? this.resolve(route, model) : undefined
    return resolved
      ? {
          reasoningEfforts: [...resolved.efforts],
          reasoningSource: resolved.source,
          reasoningAutomatic: resolved.automatic,
          ...(resolved.source === 'provider' ? { reasoningMetadataPresent: true } : {}),
        }
      : {}
  }
}
