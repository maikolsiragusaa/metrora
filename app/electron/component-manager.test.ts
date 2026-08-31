import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ComponentManager,
  ComponentManagerError,
  getLlamaBenchCatalogEntry,
  validateComponentSource,
} from './component-manager'

const roots: string[] = []
const now = () => new Date('2026-08-31T12:00:00.000Z')

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, data)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8)
    directory.writeUInt32LE(crc32(data), 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + data.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBytes, end])
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'metrora-component-manager-'))
  roots.push(value)
  return value
}

function fixtureCatalog(data: Uint8Array) {
  const base = getLlamaBenchCatalogEntry('win32', 'x64')
  if (!base) throw new Error('test catalog missing')
  return { ...base, checksum: 'sha256:' + createHash('sha256').update(data).digest('hex') }
}

function responseFor(data: Uint8Array): Response {
  return new Response(Buffer.from(data), { status: 200, headers: { 'content-length': String(data.byteLength) } })
}

afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true })
})

describe('Metrora Component Manager V1', () => {
  it('reports not installed before acquisition and rejects non-approved sources', async () => {
    const manager = new ComponentManager({ rootDir: await root(), platform: 'win32', arch: 'x64' })
    await expect(manager.getStatus()).resolves.toMatchObject({ id: 'llama-bench', state: 'not-installed', executablePath: null, backend: 'cpu', variant: 'cpu' })
    expect(getLlamaBenchCatalogEntry('win32', 'x64')).toMatchObject({
      source: 'https://github.com/ggml-org/llama.cpp/releases/download/b10621/llama-b10621-bin-win-cpu-x64.zip',
      backend: 'cpu',
      variant: 'cpu',
      checksum: 'sha256:0e8b65e650e369f70f8307d890508886f171ef4fb00facccddd4a1b7ffdaca51',
    })
    expect(() => validateComponentSource('https://example.com/llama-bench.zip')).toThrowError(ComponentManagerError)
    expect(() => validateComponentSource('https://github.com/ggml-org/llama.cpp/releases/download/b10621/llama-b10621-bin-win-cpu-x64.zip?redirect=1')).toThrowError(/not approved/u)
  })

  it('downloads, verifies, extracts, and retains official provenance', async () => {
    const archive = zip([{ name: 'bin/llama-bench.exe', data: Buffer.from('MZ fixture') }, { name: 'bin/runtime.dll', data: Buffer.from('fixture') }])
    const events: string[] = []
    const fetchImpl = vi.fn(async () => responseFor(archive))
    const manager = new ComponentManager({
      rootDir: await root(),
      platform: 'win32',
      arch: 'x64',
      catalog: fixtureCatalog(archive),
      now,
      fetchImpl,
      onEvent: event => events.push(event.phase + ':' + (event.progress ?? 'indeterminate')),
    })
    const installed = await manager.install()
    expect(installed).toMatchObject({ state: 'installed', phase: 'installed', version: 'b10621', progress: 100 })
    expect(installed.executablePath).toContain('llama-bench.exe')
    expect(installed.provenance).toMatchObject({ repository: 'https://github.com/ggml-org/llama.cpp', version: 'b10621', checksumVerified: true, backend: 'cpu', variant: 'cpu' })
    await expect(readFile(installed.executablePath!, 'utf8')).resolves.toBe('MZ fixture')
    expect(events).toEqual(expect.arrayContaining(['downloading:0', 'verifying:94', 'extracting:97', 'installed:100']))
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'installed', executablePath: installed.executablePath, provenance: installed.provenance })
    await expect(manager.install()).resolves.toMatchObject({ state: 'installed', executablePath: installed.executablePath })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails on checksum mismatch and download failure without leaving an installed component', async () => {
    const archive = zip([{ name: 'llama-bench.exe', data: Buffer.from('fixture') }])
    const base = getLlamaBenchCatalogEntry('win32', 'x64')!
    const mismatch = new ComponentManager({
      rootDir: await root(),
      platform: 'win32',
      arch: 'x64',
      catalog: { ...base, checksum: 'sha256:' + '0'.repeat(64) },
      fetchImpl: vi.fn(async () => responseFor(archive)),
    })
    await expect(mismatch.install()).rejects.toMatchObject({ code: 'checksum-mismatch' })
    await expect(mismatch.getStatus()).resolves.toMatchObject({ state: 'failed', error: expect.stringContaining('checksum') })

    const failure = new ComponentManager({
      rootDir: await root(),
      platform: 'win32',
      arch: 'x64',
      catalog: fixtureCatalog(archive),
      fetchImpl: vi.fn(async () => { throw new Error('network failure') }),
    })
    await expect(failure.install()).rejects.toMatchObject({ code: 'download-failed' })
    await expect(failure.getStatus()).resolves.toMatchObject({ state: 'failed' })
  })

  it('cancels a pending download and exposes retryable terminal state', async () => {
    const archive = zip([{ name: 'llama-bench.exe', data: Buffer.from('fixture') }])
    const manager = new ComponentManager({
      rootDir: await root(),
      platform: 'win32',
      arch: 'x64',
      catalog: fixtureCatalog(archive),
      fetchImpl: vi.fn(async (_input, init) => {
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) reject(new Error('aborted'))
          else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          void resolve
        })
        return responseFor(archive)
      }),
    })
    const install = manager.install()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(manager.cancel()).toBe(true)
    await expect(install).rejects.toMatchObject({ code: 'cancelled' })
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'cancelled', phase: 'cancelled' })
  })

  it('reports unsupported platforms without probing the network', async () => {
    const fetchImpl = vi.fn()
    const manager = new ComponentManager({ rootDir: await root(), platform: 'freebsd', arch: 'x64', fetchImpl })
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'unsupported', executablePath: null })
    await expect(manager.install()).rejects.toMatchObject({ code: 'unsupported-platform' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
