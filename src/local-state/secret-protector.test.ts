import { describe, expect, it } from 'vitest'

import { Aes256GcmSecretProtector } from './secret-protector.js'

describe('AES-256-GCM secret protector', () => {
  it('round-trips bytes only with the same key and context', async () => {
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 3), {
      randomBytes: size => Buffer.alloc(size, 8),
    })
    const sealed = await protector.seal(Buffer.from('private endpoint material'), 'identity-v1')
    expect(Buffer.from(sealed).toString('utf-8')).not.toContain('private endpoint material')
    expect(Buffer.from(await protector.open(sealed, 'identity-v1')).toString('utf-8'))
      .toBe('private endpoint material')
    await expect(protector.open(sealed, 'different-context')).rejects.toThrow(/authenticated/)
    await expect(new Aes256GcmSecretProtector(Buffer.alloc(32, 4)).open(sealed, 'identity-v1'))
      .rejects.toThrow(/authenticated/)
  })

  it('rejects tampered envelopes and invalid key material', async () => {
    expect(() => new Aes256GcmSecretProtector(Buffer.alloc(31))).toThrow(/exactly 32 bytes/)
    const protector = new Aes256GcmSecretProtector(Buffer.alloc(32, 5))
    const sealed = Buffer.from(await protector.seal(Buffer.from('secret'), 'identity-v1'))
    sealed[sealed.length - 2] = sealed[sealed.length - 2]! ^ 1
    await expect(protector.open(sealed, 'identity-v1')).rejects.toThrow()
  })
})
