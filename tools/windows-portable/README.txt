METRORA WINDOWS PORTABLE VALIDATION CANDIDATE
=============================================

This is an unsigned Metrora artifact for controlled Windows validation. It is
not an official signed release.

USAGE
-----

1. Extract the whole GitHub Actions artifact ZIP.
2. Keep every file in the extracted folder together.
3. Verify the release metadata described below.
4. Open Metrora.exe for normal desktop validation.
5. Use Run-Metrora-Baseline.cmd only when a diagnostic baseline package is
   specifically required.

The optional baseline script produces:

- a shareable Metrora-Baseline-*.zip containing Metrora reports;
- compatibility comparison reports when the legacy comparison CLI is available;
- a separate PRIVATE-DO-NOT-UPLOAD cache backup when the inherited cache exists.

The private cache backup is for rollback and forensic comparison only. It is
never included in the shareable ZIP and must be kept locally.

NO REPOSITORY OR NODE INSTALLATION IS REQUIRED
-----------------------------------------------

The portable folder contains Electron, the Metrora desktop application and the
self-contained compatibility CLI runtime.

RELEASE METADATA
----------------

Verify these files before running the candidate:

- RELEASE_MANIFEST.json — deterministic product, source, build-input and payload
  summary;
- RELEASE_MANIFEST.schema.json — versioned public manifest schema;
- PAYLOAD_MANIFEST.jsonl — sorted SHA-256 and size inventory for every payload
  file;
- BUILD_ATTESTATION.json — variable GitHub Actions run metadata bound to the
  deterministic manifest;
- SHA256SUMS.txt — checksums for the release metadata files.

The candidate claims content-addressed verification only. Byte-for-byte
reproduction of the Electron directory or downloaded artifact ZIP is not yet
claimed.

PRIVACY
-------

Nothing is uploaded automatically. Baseline reports do not intentionally export
prompts, responses, source code, patches or credentials, but they can contain
project labels, local probe paths, model/provider names and session identifiers.
Review a diagnostic ZIP before sending it anywhere.

UNSIGNED BUILD
--------------

Windows SmartScreen may warn because this validation artifact is not code
signed. Official signed Metrora releases do not exist yet. Development and
unsigned release-candidate artifacts must remain separate from future official
signed downloads.
