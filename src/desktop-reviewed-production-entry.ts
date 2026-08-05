// Narrow parser/cache entry loaded lazily by Electron's main process only when
// the user explicitly requests reviewed Workspace production. It owns no
// endpoint keys and exposes no renderer or network surface.
export {
  canonicalSourceRecordFingerprintSha256V1,
  CanonicalReviewedProductionScannerIntegrityError,
  scanCanonicalReviewedProductionCandidatesV1,
} from './local-state/canonical-reviewed-production-scanner.js'
export type {
  CanonicalReviewedProductionScannerDependenciesV1,
  CanonicalReviewedProductionScannerOptionsV1,
} from './local-state/canonical-reviewed-production-scanner.js'
