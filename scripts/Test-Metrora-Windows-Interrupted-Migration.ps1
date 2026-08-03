param(
  [Parameter(Mandatory = $true)]
  [string]$BaselineInstaller,

  [Parameter(Mandatory = $true)]
  [string]$BaselinePayloadDirectory,

  [Parameter(Mandatory = $true)]
  [string]$InterruptionInstaller,

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
    throw "expected exactly one ordinary Metrora setup executable, found $($installers.Count)"
  }
  return $installers[0].FullName
}

function Get-InstalledState([string]$Baseline, [string]$Candidate, [string]$Installed, [string]$Repository) {
  $output = (& node (Join-Path $Repository 'scripts\classify-windows-installed-state.mjs') `
    --baseline $Baseline `
    --candidate $Candidate `
    --installed $Installed 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "installed-state classification failed: $output" }
  return $output | ConvertFrom-Json
}

function Get-BoundedWindowsAuthority([string]$InstallDirectory) {
  $executable = Join-Path $InstallDirectory 'Metrora.exe'
  $uninstaller = Join-Path $InstallDirectory 'Uninstall Metrora.exe'
  $entries = @(Get-MetroraUninstallEntries $InstallDirectory $uninstaller)
  $shortcuts = @(if (Test-Path -LiteralPath $executable) { Get-MetroraShortcuts $executable })
  $registrationVersions = @($entries | ForEach-Object { $_.DisplayVersion } | Sort-Object -Unique)
  $fileVersion = if (Test-Path -LiteralPath $executable) { (Get-Item -LiteralPath $executable).VersionInfo.FileVersion } else { $null }
  return [pscustomobject]@{
    executablePresent = Test-Path -LiteralPath $executable
    uninstallerPresent = Test-Path -LiteralPath $uninstaller
    fileVersion = $fileVersion
    registrationCount = $entries.Count
    registrationVersions = $registrationVersions
    shortcutCount = $shortcuts.Count
  }
}

function Test-MetroraUninstallerAuthority($Entry, [string]$ExpectedUninstaller, [string[]]$ExpectedVersions) {
  return (
    $Entry.Hive -eq 'HKCU' -and
    $Entry.Publisher -eq 'Vensent' -and
    $ExpectedVersions -contains $Entry.DisplayVersion -and
    $Entry.UninstallString.IndexOf($ExpectedUninstaller, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $Entry.QuietUninstallString.IndexOf($ExpectedUninstaller, [StringComparison]::OrdinalIgnoreCase) -ge 0
  )
}

$baselineInstallerPath = (Resolve-Path -LiteralPath $BaselineInstaller).Path
$baselinePayload = (Resolve-Path -LiteralPath $BaselinePayloadDirectory).Path
$interruptInstallerPath = (Resolve-Path -LiteralPath $InterruptionInstaller).Path
$candidate = (Resolve-Path -LiteralPath $CandidateDirectory).Path
$candidatePayload = (Resolve-Path -LiteralPath $CandidatePayloadDirectory).Path
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$candidateInstaller = Get-SingleCandidateInstaller $candidate

if ((Get-FileHash -LiteralPath $interruptInstallerPath -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $candidateInstaller -Algorithm SHA256).Hash) {
  throw 'interruption fixture must differ from the ordinary current installer'
}

$testRoot = Join-Path $env:RUNNER_TEMP "metrora-r1bcb-$PID"
$installDirectory = Join-Path $testRoot 'install'
$roamingDirectory = Join-Path $testRoot 'roaming'
$localDirectory = Join-Path $testRoot 'local'
$checkpoint = Join-Path $testRoot 'installer-checkpoint'
$readyMarker = "$checkpoint.ready"
$releaseMarker = "$checkpoint.release"
if ($installDirectory.Contains(' ')) {
  throw 'disposable install directory must not contain spaces because NSIS /D must be the final unquoted argument'
}

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$originalCheckpoint = $env:METRORA_R1BCB_CHECKPOINT
$interruptProcess = $null
$finalUninstaller = Join-Path $installDirectory 'Uninstall Metrora.exe'

try {
  $env:APPDATA = $roamingDirectory
  $env:LOCALAPPDATA = $localDirectory
  $env:METRORA_R1BCB_CHECKPOINT = $checkpoint
  New-Item -ItemType Directory -Path $env:APPDATA -Force | Out-Null
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
  $sentinel = New-MetroraStateSentinel $roamingDirectory 'r1bcb-user-owned-state.txt'

  Invoke-MetroraSilentInstall $baselineInstallerPath $installDirectory 'interruption baseline install'
  Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $baselinePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $BaselineVersion `
    -Launch | Out-Null
  Assert-MetroraStateSentinel $sentinel 'baseline before interruption'

  Remove-Item -LiteralPath $readyMarker, $releaseMarker -Force -ErrorAction SilentlyContinue
  $interruptProcess = Start-Process -FilePath $interruptInstallerPath -ArgumentList @('/S', "/D=$installDirectory") -PassThru
  Wait-MetroraCondition {
    if ($interruptProcess.HasExited) {
      throw "interruption installer exited before the checkpoint with code $($interruptProcess.ExitCode)"
    }
    Test-Path -LiteralPath $readyMarker
  } 90 'interruption installer did not reach the deterministic checkpoint'
  Write-Host "R1.B.C.B checkpoint observed: $readyMarker"
  Assert-MetroraStateSentinel $sentinel 'interruption checkpoint'

  & taskkill.exe /PID $interruptProcess.Id /T /F | Out-Null
  Wait-MetroraCondition { $interruptProcess.HasExited } 30 'interruption installer process tree did not stop'
  Write-Host "R1.B.C.B installer process tree terminated after checkpoint."
  $interruptProcess = $null
  Start-Sleep -Seconds 2
  Assert-MetroraStateSentinel $sentinel 'installer termination'

  $interruptedState = Get-InstalledState $baselinePayload $candidatePayload $installDirectory $repository
  $interruptedAuthority = Get-BoundedWindowsAuthority $installDirectory
  Write-Host "R1.B.C.B interrupted state: $([ordered]@{ classification = $interruptedState.classification; authority = $interruptedAuthority } | ConvertTo-Json -Depth 5 -Compress)"
  Assert-MetroraStateSentinel $sentinel 'interrupted-state classification'

  if ($interruptedState.classification -eq 'mixed') {
    $entries = @(Get-MetroraUninstallEntries $installDirectory $finalUninstaller)
    $hasSafeAuthority = (
      (Test-Path -LiteralPath $finalUninstaller) -and
      $entries.Count -eq 1 -and
      (Test-MetroraUninstallerAuthority $entries[0] $finalUninstaller @($BaselineVersion, $CandidateVersion))
    )
    if (-not $hasSafeAuthority) {
      throw 'mixed interrupted state has no single safe disposable uninstaller authority'
    }
    $partial = [pscustomobject]@{
      Executable = Join-Path $installDirectory 'Metrora.exe'
      Uninstaller = $finalUninstaller
    }
    Invoke-MetroraSilentUninstall $partial $installDirectory 'mixed-state cleanup'
    Assert-MetroraStateSentinel $sentinel 'mixed-state cleanup'
  }

  Invoke-MetroraSilentInstall $candidateInstaller $installDirectory 'interrupted-upgrade recovery'
  $recovered = Assert-MetroraInstalledApplication `
    -InstallDirectory $installDirectory `
    -CanonicalDirectory $candidatePayload `
    -RepositoryRoot $repository `
    -ExpectedVersion $CandidateVersion `
    -Launch
  Assert-MetroraStateSentinel $sentinel 'current-candidate recovery'

  $recoveredState = Get-InstalledState $baselinePayload $candidatePayload $installDirectory $repository
  if ($recoveredState.classification -ne 'candidate-complete') {
    throw "recovery did not converge to candidate-complete: $($recoveredState.classification)"
  }

  Invoke-MetroraSilentUninstall $recovered $installDirectory 'interruption final uninstall'
  Assert-MetroraStateSentinel $sentinel 'interruption final uninstall'

  [ordered]@{
    status = 'pass'
    checkpointObserved = $true
    interruptedClassification = $interruptedState.classification
    interruptedAuthority = $interruptedAuthority
    recoveredClassification = $recoveredState.classification
    recoveredVersion = $recovered.FileVersion
    userOwnedStatePreserved = $true
  } | ConvertTo-Json -Depth 5 -Compress
}
finally {
  if ($null -ne $interruptProcess -and -not $interruptProcess.HasExited) {
    & taskkill.exe /PID $interruptProcess.Id /T /F | Out-Null
  }
  if (Test-Path -LiteralPath $finalUninstaller) {
    try { Start-Process -FilePath $finalUninstaller -ArgumentList '/S' -Wait | Out-Null } catch { }
  }
  $env:APPDATA = $originalAppData
  $env:LOCALAPPDATA = $originalLocalAppData
  $env:METRORA_R1BCB_CHECKPOINT = $originalCheckpoint
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
