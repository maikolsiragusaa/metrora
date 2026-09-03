// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  HarnessWorkspaceAuthority,
  HarnessWorkspaceStateStore,
  canonicalizeWorkspaceRoot,
  projectWorkspace,
  resolveWorkspacePath,
} from './harness-workspace.mjs'

describe('Harness Workspace authority', () => {
  it('requires an explicit canonical local folder and persists safe recovery state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-'))
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-state-'))
    try {
      await mkdir(path.join(root, 'src'))
      await writeFile(path.join(root, 'src', 'main.ts'), 'export const answer = 42\n')
      const authority = new HarnessWorkspaceAuthority()
      await expect(authority.setRoot(path.join(root, '.'))).resolves.toEqual(projectWorkspace(root))
      expect(authority.requireRoot()).toBe(await canonicalizeWorkspaceRoot(root))
      const state = new HarnessWorkspaceStateStore(stateRoot)
      await state.save(authority.requireRoot(), 'project')

      const recovered = new HarnessWorkspaceAuthority()
      const recoveredWorkspace = await new HarnessWorkspaceStateStore(stateRoot).recover(recovered)
      expect(recoveredWorkspace).toEqual(projectWorkspace(root))
      expect(recovered.requireRoot()).toBe(authority.requireRoot())
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(stateRoot, { recursive: true, force: true })
    }
  })

  it('rejects traversal and absolute paths outside the accepted Workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-containment-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-outside-'))
    try {
      await writeFile(path.join(root, 'inside.txt'), 'inside')
      await expect(resolveWorkspacePath(root, 'inside.txt')).resolves.toMatchObject({ relative: 'inside.txt' })
      await expect(resolveWorkspacePath(root, '../outside.txt', { allowMissing: true })).rejects.toThrow('escapes')
      await expect(resolveWorkspacePath(root, path.join(outside, 'outside.txt'), { allowMissing: true })).rejects.toThrow('escapes')
      await expect(resolveWorkspacePath(root, 'missing.txt')).rejects.toThrow('unavailable')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that resolves outside the Workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-link-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'metrora-harness-workspace-link-outside-'))
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'secret')
      try {
        await symlink(outside, path.join(root, 'external'), 'junction')
      } catch (error) {
        // Windows may deny junction creation in restricted test runners. The
        // lexical containment tests above still cover the fail-closed path.
        if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES') return
        throw error
      }
      await expect(resolveWorkspacePath(root, 'external/secret.txt')).rejects.toThrow('symlink')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
