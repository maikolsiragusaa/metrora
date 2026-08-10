import { describe, expect, it } from 'vitest'
import {
  buildPersistentMetroraLookupPath,
  formatGitHubReleaseLookupError,
  resolveLatestMenubarReleaseAssets,
  resolveMenubarReleaseAssets,
  resolvePersistentMetroraPathFromWhichOutput,
  resolveProxyUrlForUrl,
  resolveVersionedMenubarReleaseAssets,
  shouldFallbackToReleaseApi,
  type ReleaseResponse,
} from '../src/menubar-installer.js'

function asset(name: string) {
  return { name, browser_download_url: `https://example.test/${name}` }
}

describe('resolveMenubarReleaseAssets', () => {
  it('ignores dev zips and pairs the checksum with the versioned zip', () => {
    const release: ReleaseResponse = {
      tag_name: 'mac-v0.9.8',
      assets: [
        asset('MetroraMenubar-dev.zip'),
        asset('MetroraMenubar-dev.zip.sha256'),
        asset('MetroraMenubar-v0.9.8.zip'),
        asset('MetroraMenubar-v0.9.8.zip.sha256'),
      ],
    }

    const resolved = resolveMenubarReleaseAssets(release)

    expect(resolved.zip.name).toBe('MetroraMenubar-v0.9.8.zip')
    expect(resolved.checksum?.name).toBe('MetroraMenubar-v0.9.8.zip.sha256')
  })

  it('fails when a release only contains dev assets', () => {
    const release: ReleaseResponse = {
      tag_name: 'mac-v0.9.8',
      assets: [
        asset('MetroraMenubar-dev.zip'),
        asset('MetroraMenubar-dev.zip.sha256'),
      ],
    }

    expect(() => resolveMenubarReleaseAssets(release)).toThrow(/versioned zip/)
  })

  it('fails when the versioned checksum is missing', () => {
    const release: ReleaseResponse = {
      tag_name: 'mac-v0.9.8',
      assets: [
        asset('MetroraMenubar-v0.9.8.zip'),
      ],
    }

    expect(() => resolveMenubarReleaseAssets(release)).toThrow(/Missing checksum/)
  })

  it('selects the newest mac release instead of the newest repo release', () => {
    const releases: ReleaseResponse[] = [
      {
        tag_name: 'v0.9.9',
        assets: [
          asset('metrora-0.9.9.tgz'),
        ],
      },
      {
        tag_name: 'mac-v0.9.8',
        assets: [
          asset('MetroraMenubar-v0.9.8.zip'),
          asset('MetroraMenubar-v0.9.8.zip.sha256'),
        ],
      },
    ]

    const resolved = resolveLatestMenubarReleaseAssets(releases)

    expect(resolved.release.tag_name).toBe('mac-v0.9.8')
    expect(resolved.zip.name).toBe('MetroraMenubar-v0.9.8.zip')
  })

  it('builds direct release asset URLs from the CLI version', () => {
    const resolved = resolveVersionedMenubarReleaseAssets('0.9.15')

    expect(resolved.release.tag_name).toBe('mac-v0.9.15')
    expect(resolved.zip.name).toBe('MetroraMenubar-v0.9.15.zip')
    expect(resolved.zip.browser_download_url).toBe(
      'https://github.com/maikolsiragusaa/metrora/releases/download/mac-v0.9.15/MetroraMenubar-v0.9.15.zip'
    )
    expect(resolved.checksum.name).toBe('MetroraMenubar-v0.9.15.zip.sha256')
    expect(resolved.checksum.browser_download_url).toBe(
      'https://github.com/maikolsiragusaa/metrora/releases/download/mac-v0.9.15/MetroraMenubar-v0.9.15.zip.sha256'
    )
  })

  it('normalizes a leading v when building direct release URLs', () => {
    const resolved = resolveVersionedMenubarReleaseAssets('v0.9.15')

    expect(resolved.release.tag_name).toBe('mac-v0.9.15')
    expect(resolved.zip.name).toBe('MetroraMenubar-v0.9.15.zip')
  })

  it('falls back to the release API only for missing direct assets', () => {
    expect(shouldFallbackToReleaseApi(404)).toBe(true)
    expect(shouldFallbackToReleaseApi(410)).toBe(true)
    expect(shouldFallbackToReleaseApi(403)).toBe(false)
    expect(shouldFallbackToReleaseApi(429)).toBe(false)
    expect(shouldFallbackToReleaseApi(500)).toBe(false)
  })

  it('explains likely rate limiting for GitHub API 403 and 429 errors', () => {
    const headerValues: Record<string, string> = {
      'retry-after': '120',
      'x-ratelimit-reset': '1783539204',
    }
    const headers = { get: (name: string) => headerValues[name] ?? null }

    expect(formatGitHubReleaseLookupError(403, headers)).toContain(
      'GitHub may be rate limiting unauthenticated release API requests'
    )
    expect(formatGitHubReleaseLookupError(403, headers)).toContain('retry-after=120')
    expect(formatGitHubReleaseLookupError(429, headers)).toContain('x-ratelimit-reset=1783539204')
  })

  it('preserves the caller PATH when building the persistent CLI lookup PATH', () => {
    const lookupPath = buildPersistentMetroraLookupPath('/Users/me/.nvm/versions/node/v22.13.0/bin:/usr/bin')

    expect(lookupPath.split(':')).toContain('/Users/me/.nvm/versions/node/v22.13.0/bin')
    if (process.platform !== 'win32') expect(lookupPath.split(':')).toContain('/opt/homebrew/bin')
  })

  it('selects a persistent metrora binary when npx is first in which output', () => {
    const resolved = resolvePersistentMetroraPathFromWhichOutput([
      '/Users/me/.npm/_npx/abcd/node_modules/.bin/metrora',
      '/Users/me/.nvm/versions/node/v22.13.0/bin/metrora',
    ].join('\n'))

    expect(resolved).toBe('/Users/me/.nvm/versions/node/v22.13.0/bin/metrora')
  })

  it('shows the install guidance instead of a raw env failure when only npx is available', () => {
    expect(() => resolvePersistentMetroraPathFromWhichOutput(
      '/Users/me/.npm/_npx/abcd/node_modules/.bin/metrora'
    )).toThrow(/Install Metrora globally first/)
  })

  it('uses HTTPS proxy for GitHub HTTPS downloads', () => {
    const proxyUrl = resolveProxyUrlForUrl('https://api.github.com/repos/maikolsiragusaa/metrora/releases', {
      HTTPS_PROXY: 'http://proxy.company.test:8080',
    })

    expect(proxyUrl).toBe('http://proxy.company.test:8080')
  })

  it('bypasses proxy when NO_PROXY matches the download host', () => {
    const proxyUrl = resolveProxyUrlForUrl('https://api.github.com/repos/maikolsiragusaa/metrora/releases', {
      HTTPS_PROXY: 'http://proxy.company.test:8080',
      NO_PROXY: '.github.com',
    })

    expect(proxyUrl).toBeUndefined()
  })
})
