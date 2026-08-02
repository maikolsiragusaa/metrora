param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CanonicalPayloadDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-installed-app-test-lib.ps1')

$candidate = (Resolve-Path -LiteralPath $CandidateDirectory).Path
$canonical = (Resolve-Path -LiteralPath $CanonicalPayloadDirectory).Path
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$expectedVersion = (Get-Content -LiteralPath (Join-Path $repository 'app\package.json') -Raw | ConvertFrom-Json).version
$installerDirectory = Join-Path $candidate 'installer'
$installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter 'Metrora-Setup-*.exe' -File)
if ($installers.Count -ne 1) {
  throw "expected exactly one Metrora setup executable, found $($installers.Count)"
}

$testRoot = Join-Path $env:RUNNER_TEMP "metrora-r1bb-$PID"
$installDirectory = Join-Path $testRoot 'install'
$roamingDirectory = Join-Path $testRoot 'roaming'
$localDirectory = Join-Path $testRoot 'local'
if ($installDirectory.Contains(' ')) {
  throw 'disposable install directory must not contain spaces because NSIS /D must be the final unquoted argument'
}

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA

try {
  $env:APPDATA = $roamingDirectory
  $env:LOCALAPPDATA = $localDirectory
  New-Item -ItemType Directory -Path $env:APPDATA -Force | Out-Null
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
  $sentinel = New-MetroraStateSentinel $roamingDirectory 'r1bb-user-owned-state.txt'

  Invoke-MetroraSilentInstall $installers[0].FullName $installDirectory 'clean install'
  $installed = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $canonical `
    -RepositoryRoot $repository `
    -ExpectedVersion $expectedVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'installation or launch'

  Invoke-MetroraSilentUninstall $installed $installDirectory 'clean uninstall'
  Assert-MetroraStateSentinel $sentinel 'uninstall'

  [ordered]@{
    status = 'pass'
    installer = $installers[0].Name
    productName = $installed.ProductName
    fileVersion = $installed.FileVersion
    cliVersion = $installed.CliVersion
    shortcutCount = $installed.ShortcutCount
    uninstallRegistryHive = $installed.Registration.Hive
    uninstallRegistryView = $installed.Registration.View
    uninstallDisplayName = $installed.Registration.DisplayName
    userOwnedStatePreserved = $true
  } | ConvertTo-Json -Compress
}
finally {
  $env:APPDATA = $originalAppData
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
