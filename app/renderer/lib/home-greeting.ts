export type HomeGreeting = 'Good morning' | 'Good afternoon' | 'Good evening'

export function greetingForHour(hour: number): HomeGreeting {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Workspace names are the only personal display-name authority exposed to the
 * renderer today. Treat the bootstrap defaults as labels, not as a person's
 * name, so the Home can fall back gracefully instead of greeting "My".
 */
export function displayNameFromWorkspaceStatus(status: unknown): string | null {
  if (!status || typeof status !== 'object') return null

  const record = status as { availability?: unknown; snapshot?: unknown }
  if (record.availability !== 'ready' || !record.snapshot || typeof record.snapshot !== 'object') return null

  const snapshot = record.snapshot as { workspace?: unknown }
  if (!snapshot.workspace || typeof snapshot.workspace !== 'object') return null

  const workspace = snapshot.workspace as { displayName?: unknown }
  if (typeof workspace.displayName !== 'string') return null

  const raw = workspace.displayName.trim()
  if (!raw || raw.length > 48) return null

  const normalized = raw.toLowerCase()
  if (['my workspace', 'personal workspace', 'local workspace', 'workspace', 'this computer', 'primary desktop', 'default workspace'].includes(normalized)) return null

  const name = raw.replace(/\s+(?:personal\s+)?workspace$/i, '').trim()
  if (!name || ['my', 'local', 'personal', 'default', 'this', 'primary'].includes(name.toLowerCase())) return null

  return name
}
