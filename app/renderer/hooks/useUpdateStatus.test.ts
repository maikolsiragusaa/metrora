import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/ipc', () => ({
  metrora: { platform: 'linux', arch: 'x64' },
}))

import { directDownloadUrl, METRORA_RELEASES_URL, releasePageUrl, updateDownloadUrl } from './useUpdateStatus'

describe('Metrora release boundary', () => {
  it('has no direct download mapping before a verified channel exists', () => {
    expect(directDownloadUrl('desktop-v99.0.0', 'darwin', 'arm64')).toBeNull()
    expect(directDownloadUrl('desktop-v99.0.0', 'win32', 'x64')).toBeNull()
    expect(directDownloadUrl('desktop-v99.0.0', 'linux', 'x64')).toBeNull()
  })

  it('stays on the Metrora release surface', () => {
    expect(releasePageUrl('desktop-v0.9.19')).toBe(METRORA_RELEASES_URL)
    expect(updateDownloadUrl('desktop-v0.9.19')).toBe(METRORA_RELEASES_URL)
    expect(METRORA_RELEASES_URL).toBe('https://github.com/maikolsiragusaa/metrora/releases')
  })
})
