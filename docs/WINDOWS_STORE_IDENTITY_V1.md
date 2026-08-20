# Windows Store package identity v1

**Status:** identity assigned / RC11 accepted and published

## Purpose

Define the separate Windows Store packaging boundary for Metrora.

The exact manifest values are maintained in the reviewed desktop build configuration. They must match the Store authority byte-for-byte and must not be duplicated across public documentation.

RC10 is the frozen source line associated with the first published Store package. RC11 (`1.0.0-rc.11`), Desktop build `1.0.0.11` and Store package version `1.0.1.0` was subsequently accepted by Microsoft and published as the current Store update. Post-RC11 development is separate from that published artifact and this document does not authorize RC12, another Store submission or any mutation of the already published GitHub `1.0.0-rc.7` artifacts.

## Build boundary

The Store candidate is built separately from the existing NSIS channel:

```text
npm --prefix app run package:store
```

The command produces one non-publishing x64 AppX candidate with the assigned Store identity and the required full-trust desktop capability.

The Store package identity version is not derived from product SemVer or the Desktop build version. The machine-readable authority is `release/windows-store-package-version.v1.json`. Its current values record the RC10 published baseline and the RC11 package-version slot used for the now-published update. Before another Store candidate is derived, that authority must be advanced through a separately reviewed release decision so the published baseline becomes `1.0.1.0` and any next candidate remains strictly greater. RC11 publication alone does not authorize the next package version.

The supported `appxManifestCreated` hook validates the generated `Package/Identity` shape and replaces only its Version value; it fails closed on an unexpected, missing or ambiguous identity.

The existing technical-user installer remains separate:

```text
npm --prefix app run package:win
```

Neither channel inherits the signature, certification or publication status of the other.

## Local test boundary

The guided local path is documented in [`WINDOWS_STORE_LOCAL_TEST_GUIDED.md`](WINDOWS_STORE_LOCAL_TEST_GUIDED.md).

It signs only a temporary copy. The public test certificate is trusted at machine level while its private key remains in the current-user personal store; both are removed with the installed package after validation. The unsigned submission candidate is not modified.

A local PASS is not Store certification and does not authorize publication or availability claims.

## Current distribution state

RC11 is the current published Microsoft Store line under the assigned Metrora/Vensent identity. The previous RC10 package remains immutable historical publication evidence. Microsoft certification and publication do not make repository `main` byte-identical to the Store artifact; later source changes remain separate until a future Store update is reviewed and published.

Exact Store identity values remain only where technically required. Private verification documents, account details, addresses, tax identifiers, D-U-N-S data, credentials and recovery material must not be committed to the public repository.
