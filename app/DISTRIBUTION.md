# Distributing Metrora Desktop

This document defines the desktop packaging boundary. Platform-specific release contracts under `docs/` remain authoritative for acceptance and publication.

## Product identity

- Product: `Metrora`
- Desktop app ID: `eu.metrora.desktop`
- Website: `https://metrora.eu`
- Current desktop version: `1.0.0-rc.4`
- Current desktop build version: `1.0.0.4`

Inherited names may remain only where required for compatibility or upstream provenance. They are not Metrora distribution names.

## Bundled runtime

Packaged desktop builds include the required Metrora command-line runtime and do not require a separate Node.js installation.

Packaging stages the current root runtime and copies it into Electron resources through `scripts/after-pack.cjs`. The packaged application uses this version-matched runtime before consulting any user-installed compatibility command.

## Development packaging commands

```sh
npm --prefix app install
npm --prefix app run package          # macOS
npm --prefix app run package:arm64    # macOS arm64
npm --prefix app run package:x64      # macOS x64
npm --prefix app run package:win      # Windows NSIS x64
npm --prefix app run package:linux    # Linux AppImage, deb and rpm x64
```

These commands create development or engineering artifacts. They do not by themselves create an official release.

## Official distribution requirements

An official desktop package must:

- derive from reviewed public source and the canonical bundled runtime;
- use exact Metrora product and publisher identity;
- contain only declared product bytes and metadata;
- preserve endpoint identity, Workspace state, secure-storage material and user-owned files;
- state its exact version, format, platform and signature status;
- remain independently traceable through checksums, manifests and provenance;
- pass clean installation, first launch, update, rollback, removal and state-preservation acceptance;
- keep private user data out of package metadata and reports.

## Current platform formats

### Windows

The development Windows installer is x64, per-user, assisted rather than one-click, non-destructive to application data on uninstall and named `Metrora-Setup-<version>.exe`.

Unsigned engineering artifacts may trigger platform reputation warnings. Their signature status must remain explicit and they must not be represented as channel-certified packages.

### macOS

Current macOS desktop artifacts are ad-hoc signed and not notarized. They remain development distributions until a separate trusted-distribution acceptance passes.

### Linux

Current Linux development targets are:

- AppImage x64;
- deb x64;
- rpm x64.

Official publication requires format-specific verification and support boundaries.

## Responsibility separation

Keep these responsibilities separate:

- product build;
- format packaging;
- independent verification;
- physical acceptance;
- channel submission;
- publication;
- update and rollback handling.

No all-purpose workflow should receive unnecessary authority over every stage.
