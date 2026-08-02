param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$CanonicalPayloadDirectory,

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureMessage) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $FailureMessage
}

function Get-MetroraUninstallEntries {
  $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (-not (Test-Path -LiteralPath $root)) { return @() }
  return @(Get-ChildItem -LiteralPath $root | ForEach-Object {
    Get-ItemProperty -LiteralPath $_.PSPath
  } | Where-Object { $_.DisplayName -eq 'Metrora' })
}

function Get-MetroraShortcuts([string]$ExpectedExecutable) {
  $roots = @(
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonPrograms')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

  $shell = New-Object -ComObject WScript.Shell
  $matches = @()
  foreach ($root in $roots) {
    foreach ($file in Get-ChildItem -LiteralPath $root -Filter 'Metrora.lnk' -File -Recurse -ErrorAction SilentlyContinue) {
      $shortcut = $shell.CreateShortcut($file.FullName)
      if ([string]::Equals($shortcut.TargetPath, $ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        $matches += $file.FullName
      }
    }
  }
  return $matches
}

$candidate = (Resolve-Path -LiteralPath $CandidateDirectory).Path
$canonical = (Resolve-Path -LiteralPath $CanonicalPayloadDirectory).Path
$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
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

$stateDirectory = Join-Path $roamingDirectory 'metrora-desktop\metrora-local-state'
$sentinelPath = Join-Path $stateDirectory 'r1bb-user-owned-state.txt'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Set-Content -LiteralPath $sentinelPath -Value 'Metrora R1.B.B user-owned state sentinel' -Encoding UTF8
$sentinelHash = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$appProcess = $null

try {
  $env:APPDATA = $roamingDirectory
  $env:LOCALAPPDATA = $localDirectory
  New-Item -ItemType Directory -Path $env:APPDATA -Force | Out-Null
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null

  $install = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "silent installer exited with code $($install.ExitCode)"
  }

  $executable = Join-Path $installDirectory 'Metrora.exe'
  $uninstaller = Join-Path $installDirectory 'Uninstall Metrora.exe'
  if (-not (Test-Path -LiteralPath $executable)) { throw 'installed Metrora.exe is missing' }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'installed uninstaller is missing' }

  & node (Join-Path $repository 'scripts\verify-windows-installed-layout.mjs') `
    --canonical $canonical `
    --installed $installDirectory
  if ($LASTEXITCODE -ne 0) { throw 'installed layout verification failed' }

  $versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
  if ($versionInfo.ProductName -ne 'Metrora') {
    throw "installed executable ProductName is not Metrora: $($versionInfo.ProductName)"
  }
  if ($versionInfo.FileDescription -notmatch 'Metrora') {
    throw "installed executable FileDescription is not canonical: $($versionInfo.FileDescription)"
  }

  $registryEntries = @(Get-MetroraUninstallEntries)
  if ($registryEntries.Count -ne 1) {
    throw "expected one per-user Metrora uninstall entry, found $($registryEntries.Count)"
  }
  if ($registryEntries[0].UninstallString -notmatch 'Uninstall Metrora\.exe') {
    throw 'uninstall registry entry does not point to the canonical uninstaller'
  }

  $shortcuts = @(Get-MetroraShortcuts $executable)
  if ($shortcuts.Count -lt 1) {
    throw 'canonical Metrora Start Menu shortcut was not created'
  }

  $cli = Join-Path $installDirectory 'resources\cli\dist\cli.js'
  if (-not (Test-Path -LiteralPath $cli)) { throw 'installed compatibility CLI is missing' }
  $cliVersion = (& node $cli --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $cliVersion) {
    throw 'installed compatibility CLI version smoke test failed'
  }

  $appProcess = Start-Process -FilePath $executable -PassThru
  Start-Sleep -Seconds 8
  if ($appProcess.HasExited) {
    throw "installed Metrora exited during launch smoke test with code $($appProcess.ExitCode)"
  }
  & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
  Wait-Until { $appProcess.HasExited } 20 'installed Metrora process did not stop after launch smoke test'
  $appProcess = $null

  if (-not (Test-Path -LiteralPath $sentinelPath)) {
    throw 'installation or launch deleted user-owned local state'
  }
  if ((Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash -ne $sentinelHash) {
    throw 'installation or launch modified user-owned local state'
  }

  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) {
    throw "silent uninstaller exited with code $($uninstall.ExitCode)"
  }

  Wait-Until { -not (Test-Path -LiteralPath $executable) } 60 'silent uninstall did not remove the application executable'
  Wait-Until { @(Get-MetroraUninstallEntries).Count -eq 0 } 30 'silent uninstall did not remove its registry entry'
  Wait-Until { @(Get-MetroraShortcuts $executable).Count -eq 0 } 30 'silent uninstall did not remove the Metrora shortcut'

  if (-not (Test-Path -LiteralPath $sentinelPath)) {
    throw 'uninstall deleted user-owned local state'
  }
  if ((Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash -ne $sentinelHash) {
    throw 'uninstall modified user-owned local state'
  }

  [ordered]@{
    status = 'pass'
    installer = $installers[0].Name
    installDirectory = $installDirectory
    productName = $versionInfo.ProductName
    fileVersion = $versionInfo.FileVersion
    cliVersion = $cliVersion
    shortcutCount = $shortcuts.Count
    userOwnedStatePreserved = $true
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $appProcess -and -not $appProcess.HasExited) {
    & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
  }
  $env:APPDATA = $originalAppData
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
