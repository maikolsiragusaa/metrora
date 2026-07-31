[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$CodeBurnPath,
  [switch]$SkipCodeBurn,
  [switch]$SkipPrivateCacheBackup,
  [switch]$NoArchive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$bundleRoot = $PSScriptRoot
$qovrionExe = Join-Path $bundleRoot 'Qovrion.exe'
$qovrionCli = Join-Path $bundleRoot 'resources\cli\dist\launch.js'
$buildInfoPath = Join-Path $bundleRoot 'BUILD_INFO.txt'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$baselineRoot = Join-Path $bundleRoot 'baseline-output'
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $baselineRoot "Qovrion-Baseline-$stamp"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [AllowEmptyString()][string]$Content
  )
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Restore-EnvironmentValue {
  param([string]$Name, [AllowNull()][string]$Value, [bool]$WasPresent)
  if ($WasPresent) {
    Set-Item -Path "Env:$Name" -Value $Value
  } else {
    Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
  }
}

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$OutputFile,
    [switch]$UseElectronAsNode,
    [switch]$ExpectJson
  )

  $stderrTemp = [System.IO.Path]::GetTempFileName()
  $electronWasPresent = Test-Path Env:ELECTRON_RUN_AS_NODE
  $electronPrevious = if ($electronWasPresent) { $env:ELECTRON_RUN_AS_NODE } else { $null }
  $noColorWasPresent = Test-Path Env:NO_COLOR
  $noColorPrevious = if ($noColorWasPresent) { $env:NO_COLOR } else { $null }

  $exitCode = 1
  $stdout = ''
  $stderr = ''
  $jsonValid = $null
  $startedAt = (Get-Date).ToUniversalTime().ToString('o')

  try {
    if ($UseElectronAsNode) {
      $env:ELECTRON_RUN_AS_NODE = '1'
    } else {
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    }
    $env:NO_COLOR = '1'

    $lines = & $Executable @Arguments 2> $stderrTemp
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($null -ne $lines) {
      $stdout = (($lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
      if ($stdout.Length -gt 0) { $stdout += [Environment]::NewLine }
    }
    if (Test-Path -LiteralPath $stderrTemp) {
      $stderr = [System.IO.File]::ReadAllText($stderrTemp)
    }
  } catch {
    $exitCode = 9001
    $stderr = $_ | Out-String
  } finally {
    Restore-EnvironmentValue -Name 'ELECTRON_RUN_AS_NODE' -Value $electronPrevious -WasPresent $electronWasPresent
    Restore-EnvironmentValue -Name 'NO_COLOR' -Value $noColorPrevious -WasPresent $noColorWasPresent
    Remove-Item -LiteralPath $stderrTemp -Force -ErrorAction SilentlyContinue
  }

  Write-Utf8File -Path $OutputFile -Content $stdout
  Write-Utf8File -Path "$OutputFile.stderr.txt" -Content $stderr

  if ($ExpectJson -and $exitCode -eq 0) {
    try {
      $null = $stdout | ConvertFrom-Json
      $jsonValid = $true
    } catch {
      $jsonValid = $false
      $exitCode = 9002
      Write-Utf8File -Path "$OutputFile.json-error.txt" -Content ($_ | Out-String)
    }
  }

  return [ordered]@{
    name = $Name
    executable = [System.IO.Path]::GetFileName($Executable)
    arguments = $Arguments
    outputFile = [System.IO.Path]::GetFileName($OutputFile)
    stderrFile = [System.IO.Path]::GetFileName("$OutputFile.stderr.txt")
    startedAt = $startedAt
    exitCode = $exitCode
    jsonValid = $jsonValid
  }
}

function Resolve-CodeBurnExecutable {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (-not (Test-Path -LiteralPath $ExplicitPath)) {
      throw "The supplied CodeBurn path does not exist: $ExplicitPath"
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $command = Get-Command codeburn -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { return $null }
  if ($command.Source) { return $command.Source }
  if ($command.Path) { return $command.Path }
  return $command.Name
}

if (-not (Test-Path -LiteralPath $qovrionExe)) {
  throw "Portable Qovrion executable not found: $qovrionExe"
}
if (-not (Test-Path -LiteralPath $qovrionCli)) {
  throw "Bundled Qovrion CLI not found: $qovrionCli"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $baselineRoot -Force | Out-Null

Write-Host ''
Write-Host 'Qovrion Windows baseline'
Write-Host '-------------------------'
Write-Host "Output: $OutputDirectory"
Write-Host 'This reads local AI-tool usage records. It does not upload them.'
Write-Host ''

$results = New-Object System.Collections.ArrayList
$qPrefix = @($qovrionCli)

$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-version' -Executable $qovrionExe -Arguments ($qPrefix + @('--version')) -OutputFile (Join-Path $OutputDirectory 'qovrion-version.txt') -UseElectronAsNode))
$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-doctor' -Executable $qovrionExe -Arguments ($qPrefix + @('doctor', '--json')) -OutputFile (Join-Path $OutputDirectory 'qovrion-doctor.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-report-lifetime' -Executable $qovrionExe -Arguments ($qPrefix + @('report', '--period', 'lifetime', '--format', 'json')) -OutputFile (Join-Path $OutputDirectory 'qovrion-report-lifetime.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-report-month' -Executable $qovrionExe -Arguments ($qPrefix + @('report', '--period', 'month', '--format', 'json')) -OutputFile (Join-Path $OutputDirectory 'qovrion-report-month.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-status' -Executable $qovrionExe -Arguments ($qPrefix + @('status', '--format', 'json', '--period', 'lifetime')) -OutputFile (Join-Path $OutputDirectory 'qovrion-status.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'qovrion-overview-lifetime' -Executable $qovrionExe -Arguments ($qPrefix + @('overview', '--period', 'lifetime', '--no-color')) -OutputFile (Join-Path $OutputDirectory 'qovrion-overview-lifetime.txt') -UseElectronAsNode))

$resolvedCodeBurn = $null
$codeBurnDetectionError = $null
if (-not $SkipCodeBurn) {
  try {
    $resolvedCodeBurn = Resolve-CodeBurnExecutable -ExplicitPath $CodeBurnPath
  } catch {
    $codeBurnDetectionError = $_.Exception.Message
  }

  if ($resolvedCodeBurn) {
    Write-Host "CodeBurn detected: $resolvedCodeBurn"
    $null = $results.Add((Invoke-CapturedCommand -Name 'codeburn-version' -Executable $resolvedCodeBurn -Arguments @('--version') -OutputFile (Join-Path $OutputDirectory 'codeburn-version.txt')))
    $null = $results.Add((Invoke-CapturedCommand -Name 'codeburn-doctor' -Executable $resolvedCodeBurn -Arguments @('doctor', '--json') -OutputFile (Join-Path $OutputDirectory 'codeburn-doctor.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'codeburn-report-lifetime' -Executable $resolvedCodeBurn -Arguments @('report', '--period', 'lifetime', '--format', 'json') -OutputFile (Join-Path $OutputDirectory 'codeburn-report-lifetime.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'codeburn-report-month' -Executable $resolvedCodeBurn -Arguments @('report', '--period', 'month', '--format', 'json') -OutputFile (Join-Path $OutputDirectory 'codeburn-report-month.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'codeburn-overview-lifetime' -Executable $resolvedCodeBurn -Arguments @('overview', '--period', 'lifetime', '--no-color') -OutputFile (Join-Path $OutputDirectory 'codeburn-overview-lifetime.txt')))
  } else {
    Write-Utf8File -Path (Join-Path $OutputDirectory 'codeburn-not-detected.txt') -Content @"
CodeBurn was not found in PATH and no -CodeBurnPath was supplied.
This does not invalidate the Qovrion baseline. Run the script again with:
  powershell -ExecutionPolicy Bypass -File .\Run-Qovrion-Baseline.ps1 -CodeBurnPath "C:\path\to\codeburn.cmd"
"@
  }
}

$privateBackupName = $null
$privateBackupStatus = 'skipped'
$cacheDir = if ($env:CODEBURN_CACHE_DIR) { $env:CODEBURN_CACHE_DIR } else { Join-Path $HOME '.cache\codeburn' }
if (-not $SkipPrivateCacheBackup) {
  if (Test-Path -LiteralPath $cacheDir) {
    $cacheItems = @(Get-ChildItem -LiteralPath $cacheDir -Force -ErrorAction SilentlyContinue)
    if ($cacheItems.Count -gt 0) {
      $privateBackupName = "PRIVATE-DO-NOT-UPLOAD-codeburn-cache-$stamp.zip"
      $privateBackupPath = Join-Path $baselineRoot $privateBackupName
      try {
        Compress-Archive -Path (Join-Path $cacheDir '*') -DestinationPath $privateBackupPath -CompressionLevel Optimal -Force
        $privateBackupStatus = 'created'
      } catch {
        $privateBackupStatus = 'failed'
        Write-Utf8File -Path (Join-Path $OutputDirectory 'private-cache-backup-error.txt') -Content ($_ | Out-String)
      }
    } else {
      $privateBackupStatus = 'cache-empty'
    }
  } else {
    $privateBackupStatus = 'cache-not-found'
  }
}

$buildInfo = if (Test-Path -LiteralPath $buildInfoPath) {
  [System.IO.File]::ReadAllText($buildInfoPath)
} else {
  'BUILD_INFO.txt missing'
}
Write-Utf8File -Path (Join-Path $OutputDirectory 'BUILD_INFO.txt') -Content $buildInfo

$manifest = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  qovrion = [ordered]@{
    executable = 'Qovrion.exe'
    bundledCli = 'resources/cli/dist/launch.js'
    buildInfo = $buildInfo.Trim()
  }
  system = [ordered]@{
    osVersion = [Environment]::OSVersion.VersionString
    architecture = $env:PROCESSOR_ARCHITECTURE
    powershellVersion = $PSVersionTable.PSVersion.ToString()
  }
  codeburn = [ordered]@{
    skipped = [bool]$SkipCodeBurn
    detected = [bool]$resolvedCodeBurn
    executableName = if ($resolvedCodeBurn) { [System.IO.Path]::GetFileName($resolvedCodeBurn) } else { $null }
    detectionError = $codeBurnDetectionError
  }
  privateCacheBackup = [ordered]@{
    status = $privateBackupStatus
    fileName = $privateBackupName
    includedInShareableArchive = $false
  }
  commands = @($results)
  privacy = [ordered]@{
    uploadedAutomatically = $false
    promptsExportedByThisScript = $false
    sourceCodeExportedByThisScript = $false
    note = 'Reports can contain model names, project labels, local probe paths, and session identifiers. Review before sharing.'
  }
}
Write-Utf8File -Path (Join-Path $OutputDirectory 'manifest.json') -Content (($manifest | ConvertTo-Json -Depth 12) + [Environment]::NewLine)

Write-Utf8File -Path (Join-Path $OutputDirectory 'README-PRIVACY.txt') -Content @"
QOVRION BASELINE PRIVACY NOTICE

No file was uploaded automatically.

The shareable baseline can contain:
- model/provider/source names;
- project labels and local probe paths;
- session identifiers;
- token and API-equivalent cost totals.

It does not intentionally export prompts, responses, source code, patches, or credentials.
Review the files before sharing them.

A cache backup named PRIVATE-DO-NOT-UPLOAD-*.zip may have been created beside the
shareable baseline ZIP. Keep that file locally. It may contain paths and cached
session metadata and is deliberately excluded from the shareable archive.
"@

$archivePath = $null
if (-not $NoArchive) {
  $archivePath = Join-Path $baselineRoot "Qovrion-Baseline-$stamp.zip"
  Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal -Force
}

$qovrionFailures = @($results | Where-Object { $_.name -like 'qovrion-*' -and $_.exitCode -ne 0 })

Write-Host ''
if ($archivePath) {
  Write-Host "Shareable baseline: $archivePath"
} else {
  Write-Host "Baseline directory: $OutputDirectory"
}
if ($privateBackupName) {
  Write-Host "Private local backup: $(Join-Path $baselineRoot $privateBackupName)"
  Write-Host 'Do not upload the PRIVATE backup.'
}
if ($resolvedCodeBurn) {
  Write-Host 'CodeBurn comparison was captured.'
} elseif (-not $SkipCodeBurn) {
  Write-Host 'CodeBurn was not detected; Qovrion baseline was still captured.'
}

if ($qovrionFailures.Count -gt 0) {
  Write-Host ''
  Write-Host 'One or more Qovrion commands failed. Keep the generated files for diagnosis.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Baseline completed successfully.' -ForegroundColor Green
exit 0
