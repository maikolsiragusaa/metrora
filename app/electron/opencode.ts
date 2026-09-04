// Stable import facade for the OpenCode integration. The implementation lives
// in focused modules so the official engine boundary remains reviewable.
export { createOpenCodeBridgeHandlers, OpenCodeEngine, resolveOpenCodeExecutable } from './opencode/engine'
export type { OpenCodeRuntimeOptions } from './opencode/engine'
export { projectOpenCodeEventForRenderer } from './opencode/events'
export { projectMetroraUsageSnapshot, redactOpenCodeText } from './opencode/projections'
export { OpenCodeError } from './opencode/types'
