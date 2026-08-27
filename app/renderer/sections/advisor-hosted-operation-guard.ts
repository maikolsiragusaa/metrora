import type { AdvisorHostedModelState } from '../advisor/types'

export type AdvisorHostedOperationProvider = 'openai' | 'anthropic' | 'gemini'

export function isSelectableHostedModel(model: { state: AdvisorHostedModelState }): boolean {
  return model.state !== 'unsupported' && model.state !== 'failed-conformance'
}

export class AdvisorHostedOperationGuard {
  private provider: AdvisorHostedOperationProvider
  private probeRequest = 0
  private credentialOperation = 0

  constructor(provider: AdvisorHostedOperationProvider) {
    this.provider = provider
  }

  setProvider(provider: AdvisorHostedOperationProvider): void {
    this.provider = provider
    this.probeRequest += 1
    this.credentialOperation += 1
  }

  isCurrentProvider(provider: AdvisorHostedOperationProvider): boolean {
    return this.provider === provider
  }

  startProbe(provider: AdvisorHostedOperationProvider): number | null {
    if (!this.isCurrentProvider(provider)) return null
    this.probeRequest += 1
    return this.probeRequest
  }

  isCurrentProbe(provider: AdvisorHostedOperationProvider, requestId: number): boolean {
    return this.isCurrentProvider(provider) && this.probeRequest === requestId
  }

  startCredential(provider: AdvisorHostedOperationProvider): number | null {
    if (!this.isCurrentProvider(provider)) return null
    this.credentialOperation += 1
    return this.credentialOperation
  }

  isCurrentCredential(provider: AdvisorHostedOperationProvider, operationId: number): boolean {
    return this.isCurrentProvider(provider) && this.credentialOperation === operationId
  }
}
