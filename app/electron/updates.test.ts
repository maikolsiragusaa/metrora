// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { compareSemver, createUpdateChecker, fetchReleases, pickLatestDesktopVersion, UPDATES_ENABLED } from './updates'

function release(tag: string) {
  return { tag_name: tag }
}

describe('version utilities', () => {
  it.each([
    ['0.9.17', '0.9.16', 1],
    ['0.10.0', '0.9.16', 1],
    ['1.0.0', '0.9.16', 1],
    ['0.9.16', '0.9.16', 0],
    ['0.9.15', '0.9.16', -1],
  ])('compareSemver(%s, %s) === %d', (a, b, expected) => {
    expect(Math.sign(compareSemver(a, b))).toBe(expected)
  })

  it('keeps release selection as a pure future-facing utility', () => {
    expect(pickLatestDesktopVersion([
      release('v1.0.0'),
      release('desktop-v0.9.17'),
      release('desktop-v0.10.0'),
    ])).toEqual({ version: '0.10.0', tag: 'desktop-v0.10.0' })
  })
})

describe('Metrora update boundary', () => {
  it('is disabled until Metrora owns a verified release channel', () => {
    expect(UPDATES_ENABLED).toBe(false)
  })

  it('never calls a supplied network implementation', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    const releases = await fetchReleases(new AbortController().signal, fetchImpl)
    expect(releases).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('always returns a no-update status and ignores inherited release providers', async () => {
    const fetchReleasesImpl = vi.fn(async () => [release('desktop-v99.0.0')])
    const checker = createUpdateChecker({ currentVersion: '0.9.19', fetchReleasesImpl })

    await expect(checker.getStatus()).resolves.toEqual({
      currentVersion: '0.9.19',
      latestVersion: null,
      updateAvailable: false,
      tag: null,
    })
    await expect(checker.check()).resolves.toMatchObject({ updateAvailable: false, latestVersion: null })
    expect(fetchReleasesImpl).not.toHaveBeenCalled()
  })
})
