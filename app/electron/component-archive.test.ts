import { gzipSync } from 'node:zlib'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { ComponentArchiveError, extractArchive, safeRelativePath } from './component-archive'

const roots: string[] = []

function tarGz(name: string, data: Uint8Array): Uint8Array {
  const header = Buffer.alloc(512)
  Buffer.from(name, 'utf8').copy(header, 0)
  Buffer.from(data.byteLength.toString(8).padStart(11, '0'), 'ascii').copy(header, 124)
  header[156] = 48
  const body = Buffer.from(data)
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]))
}

afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true })
})

describe('Component archive extraction boundary', () => {
  it('extracts a bounded TAR.GZ executable and returns a managed relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'metrora-component-archive-'))
    roots.push(root)
    const relativePath = await extractArchive(tarGz('bin/llama-bench', Buffer.from('fixture')), 'tar.gz', root, ['llama-bench'])
    expect(relativePath).toBe(join('bin', 'llama-bench'))
    await expect(readFile(join(root, relativePath), 'utf8')).resolves.toBe('fixture')
  })

  it('rejects archive paths that would escape the managed directory', () => {
    expect(() => safeRelativePath('../outside')).toThrow(ComponentArchiveError)
    expect(() => safeRelativePath('C:\\outside')).toThrow(ComponentArchiveError)
  })
})
