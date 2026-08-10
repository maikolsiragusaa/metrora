import { useEffect, useState } from 'react'

import { metrora } from '../lib/ipc'
import type { UpdateStatus } from '../lib/types'

export const METRORA_RELEASES_URL = 'https://github.com/maikolsiragusaa/metrora/releases'

/**
 * Reads the compatibility update status. The main process currently always
 * returns a no-update state and performs no network request.
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    if (typeof metrora.getUpdateStatus !== 'function') return
    let active = true
    metrora.getUpdateStatus().then(next => { if (active) setStatus(next) }).catch(() => {})
    const unsubscribe = typeof metrora.onUpdateStatus === 'function'
      ? metrora.onUpdateStatus(next => { if (active) setStatus(next) })
      : undefined
    return () => { active = false; unsubscribe?.() }
  }, [])
  return status
}

export function releasePageUrl(_tag: string): string {
  return METRORA_RELEASES_URL
}

/** No direct assets exist until Metrora publishes and verifies its own channel. */
export function directDownloadUrl(_tag: string, _platform: string | undefined, _arch: string | undefined): string | null {
  return null
}

export function updateDownloadUrl(tag: string): string {
  return releasePageUrl(tag)
}
