# Windows release candidate manifest v1

**Status:** public R1.A contract for unsigned Windows candidates

## Purpose

Metrora Windows candidates must be traceable to one reviewed public source and independently verifiable after download.

This contract separates three different claims:

1. **Payload integrity** — every file in the candidate directory is inventoried by path, size and SHA-256.
2. **Source/input binding** — the manifest records the public source commit, tree, source timestamp and hashes of release-critical build inputs.
3. **Build-run attestation** — variable CI metadata is bound to the deterministic manifest without becoming part of it.

R1.A does not claim byte-for-byte reproduction of Electron output, NSIS output or the GitHub artifact ZIP. That claim requires separate evidence and remains future work.

## Candidate files

A candidate directory contains:

- `RELEASE_MANIFEST.json` — deterministic product, source, build-input and payload summary;
- `RELEASE_MANIFEST.schema.json` — the exact public v1 schema copied from the source;
- `PAYLOAD_MANIFEST.jsonl` — one canonically sorted JSON record per payload file;
- `BUILD_ATTESTATION.json` — variable CI run metadata bound to the manifest digest;
- `SHA256SUMS.txt` — checksums for the four metadata files above;
- the Metrora application payload.

Release metadata files are excluded from the payload inventory to avoid circular hashing. They are verified through the manifest/attestation/checksum chain.

## Deterministic manifest

`RELEASE_MANIFEST.json` records:

- canonical Metrora product name, package name, application ID, version and homepage;
- Signal Grid identity name and version;
- public repository, source commit, Git tree and `SOURCE_DATE_EPOCH` equivalent;
- Windows target and candidate classification;
- exact Node, Electron and electron-builder versions;
- hashes of root/app lockfiles, package definitions, workflow and brand identity source;
- manifest-schema hash;
- payload inventory hash, file count and total bytes;
- an explicit reproducibility statement.

The manifest does not include workflow run IDs, mutable timestamps, runner image labels or branch names.

Two builds with identical source, declared tool versions, build-input files and payload bytes produce the same release manifest and payload inventory even when the CI run metadata differs.

## Build attestation

`BUILD_ATTESTATION.json` records the individual build execution:

- manifest SHA-256;
- automation provider and workflow;
- run ID and attempt;
- source ref;
- build time;
- runner OS and image label.

The attestation is expected to vary between runs. It does not change the deterministic manifest or payload inventory.

A future signing tranche may bind additional protected signing evidence to the accepted unsigned manifest. Public CI does not sign or hold signing authority.

## Payload inventory

Each non-empty line in `PAYLOAD_MANIFEST.jsonl` is a strict JSON object:

```json
{"path":"resources/app.asar","size":123456,"sha256":"..."}
```

Rules:

- paths use `/` separators;
- paths are relative and traversal-free;
- entries are sorted by deterministic code-point order;
- paths are unique;
- sizes are non-negative safe integers;
- SHA-256 digests use lowercase hexadecimal;
- every payload file is listed;
- no unlisted payload file is permitted.

Filesystem links or other unsupported entry types fail candidate creation rather than being interpreted differently across operating systems.

## Independent verification

The canonical verifier:

1. validates the manifest identity and supported version;
2. checks the expected source commit when supplied;
3. re-hashes the release-critical files in the checked-out source;
4. verifies the source schema matches the bundled schema;
5. validates metadata checksums;
6. verifies the attestation binds the manifest;
7. re-inventories every downloaded payload file;
8. rejects missing, extra, resized or modified files.

The Windows workflow verifies before upload. A separate Ubuntu job downloads the uploaded artifact and repeats verification against the same source commit.

Verification on another operating system proves content and source binding, not Windows executable behavior or signature validity.

## Candidate classifications

### `unsigned-development-artifact`

Used for pull requests, ordinary main-branch validation and controlled engineering tests. It is not an official release.

### `unsigned-release-candidate`

Used only through an explicit workflow dispatch when the source is intended for a later protected signing/acceptance step. It is still not an official release and must remain clearly separated from signed downloads.

An official signed release requires R1.B–R1.E acceptance and protected signing evidence.

## Reproducibility language

Allowed R1.A claim:

> Payload contents and build inputs are deterministic and independently verifiable.

Not yet allowed:

- byte-for-byte reproducible Electron directory;
- byte-for-byte reproducible NSIS installer;
- byte-for-byte reproducible GitHub artifact ZIP;
- official publisher authenticity;
- trusted update-channel authenticity.

The manifest records `byteForByteArchiveProven: false` and verification rejects a contrary claim under v1.

## Security and privacy boundary

- public workflows receive no signing keys or protected release credentials;
- manifest and attestation contain no endpoint identity, Workspace data, local paths, prompts, responses, code or user content;
- candidate metadata exposes only public source/build information;
- private signing may not alter product semantics after public acceptance;
- development candidates remain visibly distinct from official releases.

## Compatibility and evolution

Manifest v1 is append-resistant through strict verification and an explicit schema. A future version uses a new `kind`/version contract or a documented compatible extension; it must not silently reinterpret v1 fields.

The public source commit remains the final authority for code and contract meaning. The manifest is an evidence index, not a second release database.
