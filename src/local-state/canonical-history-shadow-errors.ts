export class CanonicalHistoryShadowStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalHistoryShadowStoreIntegrityError'
  }
}
