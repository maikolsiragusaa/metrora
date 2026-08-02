# Metrora Desktop

Electron desktop application for Metrora's local-first AI usage intelligence and Workspace surfaces.

Metrora Desktop reads structured data produced by the bundled compatibility CLI. It does not require a separate Node.js installation, run an analytics daemon, proxy AI traffic or send prompts/source code to Metrora services.

## Development

```sh
npm --prefix app install
npm --prefix app run dev
```

Validation:

```sh
npm --prefix app run test
npm --prefix app run typecheck
npm --prefix app run build
```

## Runtime boundary

The packaged application ships a version-matched CLI bundle under Electron resources and executes it with Electron's own runtime.

The main process owns:

- CLI resolution and execution;
- local filesystem and OS-vault access;
- bounded IPC handlers;
- Workspace identity, lifecycle, inspection and recovery authority;
- export-path validation and private-buffer handling.

The renderer runs with context isolation and no Node integration. It receives public JSON/DTO payloads only through the preload bridge.

## Compatibility identifiers

Some internal names such as `window.codeburn`, `CODEBURN_BIN`, inherited storage paths and compatibility command aliases remain intentionally stable while migrations are reviewed. They are technical compatibility boundaries, not Metrora product branding.

New user-facing text, artifact names, documentation and release metadata must use **Metrora**.

See `../docs/TECHNICAL_IDENTITY_COMPATIBILITY.md` for the canonical migration boundary.

## Product surfaces

Current desktop surfaces include:

- Overview and period/provider filters;
- session, project, tool, model, cost and token analysis;
- optimization and model-comparison views;
- plans, pricing overrides and exports;
- local device/identity foundations;
- the local personal Workspace with truthful evidence inspection, production lifecycle, batching, export and recovery.

The public CLI and desktop share canonical parsing, aggregation, pricing and evidence semantics. The renderer must never create a second analytics authority or invent data for incomplete states.

## Windows distribution

Two parallel Windows channels are planned:

- Microsoft Store AppX/MSIX for ordinary users, signed and hosted by Microsoft after certification;
- GitHub Releases and `metrora.eu` for the verified portable ZIP and explicitly unsigned NSIS installer used by technical users.

Store identity values are added only after the Metrora product is reserved in Partner Center. They must never be guessed or copied from another project.

See `DISTRIBUTION.md` and `../docs/WINDOWS_STORE_DISTRIBUTION.md`.

## Packaging

Current commands:

```sh
npm --prefix app run package          # macOS
npm --prefix app run package:arm64    # macOS arm64
npm --prefix app run package:x64      # macOS x64
npm --prefix app run package:win      # Windows NSIS x64
npm --prefix app run package:linux    # Linux AppImage, deb and rpm x64
```

A separate `package:store` target will be introduced only after exact Partner Center identity values exist and the Store-specific acceptance contract is ready.

## Engineering rules

- Keep build, packaging, Store submission, GitHub publication and rollback separate.
- Do not expose signing or publication authority to untrusted pull requests.
- Do not grow renderer or main-process GOD FILES; extract domain state, orchestration and presentation by responsibility.
- Preserve local state and compatibility boundaries through reviewed migrations.
- Keep unsupported or uninspected data visibly indeterminate rather than showing false zeroes.
