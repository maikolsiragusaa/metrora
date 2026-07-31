QOVRION WINDOWS PORTABLE BASELINE
=================================

This is an unsigned development artifact for controlled validation before
Qovrion's historical price engine is connected to visible runtime totals.

USAGE
-----

1. Extract the whole GitHub Actions artifact ZIP.
2. Keep every file in the extracted folder together.
3. Double-click Run-Qovrion-Baseline.cmd.
4. Leave the window open until it reports completion.
5. Open the new baseline-output folder.

The script produces:

- a shareable Qovrion-Baseline-*.zip containing Qovrion reports;
- CodeBurn comparison reports when a `codeburn` command is found in PATH;
- a separate PRIVATE-DO-NOT-UPLOAD-codeburn-cache-*.zip when the inherited
  cache exists.

The PRIVATE cache backup is for rollback and forensic comparison only. It is
never included in the shareable ZIP and must be kept locally.

NO REPOSITORY OR NODE INSTALLATION IS REQUIRED
-----------------------------------------------

The portable folder contains Electron, the Qovrion desktop application and the
self-contained compatibility CLI runtime. The baseline launcher invokes that
bundled runtime directly.

CODEBURN NOT DETECTED
---------------------

The Qovrion baseline remains valid. To add a CodeBurn comparison, open
PowerShell in this folder and run:

  powershell -ExecutionPolicy Bypass -File .\Run-Qovrion-Baseline.ps1 `
    -CodeBurnPath "C:\path\to\codeburn.cmd"

PRIVACY
-------

Nothing is uploaded automatically. Baseline reports do not intentionally export
prompts, responses, source code, patches or credentials, but they can contain
project labels, local probe paths, model/provider names and session identifiers.
Review the shareable ZIP before sending it anywhere.

UNSIGNED BUILD
--------------

Windows SmartScreen may warn because this development artifact is not yet code
signed. Verify BUILD_INFO.txt and SHA256SUMS.txt from the same artifact before
running it. Official signed Qovrion releases do not exist yet.
