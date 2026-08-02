param(
  [Parameter(Mandatory = $true)]
  [string]$BaselineInstaller,

  [Parameter(Mandatory = $true)]
  [string]$BaselinePayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CandidatePayloadDirectory,

  [string]$RepositoryRoot = (Get-Location).Path,
  [string]$BaselineVersion = '0.9.18',
  [string]$CandidateVersion = '0.9.19'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-installed-app-test-lib.ps1')

function Invoke-MetroraInstall([string]$Installer, [string]$InstallDirectory, [string]$Stage) {
  $process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$InstallDirectory") -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Stage installer exited with code $($process.ExitCode)"
  }
}

function Invoke-MetroraUninstall($Installed, [string]$InstallDirectory, [string]$Stage) {
  $process = Start-Process -FilePath $Installed.Uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Stage uninstaller exited with code $($process.ExitCode)"
  }
  Wait-MetroraCondition { -not (Test-Path -LiteralPath $Installed.Executable) } 60 "$Stage did not remove the application executable"
  Wait-MetroraCondition { @(Get-MetroraUninstallEntries $InstallDirectory $Installed.Uninstaller).Count -eq 0 } 30 "$Stage did not remove its registry entry"
  Wait-MetroraCondition { @(Get-MetroraShortcuts $Installed.Executable).Count -eq 0 } 30 "$Stage did not remove the Metrora shortcut"
}

function Get-SingleCandidateInstaller([string]$Directory) {
  $installers = @(Get-ChildItem -LiteralPath (Join-Path $Directory 'installer') -Filter 'Metrora-Setup-*.exe' -File)
  if ($installers.Count -ne 1) {
    throw "expected exactly one current Metrora setup executable, found $($installers.Count)"
  }
  return $installers[0].FullName
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

  Invoke-MetroraInstall $baselineInstallerPath $installDirectory 'baseline install'
  $baseline = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $baselinePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $BaselineVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'baseline install and launch'
  $stages += "installed-$($baseline.FileVersion)"

  Invoke-MetroraInstall $candidateInstaller $installDirectory 'candidate upgrade'
  $upgraded = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'candidate upgrade and launch'
  $stages += "upgraded-$($upgraded.FileVersion)"

  Invoke-MetroraInstall $candidateInstaller $installDirectory 'candidate reinstall'
  $reinstalled = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion
  Assert-MetroraStateSentinel $sentinel 'candidate reinstall'
  $stages += "reinstalled-$($reinstalled.FileVersion)"

  Invoke-MetroraUninstall $reinstalled $installDirectory 'pre-rollback uninstall'
  Assert-MetroraStateSentinel $sentinel 'pre-rollback uninstall'
  $stages += 'uninstalled-for-rollback'

  Invoke-MetroraInstall $baselineInstallerPath $installDirectory 'baseline rollback'
  $rolledBack = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $baselinePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $BaselineVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'baseline rollback and launch'
  $stages += "rolled-back-$($rolledBack.FileVersion)"

  Invoke-MetroraInstall $candidateInstaller $installDirectory 'candidate re-upgrade'
  $reupgraded = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'candidate re-upgrade and launch'
  $stages += "re-upgraded-$($reupgraded.FileVersion)"

  Invoke-MetroraUninstall $reupgraded $installDirectory 'final uninstall'
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
