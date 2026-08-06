# Metrora 1.0.0-rc.7 — GitHub pre-release record

## Status

**ACCEPTED — PUBLISHED AS GITHUB PRE-RELEASE**

Published on 2026-08-06 as an unsigned Windows x64 technical preview:

- release: [Metrora 1.0.0-rc.7 — Windows technical preview](https://github.com/maikolsiragusaa/metrora/releases/tag/v1.0.0-rc.7);
- tag: `v1.0.0-rc.7`;
- source commit: `e158ee34e570161c778162be77629b3a4dbb74fe`;
- product version: `1.0.0-rc.7`;
- Windows FileVersion: `1.0.0.7`;
- platform: Windows x64;
- signature status: unsigned;
- update model: manual;
- Microsoft Store status: not certified or published through the Store.

This is not the stable `1.0.0` release, a signed package or an automatic update channel.

## Accepted authority

- Candidate workflow: [`Metrora Windows Candidate` run 31099518584](https://github.com/maikolsiragusaa/metrora/actions/runs/31099518584)
- Candidate classification: `unsigned-release-candidate`
- Candidate artifact: `metrora-windows-candidate-e158ee34e570161c778162be77629b3a4dbb74fe.zip`
- Candidate artifact SHA-256: `f79bb8086d66a4ed462259de9d25fa0ed48945b219c3a79323eca7f86811221a`
- Release manifest SHA-256: `4ff273ae06779ae39a806343b3ea295daf1754d041710a926f287de3d4456301`
- Format derivation SHA-256: `28ce1f3f4daeb9b69fdbe3a0720da3bb7de2bf845ea1bb90a5916d176f71a81e`
- Physical acceptance report SHA-256: `1242c7d700debb4a98bca0563740358f1bdd9a90c7cfff31fc85495028a7015a`
- Physical acceptance result: PASS
- Migration baseline: `0.9.19` at `80c3a5a1a116a0bc2fd5352b9fee2afc58207f15`

The accepted two-profile Windows report verified existing-profile preservation, clean installation and removal, and the complete `0.9.19` → `1.0.0.7` migration, reinstall, rollback and re-upgrade sequence. The sanitized report contains no usernames, private paths, prompts, responses, Workspace identifiers, keys or evidence contents.

## Published assets

The GitHub pre-release contains these nine manually published assets plus GitHub's automatically generated source archives:

| Asset | SHA-256 |
| --- | --- |
| `Metrora-1.0.0-rc.7-Windows-x64-portable.zip` | `5806ad1e928f6cbf162470ff85fd16d6c900b5e74f51959ea74106bf1fafeacf` |
| `Metrora-Setup-1.0.0-rc.7.exe` | `360e99a2b2a342e4db852b862cb6f69ba462a8d79a56158003d7050c9ccb7b30` |
| `RELEASE_MANIFEST.json` | `4ff273ae06779ae39a806343b3ea295daf1754d041710a926f287de3d4456301` |
| `PAYLOAD_MANIFEST.jsonl` | `5b94ecc64159acf1702d65a72c4d3770dceac8506ee4d20c8c69a3f67c8d57d9` |
| `BUILD_ATTESTATION.json` | `df51faccd000b94738c1242af292edcee821f0fd5afe9c4768e72acf07795bdb` |
| `FORMAT_DERIVATION.json` | `28ce1f3f4daeb9b69fdbe3a0720da3bb7de2bf845ea1bb90a5916d176f71a81e` |
| `CANONICAL_PRODUCT_PAYLOAD.jsonl` | `bdcc6c6c2a0584e6c1aef5f6a9f50f0817b8518aaf9419d695d6f7fd1972de06` |
| `METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json` | `1242c7d700debb4a98bca0563740358f1bdd9a90c7cfff31fc85495028a7015a` |
| `SHA256SUMS.txt` | verify the listed payload hashes before running binaries |

The installer and portable ZIP were derived from the accepted candidate without rebuilding or patching product bytes.

## Included product boundary

Metrora is a local-first application for understanding AI-assisted development usage across supported tools, models, projects and sessions.

This candidate includes:

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
- Windows SmartScreen may show an unrecognized-app warning.
- Do not disable Windows security globally; verify `SHA256SUMS.txt` and make a deliberate per-file decision.
- Updates are manual; no automatic update channel is active.
- This candidate is not Microsoft Store certified.
- The release is Windows x64 only.
- Android remains an experimental companion and is not part of this release.
- macOS and Linux development sources do not imply accepted Metrora distributions.
- Provider evidence varies; Metrora keeps observed, derived, estimated and unavailable values distinct.

## Completed acceptance

- [x] Freeze one reviewed `main` commit.
- [x] Dispatch `Metrora Windows Candidate` as `unsigned-release-candidate` for that commit.
- [x] Confirm all applicable CI and Windows jobs pass.
- [x] Download the complete candidate artifact without modification.
- [x] Verify candidate manifests and source binding.
- [x] Complete physical acceptance report v2 with PASS.
- [x] Record artifact, manifest and report SHA-256 values.
- [x] Derive final release assets without rebuilding product bytes.
- [x] Verify final asset checksums from a separate directory.
- [x] Review release notes, SmartScreen guidance and rollback wording.
- [x] Receive explicit publication authorization.
- [x] Create tag `v1.0.0-rc.7` and the GitHub pre-release.
- [x] Verify the live release, asset inventory and visible hashes.
- [x] Publish truthful download access through `metrora.eu` after the GitHub release was live.

## Remaining gates

This publication does not authorize:

- promotion to stable `1.0.0`;
- replacement or mutation of the published binaries;
- an automatic update channel;
- signing or Microsoft Store claims;
- a Store package before exact Partner Center identity and Store-specific acceptance exist.

A compromised asset, checksum mismatch, privacy defect or materially false release statement remains a withdrawal condition.