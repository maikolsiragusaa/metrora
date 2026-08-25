import { describe, expect, it, vi } from 'vitest'

import {
  decodeShareCardPngDataUrl,
  sanitizeShareCardFilename,
  saveShareCardPng,
} from './share-card-export'

function pngDataUrl(extraBytes = 0): string {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extraBytes, 0),
  ])
  return `data:image/png;base64,${bytes.toString('base64')}`
}

describe('ShareCard PNG export', () => {
  it('accepts only bounded PNG payloads with a real PNG signature', () => {
    expect(decodeShareCardPngDataUrl(pngDataUrl())).toHaveLength(8)
    expect(() => decodeShareCardPngDataUrl('data:text/plain;base64,SGVsbG8=')).toThrow(/must be a PNG/u)
    expect(() => decodeShareCardPngDataUrl('data:image/png;base64,SGVsbG8=')).toThrow(/payload is invalid/u)
    expect(() => decodeShareCardPngDataUrl('data:image/png;base64,not base64')).toThrow(/encoding is invalid/u)
  })

  it('sanitizes the suggested leaf filename without accepting a renderer path', () => {
    expect(sanitizeShareCardFilename('../../Secret Folder/my recap.png')).toBe('my-recap.png')
    expect(sanitizeShareCardFilename('')).toBe('metrora-ai-recap.png')
  })

  it('writes only after the user accepts the native save dialog and returns no path', async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: false, filePath: 'C:\\Users\\test\\recap' })
    const writeFile = vi.fn().mockResolvedValue(undefined)

    const saved = await saveShareCardPng('../../private-name.png', pngDataUrl(), { showSaveDialog, writeFile })

    expect(saved).toBe(true)
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'private-name.png',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    }))
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0][0]).toBe('C:\\Users\\test\\recap.png')
    expect(writeFile.mock.calls[0][1]).toBeInstanceOf(Uint8Array)
  })

  it('does not write when the save dialog is cancelled', async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true })
    const writeFile = vi.fn()

    await expect(saveShareCardPng('recap.png', pngDataUrl(), { showSaveDialog, writeFile })).resolves.toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
