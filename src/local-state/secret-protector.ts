import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import * as z from 'zod/v4'

const SecretEnvelopeV1Schema = z.strictObject({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  nonceBase64: z.string().min(1),
  ciphertextBase64: z.string(),
  authTagBase64: z.string().min(1),
})

export interface SecretProtector {
  seal(plaintext: Uint8Array, context: string): Promise<Uint8Array>
  open(sealed: Uint8Array, context: string): Promise<Uint8Array>
}

function decodeExactBase64(value: string, expectedBytes: number, field: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== expectedBytes || decoded.toString('base64') !== value) {
    throw new Error(`${field} is not canonical ${expectedBytes}-byte base64`)
  }
  return decoded
}

function contextBytes(context: string): Buffer {
  const normalized = context.trim()
  if (!normalized) throw new Error('secret protector context must not be empty')
  return Buffer.from(normalized, 'utf-8')
}

export class Aes256GcmSecretProtector implements SecretProtector {
  readonly #key: Buffer
  readonly #randomBytes: (size: number) => Buffer

  constructor(key: Uint8Array, options: { randomBytes?: (size: number) => Buffer } = {}) {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
      throw new Error('AES-256-GCM protector key must contain exactly 32 bytes')
    }
    this.#key = Buffer.from(key)
    this.#randomBytes = options.randomBytes ?? randomBytes
  }

  async seal(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    if (!(plaintext instanceof Uint8Array)) throw new Error('secret plaintext must be bytes')
    const nonce = this.#randomBytes(12)
    if (nonce.byteLength !== 12) throw new Error('secret protector nonce source returned the wrong size')
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce)
    cipher.setAAD(contextBytes(context))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const authTag = cipher.getAuthTag()
    const envelope = SecretEnvelopeV1Schema.parse({
      version: 1,
      algorithm: 'aes-256-gcm',
      nonceBase64: nonce.toString('base64'),
      ciphertextBase64: ciphertext.toString('base64'),
      authTagBase64: authTag.toString('base64'),
    })
    return Buffer.from(JSON.stringify(envelope), 'utf-8')
  }

  async open(sealed: Uint8Array, context: string): Promise<Uint8Array> {
    if (!(sealed instanceof Uint8Array)) throw new Error('sealed secret must be bytes')
    let envelope: z.infer<typeof SecretEnvelopeV1Schema>
    try {
      envelope = SecretEnvelopeV1Schema.parse(JSON.parse(Buffer.from(sealed).toString('utf-8')))
    } catch {
      throw new Error('sealed secret envelope is invalid')
    }
    const nonce = decodeExactBase64(envelope.nonceBase64, 12, 'nonce')
    const authTag = decodeExactBase64(envelope.authTagBase64, 16, 'auth tag')
    const ciphertext = Buffer.from(envelope.ciphertextBase64, 'base64')
    if (ciphertext.toString('base64') !== envelope.ciphertextBase64) {
      throw new Error('ciphertext is not canonical base64')
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce)
      decipher.setAAD(contextBytes(context))
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new Error('sealed secret could not be authenticated')
    }
  }
}
