# Windows Store package identity v1

**Status:** product name reserved / package identity fixed / not submitted  
**Authority date:** 2026-08-06  
**Store product name:** Metrora

## Purpose

Record the public Microsoft Store identity assigned to Metrora and bind the separate AppX/MSIX build target to those exact values.

This document does not authorize a Partner Center submission, Microsoft certification, publication, stable `1.0.0`, or any change to the already published unsigned GitHub `1.0.0-rc.7` artifacts.

## Manifest identity

The Store package manifest must contain these exact values:

```text
Package/Identity/Name: Vensent.Metrora
Package/Identity/Publisher: CN=BC955F81-5099-4C27-A7A6-FF611BAACC3F
Package/Properties/PublisherDisplayName: Vensent
```

Case, punctuation and spacing are part of the identity and must not be normalized or replaced.

The package application identifier remains:

```text
eu.metrora.desktop
```

The user-visible product name remains:

```text
Metrora
```

## Assigned Store identifiers

```text
Package Family Name: Vensent.Metrora_1xcj95baterfy
Store ID: 9NXSZFQSBBDX
```

The Store deep link and Web Store URL are not yet live. They must not be advertised until Partner Center exposes them after publication.

The Package SID is intentionally not recorded here. Metrora does not currently use Windows Push Notification Services, and the SID is not required by the package manifest or ordinary Store submission.

## Build boundary

The Store candidate is built separately from the existing NSIS technical-preview channel:

```text
npm --prefix app run package:store
```

The command builds an x64 AppX package with:

- the exact Store identity above;
- `runFullTrust`, required for the existing local desktop behavior;
- no automatic submission or publication configuration;
- an artifact name distinct from the NSIS installer.

The existing command remains authoritative for the unsigned GitHub/technical-user installer:

```text
npm --prefix app run package:win
```

Neither channel inherits the signature or certification status of the other.

## Current limitations

The Store target is packaging-ready only. It is not yet:

- accepted by physical Store-specific validation;
- submitted to Partner Center;
- certified or signed by Microsoft;
- published through the Microsoft Store;
- an automatic update for existing NSIS or portable installations.

A Store package must pass manifest and inventory validation, clean installation, launch, local collector discovery, state-preservation, update, uninstall, channel-coexistence and rollback checks before submission or publication authorization.
