. (Join-Path $PSScriptRoot 'windows-install-test-lib.ps1')

function Resolve-MetroraExpectedFileVersion(
  [string]$PublicVersion,
  [string]$RepositoryRoot,
  [switch]$AllowHistoricalVersion
) {
  if ($AllowHistoricalVersion) { return $PublicVersion }
  $output = (& node (Join-Path $RepositoryRoot 'scripts\resolve-metrora-build-version.mjs') `
    $PublicVersion 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "platform build-version resolution failed for ${PublicVersion}: $output"
  }
  return $output
}

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

  $expectedFileVersion = Resolve-MetroraExpectedFileVersion `
    -PublicVersion $ExpectedVersion `
    -RepositoryRoot $RepositoryRoot `
    -AllowHistoricalVersion:$AllowHistoricalPublisher
  $versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
  if ($versionInfo.ProductName -ne 'Metrora') { throw "installed ProductName is not Metrora: $($versionInfo.ProductName)" }
  if ($versionInfo.FileDescription -notmatch 'Metrora') { throw "installed FileDescription is not canonical: $($versionInfo.FileDescription)" }
  if ($versionInfo.FileVersion -ne $expectedFileVersion) {
    throw "installed FileVersion is not ${expectedFileVersion} for ${ExpectedVersion}: $($versionInfo.FileVersion)"
  }

  $registration = Assert-MetroraUninstallRegistration `
    -InstallDirectory $InstallDirectory `
    -Uninstaller $uninstaller `
    -ExpectedVersion $ExpectedVersion `
    -ExpectedPublisher $ExpectedPublisher `
    -AllowHistoricalPublisher:$AllowHistoricalPublisher
  $shortcuts = @(Get-MetroraShortcuts $executable)
  if ($shortcuts.Count -lt 1) { throw 'canonical Metrora Start Menu shortcut was not created' }

  # Historical migration fixtures predate the sealed runtime and intentionally
  # retain their original loose CLI layout. Current candidates must exercise the
  # exact installed Electron/ASAR runtime instead of relying on the runner's Node.
  if ($AllowHistoricalPublisher) {
    $cli = Join-Path $InstallDirectory 'resources\cli\dist\cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'installed historical compatibility CLI is missing' }
    $cliVersion = (& node $cli --version 2>&1 | Out-String).Trim()
  } else {
    $cliRoot = Join-Path $InstallDirectory 'resources\cli'
    $cli = Join-Path $cliRoot 'dist\launch.js'
    $cliArchive = Join-Path $InstallDirectory 'resources\cli.asar'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'installed bundled CLI launcher is missing' }
    if (-not (Test-Path -LiteralPath $cliArchive -PathType Leaf)) { throw 'installed bundled CLI archive is missing' }
    if (Test-Path -LiteralPath (Join-Path $cliRoot 'node_modules')) {
      throw 'installed bundled CLI must not expose a loose node_modules tree'
    }

    $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
      $env:ELECTRON_RUN_AS_NODE = '1'
      $cliVersion = (& $executable $cli --version 2>&1 | Out-String).Trim()
    } finally {
      $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
    }
  }
  if ($LASTEXITCODE -ne 0 -or $cliVersion -ne $ExpectedVersion) {
    throw "installed bundled CLI version is not ${ExpectedVersion}: $cliVersion"
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
    PublicVersion = $ExpectedVersion
    FileVersion = $versionInfo.FileVersion
    CliVersion = $cliVersion
    ShortcutCount = $shortcuts.Count
    Registration = $registration
  }
}
