import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type PlanContext = {
  homeDir?: string
  cwd?: string
  shell?: string
  // Installed Claude Code version (null when undeterminable). Injectable so
  // tests never shell out; production defaults to probing `claude --version`.
  claudeVersion?: () => string | null
  provider?: string // action-target authority; omitted preserves all-provider behavior
}

export type ResolvedPaths = {
  homeDir: string
  cwd: string
  projectMcpJson: string
  projectSettings: string
  projectSettingsLocal: string
  userClaudeJson: string
  userSettings: string
  skillsDir: string
  agentsDir: string
  commandsDir: string
  projectClaudeMd: string
  shellRc: string
  // Not a path, but resolved from the same context: the injectable installed-
  // version probe the defer-alwaysload version gate consults.
  claudeVersion: () => string | null
}

// `claude --version` prints e.g. "2.1.130 (Claude Code)"; any failure (binary
// missing, timeout, non-zero exit) yields null and version-gated plans
// degrade to a manual note instead of guessing.
const CLAUDE_VERSION_PROBE_TIMEOUT_MS = 3000

function probeClaudeVersion(): string | null {
  try {
    return execFileSync('claude', ['--version'], {
      encoding: 'utf-8',
      timeout: CLAUDE_VERSION_PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

export function resolvePaths(ctx: PlanContext): ResolvedPaths {
  const homeDir = ctx.homeDir ?? homedir()
  const cwd = ctx.cwd ?? process.cwd()
  const shell = ctx.shell ?? process.env['SHELL'] ?? ''
  return {
    homeDir,
    cwd,
    projectMcpJson: join(cwd, '.mcp.json'),
    projectSettings: join(cwd, '.claude', 'settings.json'),
    projectSettingsLocal: join(cwd, '.claude', 'settings.local.json'),
    userClaudeJson: join(homeDir, '.claude.json'),
    userSettings: join(homeDir, '.claude', 'settings.json'),
    skillsDir: join(homeDir, '.claude', 'skills'),
    agentsDir: join(homeDir, '.claude', 'agents'),
    commandsDir: join(homeDir, '.claude', 'commands'),
    projectClaudeMd: join(cwd, 'CLAUDE.md'),
    shellRc: join(homeDir, /zsh/.test(shell) ? '.zshrc' : '.bashrc'),
    claudeVersion: ctx.claudeVersion ?? probeClaudeVersion,
  }
}
