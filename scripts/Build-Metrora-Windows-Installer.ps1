param(
  [Parameter(Mandatory = $true)]
  [string]$AppDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CanonicalPayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [string]$RepositoryRoot = (Get-Location).Path,
  [string]$NsisInclude
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$app = (Resolve-Path -LiteralPath $AppDirectory).Path
$canonical = (Resolve-Path -LiteralPath $CanonicalPayloadDirectory).Path
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$packagePath = Join-Path $app 'package.json'
$packageBytes = [IO.File]::ReadAllBytes($packagePath)
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'metrora-desktop') {
  throw "unexpected desktop package name: $($package.name)"
}
if ($package.version -ne $ExpectedVersion) {
  throw "desktop package version is not ${ExpectedVersion}: $($package.version)"
}

$release = Join-Path $app 'release'
$installerSource = Join-Path $release 'nsis-prepackaged'
$output = [IO.Path]::GetFullPath($OutputDirectory)
$temporaryPackageConfiguration = $false

try {
  if ($NsisInclude) {
    $includePath = (Resolve-Path -LiteralPath $NsisInclude).Path
    $relativeInclude = [IO.Path]::GetRelativePath($app, $includePath).Replace('\', '/')
    if ($relativeInclude.StartsWith('../')) {
      throw 'NSIS include must be located inside the desktop application directory'
    }
    if ($null -eq $package.build -or $null -eq $package.build.nsis) {
      throw 'desktop package is missing canonical NSIS configuration'
    }
    if ($package.build.nsis.PSObject.Properties['include']) {
      $package.build.nsis.include = $relativeInclude
    } else {
      $package.build.nsis | Add-Member -NotePropertyName include -NotePropertyValue $relativeInclude
    }
    $temporaryJson = "$($package | ConvertTo-Json -Depth 32)`n"
    [IO.File]::WriteAllText($packagePath, $temporaryJson, [Text.UTF8Encoding]::new($false))
    $temporaryPackageConfiguration = $true
  }

  Remove-Item -LiteralPath $installerSource -Recurse -Force -ErrorAction SilentlyContinue
  node -e "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true })" $canonical $installerSource
  if ($LASTEXITCODE -ne 0) {
    throw 'failed to create the isolated NSIS source copy'
  }

  Get-ChildItem -LiteralPath $release -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like 'Metrora-Setup-*' -or $_.Extension -eq '.blockmap'
  } | Remove-Item -Force

  Push-Location $app
  try {
    & npx.cmd --no-install electron-builder `
      --win nsis `
      --x64 `
      --prepackaged release/nsis-prepackaged `
      --publish never
    if ($LASTEXITCODE -ne 0) {
      throw "electron-builder NSIS packaging exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  $verification = (& node (Join-Path $repository 'scripts\verify-windows-installer-source.mjs') `
    --canonical $canonical `
    --installer-source $installerSource 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "NSIS source verification failed: $verification"
  }
  Write-Host $verification

  Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $output -Force | Out-Null

  $artifacts = @(Get-ChildItem -LiteralPath $release -File | Where-Object {
    $_.Name -like 'Metrora-Setup-*' -or $_.Extension -eq '.blockmap'
  })
  $executables = @($artifacts | Where-Object { $_.Extension -eq '.exe' })
  if ($executables.Count -ne 1) {
    throw "expected exactly one NSIS executable, found $($executables.Count)"
  }
  $expectedInstallerName = "Metrora-Setup-$ExpectedVersion.exe"
  if ($executables[0].Name -ne $expectedInstallerName) {
    throw "unexpected NSIS executable name: $($executables[0].Name)"
  }

  foreach ($artifact in $artifacts) {
    Copy-Item -LiteralPath $artifact.FullName -Destination $output -Force
  }

  [ordered]@{
    status = 'pass'
    version = $ExpectedVersion
    canonicalPayload = $canonical
    installerSource = $installerSource
    outputDirectory = $output
    installer = $expectedInstallerName
    testInclude = if ($NsisInclude) { $relativeInclude } else { $null }
    artifactNames = @($artifacts.Name | Sort-Object)
  } | ConvertTo-Json -Compress
} finally {
  if ($temporaryPackageConfiguration) {
    [IO.File]::WriteAllBytes($packagePath, $packageBytes)
  }
}
