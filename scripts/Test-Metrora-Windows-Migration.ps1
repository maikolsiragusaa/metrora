param(
  [Parameter(Mandatory = $true)]
  [string]$BaselineInstaller,

  [Parameter(Mandatory = $true)]
  [string]$BaselinePayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CandidatePayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$BaselineVersion,

  [Parameter(Mandatory = $true)]
  [string]$CandidateVersion,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-installed-app-test-lib.ps1')

function Get-SingleCandidateInstaller([string]$Directory) {
  $installers = @(Get-ChildItem -LiteralPath (Join-Path $Directory 'installer') -Filter 'Metrora-Setup-*.exe' -File)
  if ($installers.Count -ne 1) {
    throw "expected exactly one current Metrora setup executable, found $($installers.Count)"
  }
  return $installers[0].FullName
}

$baselineSemver = [version]$BaselineVersion
$candidateSemver = [version]$CandidateVersion
if ($baselineSemver -ge $candidateSemver) {
  throw "migration baseline must be older than the candidate: $BaselineVersion -> $CandidateVersion"
}

$baselineInstallerPath = (Resolve-Path -LiteralPath $BaselineInstaller).Path
$baselinePayload = (Resolve-Path -LiteralPath $BaselinePayloadDirectory).Path
$candidate = (Resolve-Path -LiteralPath $CandidateDirectory).Path
$candidatePayload = (Resolve-Path -LiteralPath $CandidatePayloadDirectory).Path
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$candidateInstaller = Get-SingleCandidateInstaller $candidate

$testRoot = Join-Path $env:RUNNER_TEMP "metrora-r1bca-$PID"
$installDirectory = Join-Path $testRoot 'install'
$roamingDirectory = Join-Path $testRoot 'roaming'
$localDirectory = Join-Path $testRoot 'local'
if ($installDirectory.Contains(' ')) {
  throw 'disposable install directory must not contain spaces because NSIS /D must be the final unquoted argument'
}

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$finalUninstaller = Join-Path $installDirectory 'Uninstall Metrora.exe'
$stages = @()

try {
  $env:APPDATA = $roamingDirectory
  $env:LOCALAPPDATA = $localDirectory
  New-Item -ItemType Directory -Path $env:APPDATA -Force | Out-Null
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
  $sentinel = New-MetroraStateSentinel $roamingDirectory 'r1bca-user-owned-state.txt'

  Invoke-MetroraSilentInstall $baselineInstallerPath $installDirectory 'baseline install'
  $baseline = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $baselinePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $BaselineVersion `
    -AllowHistoricalPublisher `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'baseline install and launch'
  $stages += "installed-$($baseline.FileVersion)"

  Invoke-MetroraSilentInstall $candidateInstaller $installDirectory 'candidate upgrade'
  $upgraded = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'candidate upgrade and launch'
  $stages += "upgraded-$($upgraded.FileVersion)"

  Invoke-MetroraSilentInstall $candidateInstaller $installDirectory 'candidate reinstall'
  $reinstalled = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion
  Assert-MetroraStateSentinel $sentinel 'candidate reinstall'
  $stages += "reinstalled-$($reinstalled.FileVersion)"

  Invoke-MetroraSilentUninstall $reinstalled $installDirectory 'pre-rollback uninstall'
  Assert-MetroraStateSentinel $sentinel 'pre-rollback uninstall'
  $stages += 'uninstalled-for-rollback'

  Invoke-MetroraSilentInstall $baselineInstallerPath $installDirectory 'baseline rollback'
  $rolledBack = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $baselinePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $BaselineVersion `
    -AllowHistoricalPublisher `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'baseline rollback and launch'
  $stages += "rolled-back-$($rolledBack.FileVersion)"

  Invoke-MetroraSilentInstall $candidateInstaller $installDirectory 'candidate re-upgrade'
  $reupgraded = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'candidate re-upgrade and launch'
  $stages += "re-upgraded-$($reupgraded.FileVersion)"

  Invoke-MetroraSilentUninstall $reupgraded $installDirectory 'final uninstall'
  Assert-MetroraStateSentinel $sentinel 'final uninstall'
  $stages += 'uninstalled'

  [ordered]@{
    status = 'pass'
    baselineVersion = $BaselineVersion
    candidateVersion = $CandidateVersion
    transitions = $stages
    userOwnedStatePreserved = $true
  } | ConvertTo-Json -Compress
}
finally {
  if (Test-Path -LiteralPath $finalUninstaller) {
    try {
      Start-Process -FilePath $finalUninstaller -ArgumentList '/S' -Wait | Out-Null
    } catch {
      Write-Warning "cleanup uninstall failed: $($_.Exception.Message)"
    }
  }
  $env:APPDATA = $originalAppData
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
