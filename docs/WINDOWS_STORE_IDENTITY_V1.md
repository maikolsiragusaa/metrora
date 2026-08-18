# Windows Store package identity v1

**Status:** identity assigned / RC11 candidate boundary / not published

## Purpose

Define the separate Windows Store packaging boundary for Metrora.

The exact manifest values are maintained in the reviewed desktop build configuration. They must match the Store authority byte-for-byte and must not be duplicated across public documentation.

RC10 is the frozen source line associated with the published Store package. The
current engineering candidate is RC11 (`1.0.0-rc.11`) with Desktop build
`1.0.0.11` and candidate Store package version `1.0.1.0`. This document does
not claim certification, publication or availability for RC11, and post-RC10
development is separate from the published artifact. It also does not
authorize a different submission or any change to the already published
GitHub `1.0.0-rc.7` artifacts.

## Build boundary

The Store candidate is built separately from the existing NSIS channel:

```text
npm --prefix app run package:store
```

The command produces one non-publishing x64 AppX candidate with the assigned Store identity and the required full-trust desktop capability.

The Store package identity version is not derived from product SemVer or the
Desktop build version. The single machine-readable authority is
`release/windows-store-package-version.v1.json`, which records the published
baseline `1.0.0.0` and the RC11 candidate `1.0.1.0`. The supported
`appxManifestCreated` hook validates the generated `Package/Identity` shape and
replaces only its Version value; it fails closed on an unexpected, missing or
ambiguous identity.

The existing technical-user installer remains separate:

```text
npm --prefix app run package:win
```

Neither channel inherits the signature, certification or publication status of the other.

## Local test boundary

The guided local path is documented in [`WINDOWS_STORE_LOCAL_TEST_GUIDED.md`](WINDOWS_STORE_LOCAL_TEST_GUIDED.md).

It signs only a temporary copy. The public test certificate is trusted at machine level while its private key remains in the current-user personal store; both are removed with the installed package after validation. The unsigned candidate intended for Store submission is not modified.

A local PASS is not Store certification and does not authorize publication or availability claims.

## Current limitations

The Store target has a separate package identity and local-acceptance path. The
RC11 candidate is not a signed Microsoft channel, an automatic update for
existing installations, or a publication claim.

The RC10 source line and `1.0.0.0` package remain the live Store authority;
certification, publication and Store-managed update behavior remain distinct
gates. No post-RC10 code is part of the published RC10 artifact.
