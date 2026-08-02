# Metrora Menubar for macOS

Native Swift + SwiftUI menubar companion for local Metrora usage and subscription status.

## Requirements

- macOS 14+ (Sonoma)
- Swift 6.0+ toolchain
- a local Metrora checkout or the inherited `codeburn` CLI compatibility command

The Swift target, process name, bundle identifier, persisted CLI path and current release asset filenames still use inherited CodeBurn identifiers. They remain intentionally stable until the installer and update channel migrate as one compatibility-safe release. The visible app name, icon and product identity are Metrora.

## Build from source

```bash
git clone https://github.com/maikolsiragusaa/metrora.git
cd metrora
npm ci
npm run build:cli
mac/Scripts/package-app.sh dev
```

For a Sonoma machine with only Command Line Tools and a standalone Swift 6.x toolchain:

```bash
mac/Scripts/build-local.sh dev
```

Both scripts regenerate the canonical Signal Grid icon before assembling the app. The resulting bundle presents itself as **Metrora Menubar**, while retaining internal compatibility identifiers needed by the existing CLI and local state.

## Development

```bash
cd mac
swift build
CODEBURN_ALLOW_DEV_BIN=1 CODEBURN_BIN="node $(pwd)/../dist/cli.js" swift run
```

The environment names above are compatibility boundaries, not product branding.

## Data source

The app reads structured usage and quota payloads from the local compatibility CLI. No AI traffic is routed through the menubar app. Existing persistent paths under `Application Support/CodeBurn` are retained to avoid breaking installed users until a reviewed migration exists.

## Project layout

```text
mac/
├── Package.swift
├── Scripts/
│   ├── package-app.sh
│   └── build-local.sh
├── Sources/CodeBurnMenubar/   # inherited internal module name
└── README.md
```

## Visual identity

Metrora Menubar uses the Signal Grid icon generated from `assets/brand` and the canonical palette:

- Signal Blue `#2563EB`
- Graphite `#0F1115`
- Slate `#47505A`
- Panel Gray `#E6E9EE`
- Warm Off-White `#FAF7F2`

Semantic success, warning and danger colors remain separate from the brand accent.
