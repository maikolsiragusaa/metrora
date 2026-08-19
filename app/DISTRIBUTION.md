# Distributing Metrora Desktop

This document defines the desktop packaging boundary. Platform-specific release contracts under `docs/` remain authoritative for acceptance and publication.

## Product identity

- Product: `Metrora`
- Desktop app ID: `eu.metrora.desktop`
- Website: `https://metrora.eu`
- Microsoft Store: `https://apps.microsoft.com/detail/9NXSZFQSBBDX`
- Published Store source line: `1.0.0-rc.10`
- Published desktop build version: `1.0.0.10`
- Published Store AppX identity version: `1.0.0.0`
- Current Store update candidate: `1.0.0-rc.11`
- Current candidate desktop build version: `1.0.0.11`
- Current candidate Store AppX identity version: `1.0.1.0`
- Historical GitHub technical preview: `1.0.0-rc.7`

Inherited names may remain only where required for compatibility or provenance. They are not Metrora distribution names.

## Bundled runtime

Packaged desktop builds include the required Metrora command-line runtime and do not require a separate Node.js installation.

The root CLI build keeps its normal production dependency closure external. `app/scripts/stage-cli.mjs` copies that exact production closure into a version-matched staging layout, and `app/scripts/after-pack.cjs` seals it into `cli.asar` inside Electron resources. A tiny stable launcher remains outside the archive and loads the runtime through Electron's ASAR-aware Node loader before any external PATH entry is considered.

The Store payload must not expose a loose CLI `node_modules` tree. Keeping `@scope/package` paths inside `cli.asar` prevents AppX packaging from rewriting those path segments. The Store package workflow executes the CLI from the extracted AppX layout with packaged `Metrora.exe`, so module resolution is tested as shipped rather than inferred from file presence.

The packaged companion runtime is the sealed module at
`app/resources/cli.asar/dist/desktop-share-runtime.js`. The Store workflow
imports that exact module through the bundled Electron runtime and requires the
`createDesktopShareRuntime` entry point without starting a listener or creating
pairing state. Store package versions are maintained in the canonical
`../release/windows-store-package-version.v1.json` authority and are not derived
from product SemVer.

Persisted Workspace endpoint metadata is reconciled to the current packaged Metrora/collector version without replacing endpoint identity, Workspace membership or evidence history.

## Development packaging commands

```sh
npm --prefix app install
npm --prefix app run package          # macOS
npm --prefix app run package:arm64    # macOS arm64
npm --prefix app run package:x64      # macOS x64
npm --prefix app run package:win      # Windows NSIS x64
npm --prefix app run package:store    # Windows AppX x64, development packaging
npm --prefix app run package:linux    # Linux AppImage, deb and rpm x64
```

These commands create development or engineering artifacts. They do not by themselves create an official release or replace the Microsoft Store distribution. The RC11 Store output is an unsigned submitted candidate undergoing Microsoft certification; it is not publicly published until the remaining release gates pass.

## Official distribution requirements

An official desktop package must:

- derive from reviewed public source and the canonical bundled runtime;
- use exact Metrora product and publisher identity;
- contain only declared product bytes and metadata;
- preserve endpoint identity, Workspace state, secure-storage material and user-owned files;
- state its exact product version, package version, format, platform and signature status;
- remain independently traceable through checksums, manifests and provenance;
- pass clean installation, first launch, update, rollback, removal and state-preservation acceptance;
- keep private user data out of package metadata and reports.

## Current platform formats

### Windows

The supported public Windows distribution is the Microsoft Store package published by Vensent.

Development Windows installers may still be produced for engineering validation. They are not the recommended public install path and must not be represented as Store-distributed packages.

The Microsoft Store path uses an x64 AppX with the assigned Store identity and `runFullTrust`. The Store manifest's four-part package identity is separate from the desktop build counter; see [`../docs/VERSIONING.md`](../docs/VERSIONING.md).

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
- channel publication;
- update and rollback handling.

No all-purpose workflow should receive unnecessary authority over every stage.
