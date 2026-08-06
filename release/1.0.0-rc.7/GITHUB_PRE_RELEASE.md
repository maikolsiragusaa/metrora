# Metrora 1.0.0-rc.7 — GitHub pre-release record

## Status

**PREPARATION — NOT ACCEPTED — NOT PUBLISHED**

This record prepares an unsigned Windows technical preview. It is not a stable release, signed package, Microsoft Store package or active update channel.

## Target

- Version: `1.0.0-rc.7`
- Desktop build version: `1.0.0.7`
- Platform: Windows x64
- Channel: GitHub pre-release
- Signature status: unsigned
- Tag target: `v1.0.0-rc.7`

The source commit, workflow run, artifact digests and physical report digest remain unset until one exact `main` candidate passes every required gate.

## Planned release assets

The accepted release bundle is expected to contain:

- a verified portable ZIP derived from the accepted portable directory;
- `Metrora-Setup-1.0.0-rc.7.exe` from the accepted candidate;
- `SHA256SUMS.txt` for every published asset;
- `RELEASE_MANIFEST.json`;
- `PAYLOAD_MANIFEST.jsonl`;
- `BUILD_ATTESTATION.json`;
- `FORMAT_DERIVATION.json`;
- `CANONICAL_PRODUCT_PAYLOAD.jsonl`;
- `METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json`.

No product binary may be rebuilt, patched or renamed ambiguously after physical acceptance.

## Draft release notes

Metrora is a local-first application for understanding AI-assisted development usage across supported tools, models, projects and sessions.

This release candidate includes:

- local collection across the registered provider integrations;
- cost, token, cache, session, model, project and tool analysis;
- date-effective historical pricing with explicit unavailable evidence;
- local Optimize, Compare, Budget, Plan, Audit and Doctor workflows;
- the desktop, CLI and local browser dashboard;
- local personal Workspace evidence, recovery and export foundations;
- verified Windows portable and NSIS derivation from one canonical payload;
- state-preserving installation, migration, rollback and recovery checks.

## Known limitations

- The Windows installer and portable application are unsigned.
- Windows SmartScreen may show a warning because no trusted publisher signature is attached.
- Updates are manual; no automatic update channel is active.
- This candidate is not Microsoft Store certified.
- The release is Windows x64 only.
- Android remains an experimental companion and is not part of this release.
- macOS and Linux development sources do not imply accepted Metrora distributions.
- Metrora must still distinguish observed, derived, estimated and unavailable evidence; not every provider exposes every metric.

## Required acceptance

- [ ] Freeze one reviewed `main` commit.
- [ ] Dispatch `Metrora Windows Candidate` as `unsigned-release-candidate` for that commit.
- [ ] Confirm all applicable CI and Windows jobs pass.
- [ ] Download the complete candidate artifact without modification.
- [ ] Verify candidate manifests and source binding.
- [ ] Complete physical acceptance report v2 with PASS.
- [ ] Record artifact, manifest and report SHA-256 values.
- [ ] Derive final release assets without rebuilding product bytes.
- [ ] Verify final asset checksums from a separate directory.
- [ ] Review release notes, SmartScreen guidance and rollback wording.
- [ ] Receive explicit publication authorization.
- [ ] Create the tag and GitHub pre-release.
- [ ] Update `metrora.eu` only after the GitHub release is live and verified.

## Stop conditions

Stop without publication when:

- source, version, run or artifact authority is ambiguous;
- any required automated gate fails or is stale;
- physical acceptance is not PASS;
- release assets differ from the accepted candidate;
- checksums or manifests do not verify;
- private data appears in metadata or reports;
- wording implies signing, Store certification, stability or automatic updates that do not exist.
