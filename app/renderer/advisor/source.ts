import type { AdvisorBridge, AdvisorDataSource, AdvisorScope } from './types'
import { readAdvisorBenchEvidence } from './bench'

/** Adapts the existing read-only renderer bridge into the Advisor data boundary. */
export function createAdvisorDataSource(bridge: AdvisorBridge): AdvisorDataSource {
  return {
    getOverview: async (context, signal) => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      const project = context.projectId !== 'all' ? context.projectId : undefined
      const result = context.range
        ? project
          ? bridge.getOverview(context.period, context.provider, context.range, undefined, false, false, project)
          : bridge.getOverview(context.period, context.provider, context.range)
        : project
          ? bridge.getOverview(context.period, context.provider, undefined, undefined, false, false, project)
          : bridge.getOverview(context.period, context.provider)
      const overview = await result
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return overview
    },
    getModels: async (context, signal) => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      const project = context.projectId !== 'all' ? context.projectId : undefined
      const result = context.range
        ? project
          ? bridge.getModels(context.period, context.provider, false, context.range, project)
          : bridge.getModels(context.period, context.provider, false, context.range)
        : project
          ? bridge.getModels(context.period, context.provider, false, undefined, project)
          : bridge.getModels(context.period, context.provider, false)
      const models = await result
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return models
    },
    getQuota: async signal => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      const quota = await bridge.getQuota(false)
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return quota
    },
    getBenchEvidence: async (context, signal) => {
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      const evidence = await readAdvisorBenchEvidence(bridge, context, signal)
      if (signal?.aborted) throw new DOMException('Advisor data read cancelled', 'AbortError')
      return evidence
    },
  }
}
