#!/usr/bin/env bash
# ============================================================================
# build-local.sh — build the Metrora-branded menubar app on macOS 14.
# The inherited Swift target/process remains MetroraMenubar for compatibility.
# ============================================================================
# Why this exists
# ---------------
# Package.swift's `.macOS(.v14)` deployment target already fixes the -10825
# launch failure for every build, including the CI-distributed release: ld64
# drops the macOS-15-only libswift_errno.dylib dependency based on the
# deployment target, not the SDK used to build. This script is not about that.
#
# It exists for the narrower case of building on a Sonoma machine that only
# has the Command Line Tools (macOS 14 SDK). That SDK's SwiftUI does NOT carry
# the @MainActor annotations the macOS 15 SDK added to the `View` protocol, so
# a plain `swift build` there fails with actor-isolation errors. This script
# patches only a scratch copy and leaves repository sources untouched.
#
# Prerequisites
#   - Command Line Tools (provides the macOS 14 SDK + sips/iconutil/codesign)
#   - A swift.org Swift 6.x toolchain in ~/Library/Developer/Toolchains/
#
# Usage: mac/Scripts/build-local.sh [<version>]   (defaults to "dev")
# ----------------------------------------------------------------------------
set -euo pipefail

VERSION="${1:-dev}"
BUNDLE_ID="org.agentseal.metrora-menubar"
EXE="MetroraMenubar"
MIN_MACOS="14.0"

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MAC_DIR="${ROOT}/mac"
ICON_SOURCE="${ROOT}/assets/menubar-logo.png"
SCRATCH="$(mktemp -d /tmp/metrora-menubar-local-build.XXXXXX)"
APPS="${HOME}/Applications"
BUNDLE="${APPS}/MetroraMenubar.app"

trap 'rm -rf "${SCRATCH}"' EXIT

node "${ROOT}/scripts/generate-brand-assets.mjs"

# --- locate a Swift 6.x toolchain -------------------------------------------
TC=""
for cand in "${HOME}/Library/Developer/Toolchains/swift-6.2-RELEASE.xctoolchain" \
            "${HOME}/Library/Developer/Toolchains/swift-latest.xctoolchain" \
            /Library/Developer/Toolchains/swift-latest.xctoolchain; do
  [[ -x "${cand}/usr/bin/swift" ]] && { TC="${cand}"; break; }
done
if [[ -z "${TC}" ]]; then
  echo "✗ No swift.org Swift 6.x toolchain found in ~/Library/Developer/Toolchains/." >&2
  echo "  Install one from https://www.swift.org/install/macos/ (Swift 6.2)." >&2
  exit 1
fi
SWIFT="${TC}/usr/bin/swift"
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version)"
case "${SDK_VERSION}" in
  14.*) ;;
  *)
    echo "✗ Active SDK is macOS ${SDK_VERSION}, not 14.x, xcode-select is likely" >&2
    echo "  pointed at a newer Xcode instead of the Command Line Tools. Run:" >&2
    echo "    sudo xcode-select -s /Library/Developer/CommandLineTools" >&2
    exit 1
    ;;
esac
echo "▸ Toolchain : $("${SWIFT}" --version | head -1)"
echo "▸ SDK       : ${SDKROOT} (${SDK_VERSION})"

# --- copy sources and add explicit @MainActor to SwiftUI views --------------
echo "▸ Staging sources in ${SCRATCH}..."
cp -R "${MAC_DIR}/Sources" "${MAC_DIR}/Tests" "${MAC_DIR}/Package.swift" "${SCRATCH}/"
find "${SCRATCH}/Sources" -name "*.swift" -print0 | while IFS= read -r -d '' f; do
  perl -0777 -i -pe '
    s/^((?:private |public |fileprivate |internal )?(?:struct|extension)\s+\w+(?:<[^{]*?>)?\s*:[^{]*\bView\b[^{]*\{)/\@MainActor\n$1/gm;
    s/^(struct\s+\w+\s*:[^{]*\bApp\b[^{]*\{)/\@MainActor\n$1/gm;
    s/\@MainActor\n\@MainActor\n/\@MainActor\n/g;
  ' "$f"
done

# --- build each arch separately, then lipo into one universal binary --------
BINS=()
for arch in arm64 x86_64; do
  echo "▸ Building ${arch} release..."
  ( cd "${SCRATCH}" && "${SWIFT}" build -c release --arch "${arch}" )
  bin="$(cd "${SCRATCH}" && "${SWIFT}" build -c release --arch "${arch}" --show-bin-path)/${EXE}"
  [[ -x "${bin}" ]] || { echo "✗ ${arch} build produced no binary" >&2; exit 1; }
  BINS+=("${bin}")
done
BIN="${SCRATCH}/${EXE}-universal"
lipo -create -output "${BIN}" "${BINS[@]}"

# --- assemble the .app bundle ------------------------------------------------
echo "▸ Assembling Metrora Menubar (${BUNDLE})..."
pkill -x "${EXE}" 2>/dev/null || true; sleep 1
rm -rf "${BUNDLE}"
mkdir -p "${BUNDLE}/Contents/MacOS" "${BUNDLE}/Contents/Resources"
cp "${BIN}" "${BUNDLE}/Contents/MacOS/${EXE}"
cp "${ICON_SOURCE}" "${BUNDLE}/Contents/Resources/menubar-logo.png"

ICONSET="${SCRATCH}/AppIcon.iconset"; mkdir -p "${ICONSET}"
for spec in "16:16x16" "32:16x16@2x" "32:32x32" "64:32x32@2x" "128:128x128" \
            "256:128x128@2x" "256:256x256" "512:256x256@2x" "512:512x512"; do
  sips -z "${spec%%:*}" "${spec%%:*}" "${ICON_SOURCE}" --out "${ICONSET}/icon_${spec##*:}.png" >/dev/null
done
cp "${ICON_SOURCE}" "${ICONSET}/icon_512x512@2x.png"
iconutil -c icns "${ICONSET}" -o "${BUNDLE}/Contents/Resources/AppIcon.icns"

cat > "${BUNDLE}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>Metrora Menubar</string>
    <key>CFBundleExecutable</key><string>${EXE}</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>Metrora Menubar</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${VERSION}</string>
    <key>CFBundleVersion</key><string>${VERSION}</string>
    <key>LSMinimumSystemVersion</key><string>${MIN_MACOS}</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSHumanReadableCopyright</key><string>Copyright © 2026 Metrora contributors</string>
</dict>
</plist>
PLIST
printf 'APPL????' > "${BUNDLE}/Contents/PkgInfo"

echo "▸ Ad-hoc signing..."
codesign --force --sign - --timestamp=none --deep "${BUNDLE}"
codesign --verify --deep --strict "${BUNDLE}"

echo ""
echo "✓ Installed Metrora Menubar at ${BUNDLE}"
lipo -info "${BUNDLE}/Contents/MacOS/${EXE}" | sed 's/^/  /'
vtool -show-build "${BUNDLE}/Contents/MacOS/${EXE}" 2>/dev/null | grep -iE "minos|sdk" | sed 's/^/  /'
echo "  Launch with: metrora menubar   (or: open '${BUNDLE}')"
