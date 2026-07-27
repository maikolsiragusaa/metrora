import { execFileSync } from 'child_process'
import { realpathSync } from 'fs'
import { resolve } from 'path'
import { parseAllSessions } from './parser.js'
import type { DateRange, ProjectSummary, SessionSummary } from './types.js'

export type YieldCategory = 'productive' | 'reverted' | 'abandoned' | 'ambiguous'

export type SessionYield = {
  sessionId: string
  project: string
  cost: number
  category: YieldCategory
  commitCount: number
}

export type YieldSummary = {
  productive: { cost: number; sessions: number }
  reverted: { cost: number; sessions: number }
  abandoned: { cost: number; sessions: number }
  ambiguous: { cost: number; sessions: number }
  total: { cost: number; sessions: number }
  details: SessionYield[]
}

export type YieldJsonReport = {
  period: {
    label: string
    start: string
    end: string
  }
  summary: {
    productive: YieldBucketJson
    reverted: YieldBucketJson
    abandoned: YieldBucketJson
    ambiguous: YieldBucketJson
    total: { costUSD: number; sessions: number }
    productiveToRevertedCostRatio: number | null
  }
  methodology: 'timestamp-window'
  details: SessionYieldJson[]
}

type YieldBucketJson = {
  costUSD: number
  sessions: number
  costPercent: number
  sessionPercent: number
}

type SessionYieldJson = Omit<SessionYield, 'cost'> & {
  costUSD: number
}

const SAFE_REF_PATTERN = /^[A-Za-z0-9._/\-]+$/

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

type RepoIdentity = {
  /** Canonical group key: the absolute git-common-dir (shared object store). */
  readonly key: string
  /** A member directory to run `git log` from; --all spans the whole store. */
  readonly gitDir: string
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * Resolve a directory to its canonical repository identity, or null when it is
 * not inside a git work tree.
 *
 * The key is the absolute `git-common-dir` (the shared object store), NOT the
 * raw path: `git rev-parse --is-inside-work-tree` is true in every subdirectory
 * and `git log --all` returns the same repo-wide list from any of them, so
 * keying groups on the raw path would let two monorepo subdirectories — or two
 * worktrees of one repo — each award the same commit. All subdirectories AND
 * all worktrees of one repo share this common-dir, so they collapse to a single
 * group; distinct repositories keep distinct keys.
 *
 * Cached per directory: resolution runs once per unique path (many sessions
 * share a path), never once per session.
 */
function resolveRepoIdentity(
  dir: string,
  cache: Map<string, RepoIdentity | null>,
): RepoIdentity | null {
  const cached = cache.get(dir)
  if (cached !== undefined) return cached

  let identity: RepoIdentity | null = null
  // One fork answers both questions; line 1 is --is-inside-work-tree, line 2 the
  // --git-common-dir (relative to `dir` for a subdir, absolute for a worktree).
  const out = runGit(['rev-parse', '--is-inside-work-tree', '--git-common-dir'], dir)
  if (out) {
    const [insideWorkTree, commonDir] = out.split('\n')
    if (insideWorkTree === 'true' && commonDir) {
      // realpath canonicalizes symlinks: git reports a linked worktree's
      // common-dir as a realpath but the main worktree's as ".git" relative to
      // its (possibly symlinked) path, so both must be canonicalized to collapse
      // to one key.
      // Accepted residual: moving the main repo after `git worktree add` leaves
      // Git's linked-worktree metadata stale, so its worktrees may not unify;
      // that is Git-state staleness, not a grouping bug.
      identity = { key: canonicalPath(resolve(dir, commonDir)), gitDir: dir }
    }
  }
  cache.set(dir, identity)
  return identity
}

function getMainBranch(cwd: string): string {
  const result = runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)
  if (result) {
    const branch = result.replace('refs/remotes/origin/', '')
    if (SAFE_REF_PATTERN.test(branch)) return branch
  }

  const branches = runGit(['branch', '-a'], cwd) ?? ''
  if (branches.includes('main')) return 'main'
  if (branches.includes('master')) return 'master'
  return 'main'
}

/**
 * Normalize a git remote URL to a host-scoped repo identity (`host/org/repo`)
 * usable as a server-side join key. Handles the three common transports:
 *
 *   git@github.com:org/repo.git         -> github.com/org/repo
 *   ssh://git@github.com:22/org/repo.git -> github.com/org/repo
 *   https://user:tok@github.com/org/repo.git -> github.com/org/repo
 *
 * Credentials and ports are stripped (a token embedded in an https remote must
 * never leave the machine), the host is lowercased (path case is preserved),
 * and a trailing `.git` / `/` is removed. Local paths and `file://` remotes
 * return null — a repo with no network remote has no server-side identity.
 */
export function normalizeRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  let host: string
  let path: string

  const scpLike = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(trimmed)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (parsed.protocol === 'file:') return null
    if (!parsed.hostname) return null
    host = parsed.hostname
    path = parsed.pathname
  } else if (scpLike) {
    // scp-like syntax: [user@]host:path — not parseable by URL
    host = scpLike[1]
    path = scpLike[2]
  } else {
    // Bare local path (or something unrecognizable) — no remote identity.
    return null
  }

  const cleanPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  if (!cleanPath) return null

  return `${host.toLowerCase()}/${cleanPath}`
}

/** `git remote get-url origin`, normalized. Null when absent or local-only. */
function getRepoRemote(gitDir: string): string | null {
  const url = runGit(['remote', 'get-url', 'origin'], gitDir)
  return url ? normalizeRemoteUrl(url) : null
}

export type CommitInfo = {
  sha: string
  timestamp: Date
  inMain: boolean
  /** Set when a LATER commit's body says "This reverts commit <sha>" — i.e. the work in this commit was reverted out of main. */
  wasReverted: boolean
}

type SessionWindow = {
  readonly start: Date
  readonly end: Date
  readonly sessionId: string
}

type SessionAttribution = {
  readonly window: SessionWindow | null
  readonly commits: CommitInfo[]
  lostCandidacy: boolean
}

/**
 * Find SHAs that were the target of a `git revert` ANYWHERE in the repo's
 * history (not just the time window). The standard `git revert` body
 * format is "This reverts commit <SHA>." which we grep out.
 *
 * The previous implementation flagged a commit as `isRevert` based on the
 * substring "revert" appearing in its OWN subject. Two bugs there:
 * 1. Subjects like "Add revert button" matched.
 * 2. The session that PERFORMED the revert was tagged "reverted", not the
 *    session whose work was being reverted — so the original session always
 *    looked productive even after its work was thrown away.
 */
function getRevertedShas(cwd: string): Set<string> {
  const bodies = runGit(
    ['log', '--all', '--grep=^This reverts commit', '--format=%B%x1e'],
    cwd,
  ) ?? ''
  const set = new Set<string>()
  const re = /This reverts commit ([0-9a-f]{7,40})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bodies)) !== null) {
    set.add(m[1].toLowerCase())
  }
  return set
}

function getCommitsInRange(cwd: string, since: Date, until: Date, mainBranch: string): CommitInfo[] {
  const sinceStr = since.toISOString()
  const untilStr = until.toISOString()

  const log = runGit(
    ['log', '--all', `--since=${sinceStr}`, `--until=${untilStr}`, '--format=%H|%aI|%s'],
    cwd
  )

  if (!log) return []

  const mainCommits = new Set(
    (runGit(['log', mainBranch, '--format=%H'], cwd) ?? '').split('\n').filter(Boolean)
  )
  const revertedShas = getRevertedShas(cwd)

  return log.split('\n').filter(Boolean).map(line => {
    const [sha] = line.split('|')
    const timestamp = line.split('|')[1] ?? ''
    return {
      sha,
      timestamp: new Date(timestamp),
      inMain: mainCommits.has(sha),
      // wasReverted: matches when ANY later commit's body says
      // "This reverts commit <sha>". Compare against the full SHA AND its
      // 7-char short prefix to be safe; git revert sometimes records the
      // short form.
      wasReverted: revertedShas.has(sha.toLowerCase()) ||
                   revertedShas.has(sha.toLowerCase().slice(0, 7)),
    }
  })
}

function sessionWindow(session: SessionSummary): SessionWindow | null {
  if (!session.firstTimestamp) return null

  const start = new Date(session.firstTimestamp)
  const lastTs = session.lastTimestamp ?? session.firstTimestamp
  const end = new Date(new Date(lastTs).getTime() + 60 * 60 * 1000)
  return { start, end, sessionId: session.sessionId }
}

function attributeCommits(
  sessions: SessionSummary[],
  commits: CommitInfo[],
): SessionAttribution[] {
  const attributions: SessionAttribution[] = sessions.map(session => ({
    window: sessionWindow(session),
    commits: [],
    lostCandidacy: false,
  }))

  for (const commit of commits) {
    const candidates = attributions.filter((attribution): attribution is SessionAttribution & { window: SessionWindow } =>
      attribution.window !== null &&
      commit.timestamp >= attribution.window.start &&
      commit.timestamp <= attribution.window.end,
    )

    const owner = candidates.reduce<SessionAttribution & { window: SessionWindow } | null>((current, candidate) => {
      if (current === null) return candidate

      const currentSpan = current.window.end.getTime() - current.window.start.getTime()
      const candidateSpan = candidate.window.end.getTime() - candidate.window.start.getTime()
      if (candidateSpan !== currentSpan) return candidateSpan < currentSpan ? candidate : current
      if (candidate.window.start.getTime() !== current.window.start.getTime()) {
        return candidate.window.start < current.window.start ? candidate : current
      }
      // sessionId, not array position: session order is cache-state dependent.
      return candidate.window.sessionId < current.window.sessionId ? candidate : current
    }, null)

    for (const candidate of candidates) {
      if (candidate !== owner) candidate.lostCandidacy = true
    }
    owner?.commits.push(commit)
  }

  return attributions
}

function categorizeSession(
  session: SessionSummary,
  commits: CommitInfo[],
  lostCandidacy: boolean,
): { category: YieldCategory; commitCount: number } {
  if (!session.firstTimestamp) {
    return { category: 'abandoned', commitCount: 0 }
  }

  if (commits.length === 0) {
    // Ambiguous only when this session's window actually contained a commit
    // that a tighter window won — mere overlap with a credited session is not
    // enough to withhold the abandoned classification.
    return {
      category: lostCandidacy ? 'ambiguous' : 'abandoned',
      commitCount: 0,
    }
  }

  const inMainCount = commits.filter(c => c.inMain).length
  // A session is "reverted" when at least half of its in-main commits were
  // later reverted out (revert detected via "This reverts commit <sha>"
  // anywhere later in history, not in the same time window).
  const revertedCount = commits.filter(c => c.inMain && c.wasReverted).length

  if (revertedCount > 0 && revertedCount >= inMainCount / 2) {
    return { category: 'reverted', commitCount: commits.length }
  }

  if (inMainCount > 0) {
    return { category: 'productive', commitCount: inMainCount }
  }

  return { category: 'abandoned', commitCount: commits.length }
}

type RepoGroup = {
  commits: CommitInfo[]
  sessions: SessionSummary[]
  projectNames: string[]
  /** A directory to run further git queries in (remote lookup); null when the group has no git identity. */
  gitDir: string | null
}

/**
 * Group sessions by canonical repository identity and load each group's
 * commits for the range. Shared by `computeYield` (categorization) and
 * `computeAttributionRecords` (sync). Grouping semantics are unchanged from
 * the original computeYield implementation: each commit is awarded at most
 * once across the whole repo; monorepo subdirectories and worktrees collapse
 * to one group; a project whose path is missing or not a git repo falls back
 * to the cwd repo (or an empty commit list when cwd is not a repo either).
 */
function buildRepoGroups(
  projects: ProjectSummary[],
  range: DateRange,
  cwd: string,
): Map<string, RepoGroup> {
  const repoIdentityCache = new Map<string, RepoIdentity | null>()

  const cwdIdentity = resolveRepoIdentity(cwd, repoIdentityCache)
  const cwdCommits = cwdIdentity
    ? getCommitsInRange(cwd, range.start, range.end, getMainBranch(cwd))
    : []

  const repoGroups = new Map<string, RepoGroup>()
  for (const project of projects) {
    const projectIdentity = project.projectPath
      ? resolveRepoIdentity(project.projectPath, repoIdentityCache)
      : null
    const identity = projectIdentity ?? cwdIdentity
    const groupKey = identity ? identity.key : cwd

    let group = repoGroups.get(groupKey)
    if (!group) {
      group = {
        commits: !identity
          ? []
          : cwdIdentity && identity.key === cwdIdentity.key
            ? cwdCommits
            : getCommitsInRange(identity.gitDir, range.start, range.end, getMainBranch(identity.gitDir)),
        sessions: [],
        projectNames: [],
        gitDir: identity?.gitDir ?? null,
      }
      repoGroups.set(groupKey, group)
    }
    for (const session of project.sessions) {
      group.sessions.push(session)
      group.projectNames.push(project.project)
    }
  }

  return repoGroups
}

export async function computeYield(range: DateRange, cwd: string, provider: string = 'all'): Promise<YieldSummary> {
  const projects = await parseAllSessions(range, provider)

  const summary: YieldSummary = {
    productive: { cost: 0, sessions: 0 },
    reverted: { cost: 0, sessions: 0 },
    abandoned: { cost: 0, sessions: 0 },
    ambiguous: { cost: 0, sessions: 0 },
    total: { cost: 0, sessions: 0 },
    details: [],
  }

  const repoGroups = buildRepoGroups(projects, range, cwd)

  for (const group of repoGroups.values()) {
    const attributions = attributeCommits(group.sessions, group.commits)
    for (const [index, session] of group.sessions.entries()) {
      const attribution = attributions[index]
      const { category, commitCount } = categorizeSession(
        session,
        attribution?.commits ?? [],
        attribution?.lostCandidacy ?? false,
      )

      summary[category].cost += session.totalCostUSD
      summary[category].sessions += 1
      summary.total.cost += session.totalCostUSD
      summary.total.sessions += 1

      summary.details.push({
        sessionId: session.sessionId,
        project: group.projectNames[index] ?? session.project,
        cost: session.totalCostUSD,
        category,
        commitCount,
      })
    }
  }

  return summary
}

export function formatYieldSummary(summary: YieldSummary): string {
  const { productive, reverted, abandoned, ambiguous, total } = summary

  const pct = (n: number) => total.cost > 0 ? Math.round((n / total.cost) * 100) : 0
  const fmt = (n: number) => `$${n.toFixed(2)}`

  const lines = [
    '',
    `Productive:  ${fmt(productive.cost).padStart(8)} (${pct(productive.cost)}%) - ${productive.sessions} sessions shipped to main`,
    `Reverted:    ${fmt(reverted.cost).padStart(8)} (${pct(reverted.cost)}%) - ${reverted.sessions} sessions were reverted`,
    `Abandoned:   ${fmt(abandoned.cost).padStart(8)} (${pct(abandoned.cost)}%) - ${abandoned.sessions} sessions never committed`,
    `Ambiguous:   ${fmt(ambiguous.cost).padStart(8)} (${pct(ambiguous.cost)}%) - ${ambiguous.sessions} sessions lost commits to concurrent sessions`,
    '',
    'Attribution: timestamp-window based (heuristic)',
    '',
    `Total:       ${fmt(total.cost).padStart(8)}     - ${total.sessions} sessions`,
    '',
  ]

  return lines.join('\n')
}

export function buildYieldJsonReport(
  summary: YieldSummary,
  periodLabel: string,
  range: DateRange,
): YieldJsonReport {
  const bucket = (value: { cost: number; sessions: number }): YieldBucketJson => ({
    costUSD: value.cost,
    sessions: value.sessions,
    costPercent: summary.total.cost > 0
      ? Math.round((value.cost / summary.total.cost) * 1000) / 10
      : 0,
    sessionPercent: summary.total.sessions > 0
      ? Math.round((value.sessions / summary.total.sessions) * 1000) / 10
      : 0,
  })

  return {
    period: {
      label: periodLabel,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    summary: {
      productive: bucket(summary.productive),
      reverted: bucket(summary.reverted),
      abandoned: bucket(summary.abandoned),
      ambiguous: bucket(summary.ambiguous),
      total: {
        costUSD: summary.total.cost,
        sessions: summary.total.sessions,
      },
      productiveToRevertedCostRatio: summary.reverted.cost > 0
        ? Math.round((summary.productive.cost / summary.reverted.cost) * 100) / 100
        : null,
    },
    methodology: 'timestamp-window',
    details: summary.details.map(detail => ({
      sessionId: detail.sessionId,
      project: detail.project,
      costUSD: detail.cost,
      category: detail.category,
      commitCount: detail.commitCount,
    })),
  }
}

// --- Sync attribution (codeburn sync push --attribution) ---

export type CommitAttribution = {
  sha: string
  /** Commit author time, ISO 8601. */
  timestamp: string
  inMain: boolean
  wasReverted: boolean
}

/**
 * Per-session git attribution record — the sync-facing projection of the
 * yield timestamp-window correlation. One record per session that produced
 * server-joinable evidence: attributed commits (requires a normalized remote)
 * and/or PR links.
 */
export type SessionAttributionRecord = {
  sessionId: string
  project: string
  /** Normalized origin remote (`host/org/repo`), the server-side join key. Null when only prLinks are available. */
  repo: string | null
  /** GitHub PR URLs captured for the session (already normalized upstream). */
  prLinks: string[]
  /** Commits attributed to this session. Empty when repo is null (SHAs without a repo identity cannot be joined). */
  commits: CommitAttribution[]
  /** Session window, ISO 8601 — lets the receiver reason about attribution recency. */
  firstTimestamp: string
  lastTimestamp: string
}

/**
 * Compute per-session attribution records for sync. Reuses the exact yield
 * repo grouping + tightest-window commit attribution (`methodology:
 * timestamp-window`), then joins in each repo group's normalized origin
 * remote and the session's PR links.
 *
 * Inclusion rules:
 * - Sessions with neither attributed commits nor PR links are omitted.
 * - Commits are only included when the repo has a normalized remote; a SHA
 *   without a repo identity has no server-side meaning. Such sessions still
 *   emit a record when they carry PR links (the PR URL embeds the repo).
 *
 * Takes already-parsed projects (sync push has them in hand) instead of
 * re-parsing like computeYield does.
 */
export function computeAttributionRecords(
  projects: ProjectSummary[],
  range: DateRange,
  cwd: string,
): SessionAttributionRecord[] {
  const repoGroups = buildRepoGroups(projects, range, cwd)
  const records: SessionAttributionRecord[] = []

  for (const group of repoGroups.values()) {
    const remote = group.gitDir ? getRepoRemote(group.gitDir) : null
    const attributions = attributeCommits(group.sessions, group.commits)

    for (const [index, session] of group.sessions.entries()) {
      if (!session.firstTimestamp) continue

      const attributedCommits = remote ? (attributions[index]?.commits ?? []) : []
      const prLinks = session.prLinks ?? []
      if (attributedCommits.length === 0 && prLinks.length === 0) continue

      records.push({
        sessionId: session.sessionId,
        project: group.projectNames[index] ?? session.project,
        repo: remote,
        prLinks: [...prLinks].sort(),
        commits: attributedCommits.map(c => ({
          sha: c.sha,
          timestamp: c.timestamp.toISOString(),
          inMain: c.inMain,
          wasReverted: c.wasReverted,
        })),
        firstTimestamp: session.firstTimestamp,
        lastTimestamp: session.lastTimestamp ?? session.firstTimestamp,
      })
    }
  }

  return records
}
