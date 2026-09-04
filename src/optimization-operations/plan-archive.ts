import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PlannedChange, ActionKind } from './types.js'
import { sha256 } from './backup.js'
import type { WasteFinding } from '../optimize.js'
import type { BuiltPlan, ResolvedPaths } from './plans.js'

function shortPath(path: string, homeDir: string): string {
  return path.startsWith(homeDir) ? '~' + path.slice(homeDir.length) : path
}

// ---------------------------------------------------------------------------
// Archive unused skills / agents / commands
// ---------------------------------------------------------------------------

const ARCHIVE_KIND: Record<'skill' | 'agent' | 'command', ActionKind> = {
  skill: 'archive-skill',
  agent: 'archive-agent',
  command: 'archive-command',
}

function withSuffix(base: string, n: number): string {
  const dot = base.lastIndexOf('.')
  return dot === -1 ? `${base}-${n}` : `${base.slice(0, dot)}-${n}${base.slice(dot)}`
}

export function buildArchive(finding: WasteFinding, r: ResolvedPaths, capability: 'skill' | 'agent' | 'command'): BuiltPlan {
  const names = finding.apply?.kind === 'archive' ? finding.apply.names : []
  const baseDir = capability === 'skill' ? r.skillsDir : capability === 'agent' ? r.agentsDir : r.commandsDir
  const isDir = capability === 'skill'
  const archivedDir = join(baseDir, '.archived')
  const changes: PlannedChange[] = []
  const notes: string[] = []
  const claimed = new Set<string>()

  for (const name of names) {
    const source = isDir ? join(baseDir, name) : join(baseDir, `${name}.md`)
    if (!existsSync(source)) {
      notes.push(`skipped ${name}: ${shortPath(source, r.homeDir)} no longer exists`)
      continue
    }
    const destBase = isDir ? name : `${name}.md`
    let dest = join(archivedDir, destBase)
    let n = 2
    while (existsSync(dest) || claimed.has(dest)) {
      dest = join(archivedDir, withSuffix(destBase, n))
      n++
    }
    claimed.add(dest)
    changes.push({ op: 'move', path: source, movedTo: dest })
  }

  if (changes.length === 0) return { plan: null, notes }
  return {
    plan: {
      kind: ARCHIVE_KIND[capability],
      findingId: finding.id,
      description: `Archive ${changes.length} unused ${capability}${changes.length === 1 ? '' : 's'}`,
      changes,
    },
    notes,
  }
}

// ---------------------------------------------------------------------------
// Marker-block edits (CLAUDE.md rule, shell rc)
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function upsertMarkerBlock(existing: string | null, id: string, text: string, style: 'html' | 'hash'): string {
  const begin = style === 'html' ? `<!-- metrora:begin ${id} -->` : `# metrora:begin ${id}`
  const end = style === 'html' ? `<!-- metrora:end ${id} -->` : `# metrora:end ${id}`
  const block = `${begin}\n${text}\n${end}\n`
  if (!existing) return block
  const region = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`)
  if (region.test(existing)) return existing.replace(region, block)
  return existing.endsWith('\n') ? existing + block : existing + '\n' + block
}

function markerChange(target: string, id: string, text: string, style: 'html' | 'hash'): PlannedChange {
  const buf = existsSync(target) ? readFileSync(target) : null
  const existing = buf === null ? null : buf.toString('utf-8')
  return {
    op: buf === null ? 'create' : 'edit',
    path: target,
    content: upsertMarkerBlock(existing, id, text, style),
    expectedHash: buf === null ? null : sha256(buf),
  }
}

export function buildClaudeMdRule(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  if (finding.fix.type !== 'paste') return { plan: null, notes: [] }
  const target = r.projectClaudeMd
  return {
    plan: {
      kind: 'claude-md-rule',
      findingId: finding.id,
      description: `Add the ${finding.id} rule block to ${shortPath(target, r.homeDir)}`,
      changes: [markerChange(target, finding.id, finding.fix.text, 'html')],
    },
    notes: [],
  }
}

export function buildShellConfig(finding: WasteFinding, r: ResolvedPaths): BuiltPlan {
  if (finding.fix.type !== 'paste') return { plan: null, notes: [] }
  const target = r.shellRc
  return {
    plan: {
      kind: 'shell-config',
      findingId: finding.id,
      description: `Set the bash output cap in ${shortPath(target, r.homeDir)}`,
      changes: [markerChange(target, finding.id, finding.fix.text, 'hash')],
    },
    notes: [],
  }
}
