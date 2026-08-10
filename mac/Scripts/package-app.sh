#!/usr/bin/env bash
# Builds the Metrora-branded universal menubar bundle from the inherited
# MetroraMenubar SwiftPM target and drops a distributable zip alongside.
# The internal target, process and artifact identifiers remain stable until the
# release/install compatibility path is migrated separately.
#
# Usage:
#   mac/Scripts/package-app.sh [<version>]
# Defaults to `dev` if no version is given.

set -euo pipefail

VERSION="${1:-dev}"
ASSET_VERSION="${VERSION#mac-}"
BUNDLE_VERSION="${ASSET_VERSION#v}"
BUNDLE_NAME="MetroraMenubar.app"
BUNDLE_ID="org.agentseal.metrora-menubar"
EXECUTABLE_NAME="MetroraMenubar"
MIN_MACOS="14.0"

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd)
}

ROOT=$(repo_root)
MAC_DIR="${ROOT}/mac"
DIST_DIR="${MAC_DIR}/.build/dist"
ICON_SOURCE="${ROOT}/assets/menubar-logo.png"

node "${ROOT}/scripts/generate-brand-assets.mjs"

cd "${MAC_DIR}"

echo "▸ Cleaning previous dist..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

echo "▸ Building universal binary (arm64 + x86_64)..."
swift build -c release --arch arm64 --arch x86_64

BIN_PATH=$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)
BUILT_BINARY="${BIN_PATH}/${EXECUTABLE_NAME}"
if [[ ! -x "${BUILT_BINARY}" ]]; then
  echo "Binary not found at ${BUILT_BINARY}" >&2
  exit 1
fi

echo "▸ Assembling Metrora Menubar (${BUNDLE_NAME})..."
BUNDLE="${DIST_DIR}/${BUNDLE_NAME}"
mkdir -p "${BUNDLE}/Contents/MacOS"
mkdir -p "${BUNDLE}/Contents/Resources"
cp "${BUILT_BINARY}" "${BUNDLE}/Contents/MacOS/${EXECUTABLE_NAME}"
cp "${ICON_SOURCE}" "${BUNDLE}/Contents/Resources/menubar-logo.png"

ICONSET="${DIST_DIR}/AppIcon.iconset"
rm -rf "${ICONSET}"
mkdir -p "${ICONSET}"
sips -z 16 16 "${ICON_SOURCE}" --out "${ICONSET}/icon_16x16.png" >/dev/null
sips -z 32 32 "${ICON_SOURCE}" --out "${ICONSET}/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "${ICON_SOURCE}" --out "${ICONSET}/icon_32x32.png" >/dev/null
sips -z 64 64 "${ICON_SOURCE}" --out "${ICONSET}/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "${ICON_SOURCE}" --out "${ICONSET}/icon_128x128.png" >/dev/null
sips -z 256 256 "${ICON_SOURCE}" --out "${ICONSET}/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "${ICON_SOURCE}" --out "${ICONSET}/icon_256x256.png" >/dev/null
sips -z 512 512 "${ICON_SOURCE}" --out "${ICONSET}/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "${ICON_SOURCE}" --out "${ICONSET}/icon_512x512.png" >/dev/null
cp "${ICON_SOURCE}" "${ICONSET}/icon_512x512@2x.png"
iconutil -c icns "${ICONSET}" -o "${BUNDLE}/Contents/Resources/AppIcon.icns"
rm -rf "${ICONSET}"

cat > "${BUNDLE}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Metrora Menubar</string>
    <key>CFBundleExecutable</key>
    <string>${EXECUTABLE_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Metrora Menubar</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${BUNDLE_VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${BUNDLE_VERSION}</string>
    <key>LSMinimumSystemVersion</key>
    <string>${MIN_MACOS}</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 Metrora contributors</string>
</dict>
</plist>
PLIST

cat > "${BUNDLE}/Contents/PkgInfo" <<'PKG'
APPL????
PKG

# Sign so macOS treats the bundle as internally consistent. Set CODESIGN_IDENTITY
# to a stable identity (Developer ID Application for distribution, or an Apple
# Development cert for local testing) so the TCC grant persists across rebuilds.
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
if [[ -n "${CODESIGN_IDENTITY}" ]]; then
  echo "▸ Signing with identity: ${CODESIGN_IDENTITY}"
  codesign --force --sign "${CODESIGN_IDENTITY}" --options runtime --timestamp=none --deep "${BUNDLE}"
else
  echo "▸ Ad-hoc signing (set CODESIGN_IDENTITY for a persistent TCC grant)..."
  codesign --force --sign - --timestamp=none --deep "${BUNDLE}"
fi
codesign --verify --deep --strict "${BUNDLE}"

echo "▸ Verifying deployment target and libswift_errno absence..."
BUILT_EXE="${BUNDLE}/Contents/MacOS/${EXECUTABLE_NAME}"
MINOS_LINES=$(vtool -show-build "${BUILT_EXE}" 2>/dev/null | awk '/minos/{print $2}')
if [[ -z "${MINOS_LINES}" ]]; then
  echo "Could not read a minos deployment target from ${BUILT_EXE} (vtool returned nothing)." >&2
  exit 1
fi
BAD_MINOS=$(printf '%s\n' "${MINOS_LINES}" | grep -v '^14\.0$' || true)
if [[ -n "${BAD_MINOS}" ]]; then
  echo "✗ Expected minos 14.0 for every arch slice, found: ${BAD_MINOS}" >&2
  echo "  Did Package.swift's platforms: [.macOS(...)] regress past .v14?" >&2
  exit 1
fi
if otool -L "${BUILT_EXE}" | grep libswift_errno | grep -qv 'weak'; then
  echo "✗ ${BUILT_EXE} links libswift_errno.dylib (macOS 15+ only), would fail on Sonoma with -10825." >&2
  exit 1
fi
echo "  minos 14.0 confirmed, no libswift_errno dependency."

# Keep the inherited asset filename until the legacy installer/update contract is
# replaced by an official Metrora release channel. The bundle shown to users is
# branded Metrora through Info.plist and the canonical Signal Grid icon.
ZIP_NAME="MetroraMenubar-${ASSET_VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"
echo "▸ Packaging ${ZIP_NAME}..."
(cd "${DIST_DIR}" && COPYFILE_DISABLE=1 /usr/bin/ditto -c -k --norsrc --keepParent "${BUNDLE_NAME}" "${ZIP_NAME}")

CHECKSUM_NAME="${ZIP_NAME}.sha256"
CHECKSUM_PATH="${DIST_DIR}/${CHECKSUM_NAME}"
echo "▸ Computing SHA-256 checksum..."
(cd "${DIST_DIR}" && shasum -a 256 "${ZIP_NAME}" > "${CHECKSUM_NAME}")

echo ""
echo "✓ Built ${ZIP_PATH}"
echo "✓ Checksum ${CHECKSUM_PATH}"
cat "${CHECKSUM_PATH}"
ls -la "${DIST_DIR}"
