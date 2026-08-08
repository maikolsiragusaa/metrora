// Metrora does not query Metrora releases or download channels.
//
// The inherited Electron main process expects an UpdateChecker-compatible
// object. This module keeps that interface but deliberately performs no network
// request until Metrora owns and publishes a verified release channel.

export const UPDATES_ENABLED = false

export type UpdateStatus = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  tag: string | null
}

type GitHubRelease = { tag_name?: string }

function baselineStatus(currentVersion: string): UpdateStatus {
  return { currentVersion, latestVersion: null, updateAvailable: false, tag: null }
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < 3; i++) {
    const x = Number(pa[i] ?? 0) || 0
    const y = Number(pb[i] ?? 0) || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Retained as a pure utility for a future Metrora-owned release channel. */
export function pickLatestDesktopVersion(releases: GitHubRelease[]): { version: string; tag: string } | null {
  const tagPattern = /^desktop-v(\d+\.\d+\.\d+)$/
  let best: { version: string; tag: string } | null = null
  for (const release of releases) {
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : ''
    const match = tagPattern.exec(tag)
    if (!match) continue
    const version = match[1]!
    if (!best || compareSemver(version, best.version) > 0) best = { version, tag }
  }
  return best
}

/** No-network compatibility function. The supplied fetch implementation is never called. */
export async function fetchReleases(_signal: AbortSignal, _fetchImpl: typeof fetch = globalThis.fetch): Promise<GitHubRelease[]> {
  return []
}

export type UpdateChecker = {
  getStatus(): Promise<UpdateStatus>
  check(): Promise<UpdateStatus>
}

export function createUpdateChecker(opts: {
  currentVersion: string
  fetchReleasesImpl?: (signal: AbortSignal) => Promise<GitHubRelease[]>
  now?: () => number
  intervalMs?: number
}): UpdateChecker {
  const status = baselineStatus(opts.currentVersion)
  const read = async (): Promise<UpdateStatus> => ({ ...status })
  return { getStatus: read, check: read }
}
