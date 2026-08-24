import type { AdvisorBridge, AdvisorDataSource, AdvisorScope } from './types'

/** Adapts the existing read-only renderer bridge into the Advisor data boundary. */
export function createAdvisorDataSource(bridge: AdvisorBridge): AdvisorDataSource {
  return {
    getOverview: context => {
      const project = context.projectId !== 'all' ? context.projectId : undefined
      return context.range
        ? project
          ? bridge.getOverview(context.period, context.provider, context.range, undefined, false, false, project)
          : bridge.getOverview(context.period, context.provider, context.range)
        : project
          ? bridge.getOverview(context.period, context.provider, undefined, undefined, false, false, project)
          : bridge.getOverview(context.period, context.provider)
    },
    getModels: context => {
      const project = context.projectId !== 'all' ? context.projectId : undefined
      return context.range
        ? project
          ? bridge.getModels(context.period, context.provider, false, context.range, project)
          : bridge.getModels(context.period, context.provider, false, context.range)
        : project
          ? bridge.getModels(context.period, context.provider, false, undefined, project)
          : bridge.getModels(context.period, context.provider, false)
    },
    getQuota: () => bridge.getQuota(false),
  }
}
