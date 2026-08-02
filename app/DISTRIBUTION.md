# Distributing Metrora Desktop

This document is the desktop packaging overview. Platform-specific release contracts live under `docs/` and remain authoritative for acceptance and publication.

## Product identity

- Product: `Metrora`
- Desktop app ID: `eu.metrora.desktop`
- Website: `https://metrora.eu`
- Current desktop version: `0.9.19`

Legacy CodeBurn names may remain only where they are required for compatibility or upstream provenance. They are not Metrora distribution names.

## Bundled CLI

Packaged desktop builds include the Metrora compatibility CLI and do not require a separate Node.js installation.

Packaging runs `stage-cli`, builds the current root CLI and copies the staged runtime into the packaged Electron resources through `scripts/after-pack.cjs`.

The packaged application must use the bundled CLI before consulting any user-installed compatibility command.

## Build commands

```sh
npm --prefix app install
npm --prefix app run package          # macOS
npm --prefix app run package:arm64    # macOS arm64
npm --prefix app run package:x64      # macOS x64
npm --prefix app run package:win      # Windows NSIS x64
npm --prefix app run package:linux    # Linux AppImage, deb and rpm x64
```

A future `package:store` command will be added only after the Metrora product is reserved in Microsoft Partner Center and the exact public Store identity values are available.

## Windows channels

Metrora uses two parallel Windows distribution channels.

### Microsoft Store

The planned AppX/MSIX package is the recommended channel for ordinary users.

- Microsoft hosts and signs the package after certification.
- Store updates are delivered through Windows.
- The package retains full-trust desktop execution required for local provider-session discovery.
- Store identity values must come from the reserved Metrora product and must never be copied from CodeBurn.
- Direct sideloading is not supported unless a separate trusted signing path exists.

See `docs/WINDOWS_STORE_DISTRIBUTION.md`.

### GitHub Releases and metrora.eu

The technical-user channel may provide:

- the verified portable ZIP;
- the unsigned NSIS installer;
- SHA-256 checksums;
- release and format manifests;
- explicit SmartScreen guidance.

These artifacts remain visibly separate from the Microsoft-signed Store package.

The accepted unsigned Windows 0.9.19 authority and its physical acceptance remain documented in the Windows release contracts under `docs/`.

## Windows NSIS configuration

The current Windows installer is:

- x64;
- per-user;
- assisted rather than one-click;
- non-destructive to application data on uninstall;
- named `Metrora-Setup-<version>.exe`;
- unsigned.

Unsigned GitHub installers can trigger SmartScreen. They must not be described as trusted Store packages or official Microsoft-signed binaries.

## macOS

Current macOS desktop builds are ad-hoc signed and not notarized. They are development distributions, not a final trusted macOS release.

## Linux

Current Linux targets are:

- AppImage x64;
- deb x64;
- rpm x64.

Linux publication requires its own release verification and support statement.

## Release boundaries

Keep these responsibilities separate:

- product build;
- format packaging;
- independent verification;
- physical acceptance;
- Microsoft Store submission;
- GitHub Release publication;
- update and rollback handling.

Do not collapse them into one all-purpose workflow or document.
