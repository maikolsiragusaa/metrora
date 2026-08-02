# Windows format derivation v1

**Status:** public R1.B.A contract for unsigned installer and portable candidates

## Purpose

Metrora must not build the portable application and NSIS installer as two independent product payloads.

The Windows candidate workflow builds one canonical unpacked application directory, records its complete inventory, copies it into the portable format and passes the same directory to electron-builder through `--prepackaged` for NSIS creation.

This contract proves the relationship between those formats without claiming that NSIS bytes are reproducible or that an unsigned installer is an official release.

## Candidate layout

The downloaded candidate contains:

```text
Metrora-Windows-Candidate/
├── CANONICAL_PRODUCT_PAYLOAD.jsonl
├── FORMAT_DERIVATION.json
├── FORMAT_DERIVATION.schema.json
├── FORMAT_SHA256SUMS.txt
├── portable/
│   ├── Metrora.exe
│   ├── resources/...
│   ├── RELEASE_MANIFEST.json
│   └── ...
└── installer/
    └── Metrora-Setup-<version>.exe
```

An optional installer blockmap may appear beside the setup executable when the packaging tool produces one.

## Canonical payload

The canonical product payload is the one `win-unpacked` directory produced after:

1. installing pinned root and desktop dependencies;
2. staging the compatibility CLI;
3. generating canonical Signal Grid assets;
4. building Electron main and renderer code;
5. running electron-builder once with the unpacked-directory target;
6. completing the existing `afterPack` staging hook.

`CANONICAL_PRODUCT_PAYLOAD.jsonl` records every file in that directory by canonical path, size and SHA-256.

The source directory is re-inventoried after NSIS creation. Any mutation causes the workflow to fail.

## Portable derivation

The portable directory begins as a recursive copy of the canonical payload.

Canonical application files must remain byte-identical. The only permitted portable-only files are:

- `README.txt`;
- `Run-Metrora-Baseline.cmd`;
- `Run-Metrora-Baseline.ps1`;
- R1.A release manifest, schema, inventory, attestation and metadata checksum files.

Missing canonical files, changed canonical files or any undeclared extra file fail verification.

The R1.A verifier remains authoritative for the portable release manifest and source binding.

## Installer derivation

The NSIS installer is created by electron-builder using the same canonical unpacked directory through its `--prepackaged` option.

The workflow does not run a second application build for the installer.

Accepted installer outputs are:

- exactly one `Metrora-Setup-<version>.exe`;
- an optional `.blockmap` produced by the same packaging step.

Other files are not included in the candidate's installer directory.

R1.B.A records installer bytes and the derivation method. It does not yet prove the files installed by NSIS match the canonical payload; unattended install and post-install comparison belong to R1.B.B.

## Format derivation manifest

`FORMAT_DERIVATION.json` records:

- manifest schema and SHA-256;
- public source commit;
- canonical Metrora product identity and version;
- Signal Grid v1 identity;
- canonical payload inventory summary;
- portable release-manifest digest;
- exact portable-only file set;
- installer derivation method;
- every installer output path, size and SHA-256;
- explicit reproducibility limits.

`FORMAT_SHA256SUMS.txt` covers:

- canonical product payload inventory;
- format derivation manifest;
- format derivation schema.

The public source commit remains authoritative. The format manifest is evidence of derivation, not a second packaging configuration.

## Verification

The Windows workflow:

1. runs native manifest and derivation tests;
2. builds the canonical unpacked payload once;
3. prepares the portable copy and canonical inventory;
4. adds only documented portable helpers;
5. generates and verifies the R1.A portable manifest;
6. builds NSIS from the original unpacked directory with `--prepackaged`;
7. proves the original unpacked directory did not change;
8. proves the portable copy still contains identical canonical files;
9. inventories installer outputs;
10. writes and verifies the derivation manifest;
11. smoke-tests the portable CLI;
12. uploads the complete combined candidate.

A separate Ubuntu job downloads the candidate and repeats:

- canonical inventory validation;
- portable/canonical comparison;
- R1.A portable verification against canonical Git blobs;
- installer digest verification;
- format metadata verification.

Cross-platform verification proves content and derivation metadata. It does not run the Windows installer.

## Reproducibility language

Allowed R1.B.A claim:

> Portable and NSIS candidates derive from one verified canonical unpacked product payload.

Not yet allowed:

- installed NSIS files verified against the canonical payload;
- byte-for-byte reproducible NSIS output;
- official publisher authenticity;
- trusted update-channel authenticity;
- supported upgrade or rollback guarantees.

The manifest records `installerByteReproducibilityProven: false`.

## Security and privacy boundary

- all artifacts remain unsigned;
- public CI receives no signing authority;
- candidate metadata contains no endpoint, Workspace or user data;
- the installer cannot replace product bytes without changing the recorded format derivation;
- user-owned local state is not part of either product payload;
- clean install, uninstall, upgrade and rollback remain separate R1.B acceptance work.

## Evolution

A format-derivation contract change requires a new explicit version. R1.B.B may add installation evidence that references this v1 manifest; it must not silently reinterpret the canonical payload or permitted portable extras.
