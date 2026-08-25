import path from 'node:path'

export const SHARE_CARD_MAX_PNG_BYTES = 5 * 1024 * 1024

export type ShareCardSaveDialogOptions = {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

export type ShareCardExportDeps = {
  showSaveDialog(options: ShareCardSaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  writeFile(filePath: string, data: Uint8Array): Promise<void>
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}

export function decodeShareCardPngDataUrl(dataUrl: string): Uint8Array {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Share card export must be a PNG data URL.')
  }
  const encoded = dataUrl.slice('data:image/png;base64,'.length)
  if (!encoded || encoded.length > Math.ceil(SHARE_CARD_MAX_PNG_BYTES * 4 / 3) + 8) {
    throw new Error('Share card PNG is empty or too large.')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('Share card PNG encoding is invalid.')
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length === 0 || decoded.length > SHARE_CARD_MAX_PNG_BYTES || !hasPngSignature(decoded)) {
    throw new Error('Share card PNG payload is invalid.')
  }
  return decoded
}

export function sanitizeShareCardFilename(input: string): string {
  const leaf = path.basename(typeof input === 'string' ? input : '')
  const normalized = leaf
    .replace(/\.png$/iu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
  return `${normalized || 'metrora-ai-recap'}.png`
}

export async function saveShareCardPng(
  suggestedName: string,
  dataUrl: string,
  deps: ShareCardExportDeps,
): Promise<boolean> {
  const png = decodeShareCardPngDataUrl(dataUrl)
  const safeName = sanitizeShareCardFilename(suggestedName)
  const result = await deps.showSaveDialog({
    title: 'Save Metrora share card',
    defaultPath: safeName,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return false
  const target = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : `${result.filePath}.png`
  await deps.writeFile(target, png)
  return true
}
