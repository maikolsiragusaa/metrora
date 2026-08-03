. (Join-Path $PSScriptRoot 'windows-install-test-lib.ps1')

function Assert-MetroraInstalledApplication(
  [string]$InstallDirectory,
  [string]$CanonicalDirectory,
  [string]$RepositoryRoot,
  [string]$ExpectedVersion,
  [string]$ExpectedPublisher = 'Vensent',
  [switch]$AllowHistoricalPublisher,
  [switch]$Launch
) {
  $executable = Join-Path $InstallDirectory 'Metrora.exe'
  $uninstaller = Join-Path $InstallDirectory 'Uninstall Metrora.exe'
  if (-not (Test-Path -LiteralPath $executable)) { throw 'installed Metrora.exe is missing' }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'installed Metrora uninstaller is missing' }

  $layoutReport = (& node (Join-Path $RepositoryRoot 'scripts\verify-windows-installed-layout.mjs') `
    --canonical $CanonicalDirectory `
    --installed $InstallDirectory 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "installed layout verification failed: $layoutReport" }
  Write-Host $layoutReport

  $versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
  if ($versionInfo.ProductName -ne 'Metrora') { throw "installed ProductName is not Metrora: $($versionInfo.ProductName)" }
  if ($versionInfo.FileDescription -notmatch 'Metrora') { throw "installed FileDescription is not canonical: $($versionInfo.FileDescription)" }
  if ($versionInfo.FileVersion -ne $ExpectedVersion) { throw "installed FileVersion is not ${ExpectedVersion}: $($versionInfo.FileVersion)" }

  $registration = Assert-MetroraUninstallRegistration `
    -InstallDirectory $InstallDirectory `
    -Uninstaller $uninstaller `
    -ExpectedVersion $ExpectedVersion `
    -ExpectedPublisher $ExpectedPublisher `
    -AllowHistoricalPublisher:$AllowHistoricalPublisher
  $shortcuts = @(Get-MetroraShortcuts $executable)
  if ($shortcuts.Count -lt 1) { throw 'canonical Metrora Start Menu shortcut was not created' }

  $cli = Join-Path $InstallDirectory 'resources\cli\dist\cli.js'
  if (-not (Test-Path -LiteralPath $cli)) { throw 'installed compatibility CLI is missing' }
  $cliVersion = (& node $cli --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $cliVersion -ne $ExpectedVersion) {
    throw "installed compatibility CLI version is not ${ExpectedVersion}: $cliVersion"
  }

  if ($Launch) {
    $process = Start-Process -FilePath $executable -PassThru
    Start-Sleep -Seconds 8
    if ($process.HasExited) { throw "installed Metrora exited during launch smoke with code $($process.ExitCode)" }
    Stop-MetroraProcess $process
  }

  return [pscustomobject]@{
    Executable = $executable
    Uninstaller = $uninstaller
    ProductName = $versionInfo.ProductName
    FileVersion = $versionInfo.FileVersion
    CliVersion = $cliVersion
    ShortcutCount = $shortcuts.Count
    Registration = $registration
  }
}
