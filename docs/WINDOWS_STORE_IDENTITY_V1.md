# Windows Store package identity v1

**Status:** identity assigned / packaging only / not submitted

## Purpose

Define the separate Windows Store packaging boundary for Metrora.

The exact manifest values are maintained in the reviewed desktop build configuration. They must match Partner Center byte-for-byte and must not be duplicated across public documentation.

This document does not authorize submission, certification, publication, stable `1.0.0`, or any change to the already published GitHub `1.0.0-rc.7` artifacts.

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

## Current limitations

The Store target is packaging-ready only. It is not submitted, certified, signed by Microsoft, published, or an automatic update for existing installations.

Store-specific acceptance and separate publication authorization remain required.
