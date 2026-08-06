import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  buildAntigravityHookLookupPath,
  installAntigravityStatusLineHook,
  resolvePersistentCodeburnPathFromPath,
  resolvePersistentMetroraPathFromPath,
  uninstallAntigravityStatusLineHook,
} from '../src/antigravity-statusline.js'

type TempHookFixture = {
  dir: string
  settingsPath: string
  binDir: string
  metroraPath: string
  codeburnPath: string
}

function executableName(command: string): string {
  return process.platform === 'win32' ? `${command}.cmd` : command
}

async function writeExecutable(path: string): Promise<void> {
  await writeFile(path, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n')
  await chmod(path, 0o755)
}

describe('Antigravity CLI statusLine hook installer', () => {
  async function withTempSettings(run: (fixture: TempHookFixture) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'metrora-agy-hook-'))
    const settingsPath = join(dir, 'settings.json')
    const binDir = join(dir, 'bin')
    const metroraPath = join(binDir, executableName('metrora'))
    const codeburnPath = join(binDir, executableName('codeburn'))
    await mkdir(binDir, { recursive: true })
    await writeExecutable(metroraPath)
    await writeExecutable(codeburnPath)

    const previousSettingsPath = process.env['CODEBURN_ANTIGRAVITY_SETTINGS_PATH']
    const previousCacheDir = process.env['CODEBURN_CACHE_DIR']
    const previousPath = process.env.PATH
    process.env['CODEBURN_ANTIGRAVITY_SETTINGS_PATH'] = settingsPath
    process.env['CODEBURN_CACHE_DIR'] = join(dir, 'cache')
    process.env.PATH = binDir

    try {
      await run({ dir, settingsPath, binDir, metroraPath, codeburnPath })
    } finally {
      if (previousSettingsPath === undefined) delete process.env['CODEBURN_ANTIGRAVITY_SETTINGS_PATH']
      else process.env['CODEBURN_ANTIGRAVITY_SETTINGS_PATH'] = previousSettingsPath
      if (previousCacheDir === undefined) delete process.env['CODEBURN_CACHE_DIR']
      else process.env['CODEBURN_CACHE_DIR'] = previousCacheDir
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('builds a lookup PATH with user paths before fallbacks', () => {
    const lookupPath = buildAntigravityHookLookupPath(['/Users/me/.nvm/versions/node/v22.13.0/bin', '/usr/bin'].join(delimiter))

    expect(lookupPath.split(delimiter)).toContain('/Users/me/.nvm/versions/node/v22.13.0/bin')
    if (process.platform !== 'win32') expect(lookupPath.split(delimiter)).toContain('/opt/homebrew/bin')
  })

  it('skips transient npx metrora shims when resolving the canonical hook command', async () => {
    await withTempSettings(async ({ dir }) => {
      const npxBin = join(dir, '.npm', '_npx', 'abcd', 'node_modules', '.bin')
      const persistentBin = join(dir, 'persistent-bin')
      const npxMetrora = join(npxBin, executableName('metrora'))
      const persistentMetrora = join(persistentBin, executableName('metrora'))
      await mkdir(npxBin, { recursive: true })
      await mkdir(persistentBin, { recursive: true })
      await writeExecutable(npxMetrora)
      await writeExecutable(persistentMetrora)

      const resolved = await resolvePersistentMetroraPathFromPath([npxBin, persistentBin].join(delimiter))

      expect(resolved).toBe(persistentMetrora)
    })
  })

  it('prefers metrora globally even when a codeburn alias appears earlier on PATH', async () => {
    await withTempSettings(async ({ dir }) => {
      const legacyBin = join(dir, 'legacy-bin')
      const canonicalBin = join(dir, 'canonical-bin')
      const legacyCodeburn = join(legacyBin, executableName('codeburn'))
      const canonicalMetrora = join(canonicalBin, executableName('metrora'))
      await mkdir(legacyBin, { recursive: true })
      await mkdir(canonicalBin, { recursive: true })
      await writeExecutable(legacyCodeburn)
      await writeExecutable(canonicalMetrora)

      const resolved = await resolvePersistentMetroraPathFromPath([legacyBin, canonicalBin].join(delimiter))

      expect(resolved).toBe(canonicalMetrora)
    })
  })

  it('falls back to a persistent codeburn alias when metrora is unavailable', async () => {
    await withTempSettings(async ({ dir }) => {
      const legacyBin = join(dir, 'legacy-only')
      const legacyCodeburn = join(legacyBin, executableName('codeburn'))
      await mkdir(legacyBin, { recursive: true })
      await writeExecutable(legacyCodeburn)

      expect(await resolvePersistentMetroraPathFromPath(legacyBin)).toBe(legacyCodeburn)
      expect(await resolvePersistentCodeburnPathFromPath(legacyBin)).toBe(legacyCodeburn)
    })
  })

  it('reports the canonical command when neither persistent executable exists', async () => {
    await withTempSettings(async ({ dir }) => {
      const emptyBin = join(dir, 'empty-bin')
      await mkdir(emptyBin, { recursive: true })

      await expect(resolvePersistentMetroraPathFromPath(emptyBin))
        .rejects.toThrow(/persistent metrora command/)
    })
  })

  it('backs up and restores an existing custom statusLine when forced', async () => {
    await withTempSettings(async ({ dir, settingsPath }) => {
      const customStatusLine = {
        type: 'command',
        command: 'custom-statusline',
        padding: 1,
      }
      await writeFile(settingsPath, `${JSON.stringify({ statusLine: customStatusLine }, null, 2)}\n`)

      await expect(installAntigravityStatusLineHook(false)).rejects.toThrow('already has a custom statusLine')
      expect(await installAntigravityStatusLineHook(true)).toBe('installed')

      const installed = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(installed.statusLine.command).toContain('agy-statusline-hook')
      expect(installed.statusLine.command).not.toContain('custom-statusline')

      const backupPath = join(dir, 'cache', 'antigravity-statusline-previous.json')
      const backup = JSON.parse(await readFile(backupPath, 'utf-8'))
      expect(backup.statusLine).toEqual(customStatusLine)

      expect(await uninstallAntigravityStatusLineHook()).toBe('restored')
      const restored = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(restored.statusLine).toEqual(customStatusLine)
    })
  })

  it('installs the canonical metrora statusLine when no statusLine exists', async () => {
    await withTempSettings(async ({ settingsPath, metroraPath, codeburnPath }) => {
      expect(await installAntigravityStatusLineHook(false)).toBe('installed')
      expect(await installAntigravityStatusLineHook(false)).toBe('already-installed')

      const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(settings.statusLine).toMatchObject({
        type: 'command',
        padding: 0,
      })
      expect(settings.statusLine.command).toContain(metroraPath)
      expect(settings.statusLine.command).not.toContain(codeburnPath)
      expect(settings.statusLine.command).toContain('agy-statusline-hook')
      expect(settings.statusLine.command).not.toContain('dist/cli.js')
    })
  })

  it('repairs an existing stale legacy statusLine command without force', async () => {
    await withTempSettings(async ({ settingsPath, metroraPath }) => {
      await writeFile(settingsPath, JSON.stringify({
        statusLine: {
          type: 'command',
          command: "'/usr/local/bin/node' '/Users/me/codeburn-agy-statusline/dist/cli.js' agy-statusline-hook",
          padding: 0,
        },
      }))

      expect(await installAntigravityStatusLineHook(false)).toBe('installed')

      const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(settings.statusLine.command).toContain(metroraPath)
      expect(settings.statusLine.command).toContain('agy-statusline-hook')
      expect(settings.statusLine.command).not.toContain('codeburn-agy-statusline/dist/cli.js')
    })
  })

  it('treats a custom statusLine that only mentions the hook token as custom, not Metrora-owned', async () => {
    await withTempSettings(async ({ settingsPath }) => {
      const custom = 'mybar --note "runs agy-statusline-hook nightly"'
      await writeFile(settingsPath, JSON.stringify({
        statusLine: { type: 'command', command: custom, padding: 0 },
      }))

      await expect(installAntigravityStatusLineHook(false)).rejects.toThrow(/custom statusLine/)

      const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(settings.statusLine.command).toBe(custom)
    })
  })

  it('removes a legacy codeburn statusLine when there is no previous hook backup', async () => {
    await withTempSettings(async ({ settingsPath, metroraPath, codeburnPath }) => {
      await unlink(metroraPath)
      await writeFile(settingsPath, JSON.stringify({
        statusLine: {
          type: 'command',
          command: `${codeburnPath} agy-statusline-hook`,
          padding: 0,
        },
      }))

      expect(await uninstallAntigravityStatusLineHook()).toBe('removed')
      const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(settings).not.toHaveProperty('statusLine')
    })
  })
})
