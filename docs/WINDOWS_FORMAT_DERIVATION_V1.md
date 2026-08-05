# Windows format derivation v1

**Status:** implemented contract for unsigned portable and NSIS candidate derivation.

Metrora builds one canonical unpacked Windows application payload. The portable directory and NSIS installer are derived from isolated copies of that same payload rather than separate product builds.

This proves the relationship between formats without claiming reproducible NSIS bytes or official publisher authenticity.

## Candidate layout

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

An optional blockmap may appear beside the setup executable when produced by the packaging tool.

## Canonical payload

The canonical payload is the single `win-unpacked` directory produced after installing pinned dependencies, staging the bundled CLI, generating brand assets, building Electron main and renderer code and running the packaging hook.

`CANONICAL_PRODUCT_PAYLOAD.jsonl` records every file by canonical path, size and SHA-256.

The canonical directory is never passed directly to NSIS. It remains unchanged and is re-inventoried after installer creation.

## Portable derivation

The portable directory starts as a recursive copy of the canonical payload. Canonical application files must remain byte-identical.

Permitted portable-only additions are limited to:

- `README.txt`;
- `Run-Metrora-Baseline.cmd`;
- `Run-Metrora-Baseline.ps1`;
- release manifest, schema, inventory, attestation and metadata checksums.

Missing, changed or undeclared files fail verification.

## Installer derivation

The workflow creates a separate copy of the canonical payload and passes it to electron-builder through `--prepackaged`. It does not run a second application build for the installer.

Electron-builder may add the documented non-empty elevation helper under `resources/elevate.exe`. Any other product-payload drift fails the installer-source check.

Accepted installer output is one versioned setup executable plus an optional blockmap.

## Format derivation manifest

`FORMAT_DERIVATION.json` records:

- schema identity and digest;
- public source commit;
- product and version identity;
- Signal Grid identity;
- canonical payload inventory summary;
- portable release-manifest digest;
- exact portable-only file set;
- installer derivation method;
- installer output paths, sizes and digests;
- explicit reproducibility limits.

The format manifest is derivation evidence, not a second packaging configuration.

## Verification

The Windows workflow:

1. tests the manifest and derivation libraries;
2. builds the canonical unpacked payload once;
3. inventories it;
4. derives the portable copy and adds only allowed helpers;
5. creates and verifies the portable release manifest;
6. derives the NSIS source from an isolated canonical copy;
7. verifies that canonical files remain identical;
8. verifies that the original canonical directory did not change;
9. inventories installer outputs;
10. writes and verifies format metadata;
11. smoke-tests the portable CLI;
12. uploads the combined candidate.

A separate Ubuntu job downloads the candidate and repeats canonical inventory, portable comparison, source binding, installer-digest and format-metadata verification.

## Allowed claims and limits

Allowed:

> Portable and NSIS candidates derive from one verified canonical unpacked product payload.

This contract alone does not establish:

- byte-for-byte reproducible NSIS output;
- official publisher authenticity;
- trusted update-channel authenticity;
- platform acceptance or publication.

Installed-layout, migration and interruption behavior are validated by separate Windows contracts and workflow steps.

## Security and privacy boundary

- candidates remain unsigned unless a later protected channel explicitly states otherwise;
- public CI receives no signing authority;
- candidate metadata contains no endpoint, Workspace or user data;
- user-owned local state is not part of either product payload;
- deployment tooling may not alter product semantics after the canonical build.

## Evolution

A format-contract change requires an explicit version. Later installation evidence may reference this manifest but must not reinterpret the canonical payload or silently broaden permitted additions.
