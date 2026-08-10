# Metrora Menubar for macOS

Native Swift + SwiftUI menubar companion for local Metrora usage and subscription status.

## Requirements

- macOS 14+ (Sonoma)
- Swift 6.0+ toolchain
- a local Metrora checkout with the canonical `metrora` CLI

The Swift target, process name, bundle identifier, persisted CLI path and release asset filenames use the canonical Metrora identity. Existing local state is adopted through the shared compatibility boundary where required.

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

Both scripts regenerate the canonical Signal Grid icon before assembling the app. The resulting bundle presents itself as **Metrora Menubar**.

## Development

```bash
cd mac
swift build
METRORA_ALLOW_DEV_BIN=1 METRORA_BIN="node $(pwd)/../dist/cli.js" swift run
```

The environment names above are compatibility boundaries, not product branding.

## Data source

The app reads structured usage and quota payloads from the local compatibility CLI. No AI traffic is routed through the menubar app. Existing persistent paths under `Application Support/Metrora` are retained to avoid breaking installed users until a reviewed migration exists.

## Project layout

```text
mac/
├── Package.swift
├── Scripts/
│   ├── package-app.sh
│   └── build-local.sh
├── Sources/MetroraMenubar/   # canonical internal module
└── README.md
```

## Visual identity

Metrora Menubar uses the Signal Grid icon generated from `assets/brand` and the canonical palette:

- Signal Orange `#F2701C`
- Signal Orange Deep `#E8590C`
- Graphite `#0F1115`
- Slate `#47505A`
- Panel Gray `#E6E9EE`
- Warm Off-White `#FAF7F2`

Semantic success, warning and danger colors remain separate from the brand accent.
