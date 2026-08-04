# Metrora Desktop

Electron desktop application for Metrora's local-first AI usage intelligence and Workspace surfaces.

Metrora Desktop reads structured local usage data through the bundled, version-matched Metrora runtime. It does not require a separate Node.js installation or proxy AI traffic.

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

The packaged application ships its required command-line runtime under Electron resources and executes it with Electron's own runtime.

The main process owns:

- runtime resolution and execution;
- local filesystem and OS-vault access;
- bounded IPC handlers;
- Workspace identity, lifecycle, inspection and recovery authority;
- export-path validation and private-buffer handling.

The renderer runs with context isolation and no Node integration. It receives public JSON and DTO payloads only through the preload bridge.

## Compatibility boundary

Inherited identifiers may remain internally where changing them would break stored state, packaging or integrations. They are technical compatibility boundaries, not product branding.

New user-facing text, artifact names, documentation and release metadata use **Metrora**.

See [`../docs/TECHNICAL_IDENTITY_COMPATIBILITY.md`](../docs/TECHNICAL_IDENTITY_COMPATIBILITY.md).

## Product surfaces

Current desktop surfaces include:

- Overview and period/provider filters;
- session, project, tool, model, cost and token analysis;
- optimization and model-comparison views;
- plans, pricing overrides and exports;
- local device and identity foundations;
- the local personal Workspace with truthful evidence inspection, production lifecycle, batching, export and recovery.

The public CLI and desktop share canonical parsing, aggregation, pricing and evidence semantics. The renderer must not create a second analytics authority or invent data for incomplete states.

## Distribution boundary

Official desktop distribution is in preparation. Development and engineering artifacts must state their exact platform, format, version and signature status.

An official package must derive from reviewed public source, preserve user-owned local state and pass the channel-specific identity, installation, update, rollback and removal gates.

See [`DISTRIBUTION.md`](DISTRIBUTION.md) and [`../docs/WINDOWS_STORE_DISTRIBUTION.md`](../docs/WINDOWS_STORE_DISTRIBUTION.md).

## Packaging

Current development commands:

```sh
npm --prefix app run package          # macOS
npm --prefix app run package:arm64    # macOS arm64
npm --prefix app run package:x64      # macOS x64
npm --prefix app run package:win      # Windows NSIS x64
npm --prefix app run package:linux    # Linux AppImage, deb and rpm x64
```

## Engineering rules

- keep product build, format packaging, independent verification, publication and rollback separate;
- do not expose protected distribution authority to untrusted pull requests;
- extract domain state, orchestration and presentation before renderer or main-process modules become oversized;
- preserve local state and compatibility boundaries through reviewed migrations;
- keep unsupported or uninspected data visibly indeterminate rather than showing false zeroes.
