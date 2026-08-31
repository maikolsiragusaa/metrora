import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

export type ArchiveFormat = 'zip' | 'tar.gz'

const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 512
const MAX_MEMBER_BYTES = 256 * 1024 * 1024
const MAX_MEMBER_NAME_BYTES = 512

export class ComponentArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComponentArchiveError'
  }
}

function archiveError(message: string): ComponentArchiveError {
  return new ComponentArchiveError(message)
}

export function safeRelativePath(raw: string): string {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_MEMBER_NAME_BYTES) throw archiveError('Component archive contains an invalid path.')
  const normalized = raw.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) || normalized.includes('\u0000')) {
    throw archiveError('Component archive contains an unsafe path.')
  }
  const parts = normalized.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.some(part => part === '..' || part.includes('\u0000'))) {
    throw archiveError('Component archive contains an unsafe path.')
  }
  return parts.join(sep)
}

function ensureInside(root: string, candidate: string): void {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const rest = relative(rootPath, candidatePath)
  if (rest === '..' || rest.startsWith('..' + sep) || rest.startsWith(sep) || /^[A-Za-z]:/u.test(rest)) {
    throw archiveError('Component archive escaped its managed directory.')
  }
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decodeArchiveName(value: Uint8Array, utf8: boolean): string {
  try {
    return utf8
      ? new TextDecoder('utf-8', { fatal: true }).decode(value)
      : Buffer.from(value).toString('utf8')
  } catch {
    throw archiveError('Component archive contains an invalid filename.')
  }
}

async function writeMember(destinationRoot: string, rawName: string, data: Uint8Array, written: Set<string>, total: { value: number }, executableNames: readonly string[]): Promise<string> {
  const member = safeRelativePath(rawName)
  if (written.has(member)) throw archiveError('Component archive contains duplicate files.')
  if (data.byteLength > MAX_MEMBER_BYTES || total.value + data.byteLength > MAX_EXTRACTED_BYTES) {
    throw archiveError('Component archive is too large.')
  }
  written.add(member)
  total.value += data.byteLength
  const destination = join(destinationRoot, member)
  ensureInside(destinationRoot, destination)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, data)
  if (executableNames.some(name => name.toLowerCase() === basename(member).toLowerCase())) {
    await chmod(destination, 0o755).catch(() => undefined)
  }
  return member
}

async function extractZip(input: Uint8Array, destinationRoot: string, executableNames: readonly string[]): Promise<string[]> {
  const bytes = Buffer.from(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset++) {
    if (view.getUint32(offset, true) === 0x06054b50) end = offset
  }
  if (end < 0) throw archiveError('Component archive is not a supported ZIP file.')
  const entryCount = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  const centralEnd = centralOffset + centralSize
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralEnd > bytes.length) {
    throw archiveError('Component archive has invalid directory bounds.')
  }
  const written = new Set<string>()
  const files: string[] = []
  const total = { value: 0 }
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) throw archiveError('Component archive has an invalid directory entry.')
    const madeBy = view.getUint16(cursor + 4, true)
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const expectedCrc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameSize = view.getUint16(cursor + 28, true)
    const extraSize = view.getUint16(cursor + 30, true)
    const commentSize = view.getUint16(cursor + 32, true)
    const externalAttributes = view.getUint32(cursor + 38, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameSize
    if (nameSize > MAX_MEMBER_NAME_BYTES || nameEnd + extraSize + commentSize > centralEnd) throw archiveError('Component archive has an invalid filename entry.')
    const rawName = decodeArchiveName(bytes.subarray(nameStart, nameEnd), Boolean(flags & 0x800))
    const isDirectory = rawName.endsWith('/')
    if (flags & 1) throw archiveError('Encrypted component archives are not supported.')
    const mode = externalAttributes >>> 16
    if ((madeBy >>> 8) === 3 && (mode & 0xf000) === 0xa000) throw archiveError('Component archives may not contain symbolic links.')
    if (!isDirectory) {
      if (uncompressedSize > MAX_MEMBER_BYTES || total.value + uncompressedSize > MAX_EXTRACTED_BYTES) throw archiveError('Component archive is too large.')
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw archiveError('Component archive has an invalid local entry.')
      const localNameSize = view.getUint16(localOffset + 26, true)
      const localExtraSize = view.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + localNameSize + localExtraSize
      if (dataStart + compressedSize > bytes.length) throw archiveError('Component archive has invalid compressed data bounds.')
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
      let data: Uint8Array
      try {
        data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : (() => { throw new Error('method') })()
      } catch {
        throw archiveError('Component archive contains unsupported or corrupt compressed data.')
      }
      if (data.byteLength !== uncompressedSize || crc32(data) !== expectedCrc) throw archiveError('Component archive checksum is invalid.')
      files.push(await writeMember(destinationRoot, rawName, data, written, total, executableNames))
    } else {
      const directory = safeRelativePath(rawName)
      ensureInside(destinationRoot, join(destinationRoot, directory))
      await mkdir(join(destinationRoot, directory), { recursive: true })
    }
    cursor = nameEnd + extraSize + commentSize
  }
  if (cursor > centralEnd) throw archiveError('Component archive directory bounds are inconsistent.')
  return files
}

function parseTarSize(value: Uint8Array): number {
  const raw = Buffer.from(value).toString('ascii').replace(/\0/g, '').trim()
  if (!raw || !/^[0-7]+$/u.test(raw)) throw archiveError('Component archive contains an invalid TAR size.')
  const parsed = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw archiveError('Component archive contains an invalid TAR size.')
  return parsed
}

async function extractTarGz(input: Uint8Array, destinationRoot: string, executableNames: readonly string[]): Promise<string[]> {
  let bytes: Buffer
  try { bytes = gunzipSync(input) } catch { throw archiveError('Component archive is not a supported gzip file.') }
  if (bytes.byteLength > MAX_EXTRACTED_BYTES) throw archiveError('Component archive is too large.')
  const written = new Set<string>()
  const files: string[] = []
  const total = { value: 0 }
  let cursor = 0
  let entries = 0
  while (cursor + 512 <= bytes.length) {
    const header = bytes.subarray(cursor, cursor + 512)
    if (header.every(value => value === 0)) break
    entries += 1
    if (entries > MAX_ARCHIVE_ENTRIES) throw archiveError('Component archive contains too many entries.')
    const name = Buffer.from(header.subarray(0, 100)).toString('utf8').replace(/\0.*$/u, '')
    const prefix = Buffer.from(header.subarray(345, 500)).toString('utf8').replace(/\0.*$/u, '')
    const rawName = prefix ? prefix + '/' + name : name
    const size = parseTarSize(header.subarray(124, 136))
    const type = header[156] ?? 0
    const dataStart = cursor + 512
    const paddedSize = Math.ceil(size / 512) * 512
    if (dataStart + paddedSize > bytes.length) throw archiveError('Component archive has invalid TAR bounds.')
    if (type === 0 || type === 48) {
      if (size > MAX_MEMBER_BYTES || total.value + size > MAX_EXTRACTED_BYTES) throw archiveError('Component archive is too large.')
      files.push(await writeMember(destinationRoot, rawName, bytes.subarray(dataStart, dataStart + size), written, total, executableNames))
    } else if (type === 5) {
      const directory = safeRelativePath(rawName)
      ensureInside(destinationRoot, join(destinationRoot, directory))
      await mkdir(join(destinationRoot, directory), { recursive: true })
    } else {
      throw archiveError('Component archives may contain only regular files and directories.')
    }
    cursor = dataStart + paddedSize
  }
  return files
}

export async function extractArchive(input: Uint8Array, format: ArchiveFormat, destinationRoot: string, executableNames: readonly string[]): Promise<string> {
  const files = format === 'zip'
    ? await extractZip(input, destinationRoot, executableNames)
    : await extractTarGz(input, destinationRoot, executableNames)
  const executable = files.find(value => executableNames.some(name => name.toLowerCase() === basename(value).toLowerCase()))
  if (!executable) throw archiveError('The official component archive did not contain llama-bench.')
  return executable
}
