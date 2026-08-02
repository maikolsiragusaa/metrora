param(
  [Parameter(Mandatory = $true)]
  [string]$AcceptanceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [switch]$DedicatedProfileAcknowledged,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-installed-app-test-lib.ps1')
. (Join-Path $PSScriptRoot 'windows-physical-acceptance-lib.ps1')

if (-not $DedicatedProfileAcknowledged) {
  throw 'P2 requires an explicitly acknowledged dedicated Windows user profile'
}

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$acceptance = (Resolve-Path -LiteralPath $AcceptanceDirectory).Path
$candidate = (Resolve-Path -LiteralPath $CandidateDirectory).Path
$canonical = (Resolve-Path -LiteralPath (Join-Path $acceptance 'canonical-payload')).Path
$contextPath = Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json'
$context = Get-Content -LiteralPath $contextPath -Raw | ConvertFrom-Json
if ($context.kind -ne 'metrora.windows-physical-acceptance-context' -or $context.version -ne 1) {
  throw 'physical acceptance context is invalid'
}

$sentinelPath = Join-Path $acceptance $context.sentinel.file
Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

$install = [IO.Path]::GetFullPath($InstallDirectory)
if ($install.Contains(' ')) {
  throw 'physical clean install directory must not contain spaces because NSIS /D must be the final unquoted argument'
}
if (Test-Path -LiteralPath $install) {
  $existing = @(Get-ChildItem -LiteralPath $install -Force -ErrorAction Stop)
  if ($existing.Count -gt 0) {
    throw 'physical clean install directory must be absent or empty'
  }
}

$installers = @(Get-ChildItem -LiteralPath (Join-Path $candidate 'installer') -Filter 'Metrora-Setup-*.exe' -File)
if ($installers.Count -ne 1) {
  throw "expected exactly one ordinary Metrora installer, found $($installers.Count)"
}

$installed = $null
$resultPath = Join-Path $acceptance 'P2_CLEAN_RESULT.json'
try {
  Invoke-MetroraSilentInstall $installers[0].FullName $install 'physical clean install'
  $installed = Assert-MetroraInstalledApplication `
    -InstallDirectory $install `
    -CanonicalDirectory $canonical `
    -RepositoryRoot $repository `
    -ExpectedVersion $context.candidate.productVersion `
    -Launch
  if ($installed.ShortcutCount -ne 1) {
    throw "physical clean PASS requires exactly one canonical shortcut, found $($installed.ShortcutCount)"
  }
  Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

  Invoke-MetroraSilentUninstall $installed $install 'physical clean uninstall'
  Assert-MetroraPhysicalSentinel $sentinelPath $context.sentinel.sha256

  $result = [ordered]@{
    status = 'pass'
    registrationCount = 1
    shortcutCount = [int]$installed.ShortcutCount
    cliVersion = [string]$installed.CliVersion
    firstLaunchPassed = $true
    uninstallPassed = $true
    sentinelPreserved = $true
  }
  Write-MetroraUtf8Json $resultPath $result
  $result | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $installed -and (Test-Path -LiteralPath $installed.Uninstaller)) {
    try { Invoke-MetroraSilentUninstall $installed $install 'physical clean final cleanup' } catch { }
  }
}
