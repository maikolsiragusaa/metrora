import fs from 'node:fs'
import {
  fingerprintSourceFileSync,
  sourcePathCandidates,
  type SourceFileFingerprint,
} from './sqlite-source-fingerprint.js'

export type MainObservation = {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

export type WalObservation = {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

export type SourceProbe = {
  path: string
  main: MainObservation | null
  walPath: string
  wal: WalObservation | null
  hasLiveWal: boolean
  journalPath: string
  journal: WalObservation | null
  hasActiveJournal: boolean
}

export type SourceObservation = SourceProbe & {
  fingerprint: SourceFileFingerprint | null
  walMode: boolean
}

function readMainObservation(path: string): MainObservation | null {
  try {
    const stat = fs.statSync(path)
    if (!stat.isFile()) return null
    return {
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
    }
  } catch {
    return null
  }
}

function resolveSourceFile(
  sourcePath: string,
  preferredPath?: string,
): { path: string; main: MainObservation | null } {
  if (preferredPath !== undefined) {
    const preferredMain = readMainObservation(preferredPath)
    if (preferredMain !== null) return { path: preferredPath, main: preferredMain }
  }

  for (const candidate of [...new Set(sourcePathCandidates(sourcePath))]) {
    const main = readMainObservation(candidate)
    if (main !== null) return { path: candidate, main }
  }

  return { path: preferredPath ?? sourcePath, main: null }
}

export function resolveSourcePath(sourcePath: string, preferredPath?: string): string {
  return resolveSourceFile(sourcePath, preferredPath).path
}

function readSidecarObservation(path: string): WalObservation | null {
  try {
    const stat = fs.statSync(path)
    return {
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
    }
  } catch {
    return null
  }
}

function hasWalModeHeader(path: string): boolean {
  let handle: number | undefined
  try {
    handle = fs.openSync(path, 'r')
    const header = Buffer.alloc(20)
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0)
    // SQLite's file-format read/write version bytes are both 2 in WAL mode.
    return bytesRead === header.length && header[18] === 2 && header[19] === 2
  } catch {
    return false
  } finally {
    if (handle !== undefined) {
      try { fs.closeSync(handle) } catch { /* best effort */ }
    }
  }
}

export function probeSource(
  sourcePath: string,
  preferredPath?: string,
  previousWal?: WalObservation | null,
): SourceProbe {
  const resolved = resolveSourceFile(sourcePath, preferredPath)
  const walPath = `${resolved.path}-wal`
  const journalPath = resolved.path + '-journal'
  const wal = resolved.main === null
    ? null
    : previousWal === null && !fs.existsSync(walPath)
      ? null
      : readSidecarObservation(walPath)
  const journal = resolved.main === null ? null : readSidecarObservation(journalPath)
  return {
    path: resolved.path,
    main: resolved.main,
    walPath,
    wal,
    hasLiveWal: wal !== null && wal.size > 0,
    journalPath,
    journal,
    hasActiveJournal: journal !== null,
  }
}

export function observeSource(sourcePath: string): SourceObservation {
  const probe = probeSource(sourcePath)
  return {
    ...probe,
    fingerprint: fingerprintSourceFileSync(sourcePath),
    walMode: probe.main !== null && hasWalModeHeader(probe.path),
  }
}

function sameWalObservation(a: WalObservation | null, b: WalObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.size === b.size
}

export function sameMainIdentity(a: MainObservation | null, b: MainObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.dev === b.dev && a.ino === b.ino
}

function sameMainMetadata(a: MainObservation | null, b: MainObservation | null): boolean {
  if (a === null || b === null) return a === b
  return a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.size === b.size
}

export function sameSourceProbe(a: SourceProbe, b: SourceProbe): boolean {
  if (a.path !== b.path) return false
  if (a.main === null || b.main === null) {
    return a.main === b.main
      && sameWalObservation(a.wal, b.wal)
      && sameWalObservation(a.journal, b.journal)
  }
  return sameMainIdentity(a.main, b.main)
    && sameMainMetadata(a.main, b.main)
    && sameWalObservation(a.wal, b.wal)
    && sameWalObservation(a.journal, b.journal)
}

export function sourceProbeFromObservation(observation: SourceObservation): SourceProbe {
  return {
    path: observation.path,
    main: observation.main,
    walPath: observation.walPath,
    wal: observation.wal,
    hasLiveWal: observation.hasLiveWal,
    journalPath: observation.journalPath,
    journal: observation.journal,
    hasActiveJournal: observation.hasActiveJournal,
  }
}
