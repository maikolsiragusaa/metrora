export const OPENCODE_VERSION = '1.18.27' as const
export const OPENCODE_COMMIT = 'b04697366f05419e9bd7a92f841813dd976161c9' as const
export const OPENCODE_CUSTOM_TOOL_ID = 'metrora_usage_snapshot' as const
export const OPENCODE_LOOPBACK_HOST = '127.0.0.1' as const

export type OpenCodeRuntimeState = 'idle' | 'starting' | 'ready' | 'stopping' | 'unavailable'

/** Renderer-safe. It deliberately contains no server origin or credential. */
export type OpenCodeRuntimeStatus = {
  state: OpenCodeRuntimeState
  version: typeof OPENCODE_VERSION
  commit: typeof OPENCODE_COMMIT
  customToolRegistered: boolean | null
  detail: string | null
}

/** Main-process-only connection material. Never return this across IPC. */
export type OpenCodeConnection = {
  origin: string
  username: string
  password: string
}

export class OpenCodeError extends Error {
  constructor(public readonly kind: string, message: string) {
    super(message)
    this.name = 'OpenCodeError'
  }
}
