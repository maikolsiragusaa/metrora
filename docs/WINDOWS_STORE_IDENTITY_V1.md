# Windows Store package identity v1

**Status:** identity assigned / RC10 package locally and physically accepted / RC10 submission frozen / publication pending

## Purpose

Define the separate Windows Store packaging boundary for Metrora.

The exact manifest values are maintained in the reviewed desktop build configuration. They must match Partner Center byte-for-byte and must not be duplicated across public documentation.

This document does not authorize a different submission, certification or publication, or any change to the already published GitHub `1.0.0-rc.7` artifacts. The RC10 package was submitted after acceptance and remains frozen; post-RC10 development is separate.

## Build boundary

The Store candidate is built separately from the existing NSIS channel:

```text
npm --prefix app run package:store
```

The command produces one non-publishing x64 AppX candidate with the assigned Store identity and the required full-trust desktop capability.

The existing technical-user installer remains separate:

```text
npm --prefix app run package:win
```

Neither channel inherits the signature, certification or publication status of the other.

## Local test boundary

The guided local path is documented in [`WINDOWS_STORE_LOCAL_TEST_GUIDED.md`](WINDOWS_STORE_LOCAL_TEST_GUIDED.md).

It signs only a temporary copy. The public test certificate is trusted at machine level while its private key remains in the current-user personal store; both are removed with the installed package after validation. The unsigned candidate intended for Partner Center is not modified.

A local PASS is not Store certification and does not authorize publication.

## Current limitations

The RC10 Store target is submitted and frozen. It is not certified, signed by Microsoft, published, or an automatic update for existing installations.

Certification and separate manual publication authorization remain distinct requirements. No post-RC10 code is part of the submitted package.
