# Windows release candidate manifest v1

**Status:** implemented public contract for unsigned Windows engineering candidates.

Metrora Windows candidates must be traceable to one reviewed public source commit and independently verifiable after download.

This contract separates:

1. **Payload integrity** — every candidate payload file is inventoried by path, size and SHA-256.
2. **Source and input binding** — the manifest records the source commit, tree, timestamp and release-critical Git blobs.
3. **Build-run attestation** — variable CI execution metadata is bound to the deterministic manifest without becoming part of it.

It does not claim byte-for-byte reproduction of Electron, NSIS or archive output.

## Candidate files

The portable candidate contains:

- `RELEASE_MANIFEST.json` — deterministic product, source, build-input and payload summary;
- `RELEASE_MANIFEST.schema.json` — the public schema copied from the declared commit;
- `PAYLOAD_MANIFEST.jsonl` — one sorted record per payload file;
- `BUILD_ATTESTATION.json` — build execution metadata bound to the manifest digest;
- `SHA256SUMS.txt` — checksums for the metadata files;
- the Metrora application payload.

Release metadata is excluded from the payload inventory to avoid circular hashing and is verified through its own checksum chain.

## Deterministic manifest

`RELEASE_MANIFEST.json` records:

- product name, package name, application ID, version and homepage;
- Signal Grid identity;
- source repository, commit, tree and timestamp;
- Windows target and candidate classification;
- exact Node, Electron and electron-builder versions;
- hashes of release-critical package, lockfile, workflow and brand-source blobs;
- schema hash;
- payload inventory digest, file count and byte count;
- explicit reproducibility limits.

Mutable workflow-run identifiers, branch labels and build timestamps stay in the separate attestation.

## Canonical source authority

Release-critical inputs are read as bytes from the declared Git commit rather than the materialized checkout. This prevents line-ending conversion from changing input hashes across operating systems.

Verification also proves that declared tree and timestamp belong to the commit, required inputs are complete, package identity agrees with source metadata, tool versions agree with lockfiles and the bundled schema matches the source blob.

## Build attestation

`BUILD_ATTESTATION.json` records the individual execution, including manifest digest, automation provider, workflow, run and attempt, source ref, build time and runner identity.

The attestation is expected to vary between runs. It does not change the deterministic payload or source manifest.

Public pull-request CI does not hold signing authority.

## Payload inventory

Each non-empty `PAYLOAD_MANIFEST.jsonl` line is a strict object:

```json
{"path":"resources/app.asar","size":123456,"sha256":"..."}
```

Paths are relative, traversal-free, unique, `/`-separated and deterministically sorted. Sizes are non-negative safe integers and digests are lowercase SHA-256. Missing, additional or unsupported filesystem entries fail verification.

## Independent verification

The verifier:

1. validates manifest identity and schema;
2. checks the expected source commit when supplied;
3. verifies source tree and timestamp;
4. re-hashes the fixed input set from Git blobs;
5. verifies package and toolchain metadata;
6. verifies the bundled schema;
7. validates metadata checksums and attestation binding;
8. re-inventories every downloaded payload file;
9. rejects missing, additional, resized or modified files.

The Windows workflow verifies before upload. A separate Ubuntu job downloads the uploaded candidate and repeats content and source-binding verification.

Cross-platform verification proves bytes and provenance, not Windows runtime behavior or signature validity.

## Candidate classifications

### `unsigned-development-artifact`

Used for ordinary validation and controlled engineering tests. It is not an official release.

### `unsigned-release-candidate`

Used through explicit workflow dispatch when source is being evaluated for a later protected distribution step. It remains unsigned and must not be presented as an official channel package.

## Allowed claims

Allowed:

> Payload contents and declared build inputs are deterministic and independently verifiable.

Not established by this contract:

- byte-for-byte reproducible Electron, NSIS or archive output;
- official publisher authenticity;
- trusted update-channel authenticity;
- acceptance by a distribution platform.

## Security and privacy boundary

- public workflows receive no signing keys or protected release credentials;
- candidate metadata contains no endpoint, Workspace or user data;
- private signing or channel packaging may not alter already reviewed product semantics;
- development candidates remain visibly distinct from official releases.

An official distribution requires exact platform-issued product identity, platform-specific acceptance and an explicit publication decision. See [Windows distribution](WINDOWS_DISTRIBUTION.md).

## Compatibility and evolution

Manifest v1 is strict. A future contract uses a new version or documented compatible extension rather than silently reinterpreting existing fields. The declared public source commit remains authoritative for code and contract meaning.
