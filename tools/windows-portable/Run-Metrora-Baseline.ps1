[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$MetroraPath,
  [switch]$SkipMetrora,
  [switch]$SkipPrivateCacheBackup,
  [switch]$NoArchive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$bundleRoot = $PSScriptRoot
$metroraExe = Join-Path $bundleRoot 'Metrora.exe'
$metroraCli = Join-Path $bundleRoot 'resources\cli\dist\launch.js'
$buildInfoPath = Join-Path $bundleRoot 'BUILD_INFO.txt'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$baselineRoot = Join-Path $bundleRoot 'baseline-output'
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $baselineRoot "Metrora-Baseline-$stamp"
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

function Quote-NativeArgument {
  param([AllowEmptyString()][string]$Value)
  if ($Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
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

  $exitCode = 1
  $stdout = ''
  $stderr = ''
  $jsonValid = $null
  $startedAt = (Get-Date).ToUniversalTime().ToString('o')

  try {
    if ($UseElectronAsNode) {
      # Metrora.exe is a Windows GUI-subsystem executable. PowerShell's ordinary
      # invocation can return before its stdout pipe is attached, even when
      # ELECTRON_RUN_AS_NODE is set. ProcessStartInfo gives us explicit pipes and
      # wait semantics on Windows PowerShell 5.1 as well as PowerShell 7.
      $startInfo = New-Object System.Diagnostics.ProcessStartInfo
      $startInfo.FileName = $Executable
      $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
      $startInfo.UseShellExecute = $false
      $startInfo.CreateNoWindow = $true
      $startInfo.RedirectStandardOutput = $true
      $startInfo.RedirectStandardError = $true
      $startInfo.StandardOutputEncoding = $utf8NoBom
      $startInfo.StandardErrorEncoding = $utf8NoBom
      $startInfo.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
      $startInfo.EnvironmentVariables['NO_COLOR'] = '1'

      $process = New-Object System.Diagnostics.Process
      $process.StartInfo = $startInfo
      if (-not $process.Start()) { throw "Failed to start $Executable" }
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      $process.WaitForExit()
      $stdout = $stdoutTask.Result
      $stderr = $stderrTask.Result
      $exitCode = $process.ExitCode
      $process.Dispose()
    } else {
      $stderrTemp = [System.IO.Path]::GetTempFileName()
      $outputEncodingPrevious = $OutputEncoding
      $consoleOutputEncodingPrevious = [Console]::OutputEncoding
      $errorActionPreferencePrevious = $ErrorActionPreference
      $electronWasPresent = Test-Path Env:ELECTRON_RUN_AS_NODE
      $electronPrevious = if ($electronWasPresent) { $env:ELECTRON_RUN_AS_NODE } else { $null }
      $noColorWasPresent = Test-Path Env:NO_COLOR
      $noColorPrevious = if ($noColorWasPresent) { $env:NO_COLOR } else { $null }
      try {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        $env:NO_COLOR = '1'
        $OutputEncoding = $utf8NoBom
        [Console]::OutputEncoding = $utf8NoBom
        $ErrorActionPreference = 'Continue'
        $lines = & $Executable @Arguments 2> $stderrTemp
        $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        if ($null -ne $lines) {
          $stdout = (($lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
          if ($stdout.Length -gt 0) { $stdout += [Environment]::NewLine }
        }
        if (Test-Path -LiteralPath $stderrTemp) {
          $stderr = [System.IO.File]::ReadAllText($stderrTemp)
        }
      } finally {
        $OutputEncoding = $outputEncodingPrevious
        [Console]::OutputEncoding = $consoleOutputEncodingPrevious
        $ErrorActionPreference = $errorActionPreferencePrevious
        Restore-EnvironmentValue -Name 'ELECTRON_RUN_AS_NODE' -Value $electronPrevious -WasPresent $electronWasPresent
        Restore-EnvironmentValue -Name 'NO_COLOR' -Value $noColorPrevious -WasPresent $noColorWasPresent
        Remove-Item -LiteralPath $stderrTemp -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    $exitCode = 9001
    $stderr = $_ | Out-String
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

function Resolve-MetroraExecutable {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (-not (Test-Path -LiteralPath $ExplicitPath)) {
      throw "The supplied Metrora path does not exist: $ExplicitPath"
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $command = Get-Command metrora -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { return $null }
  $resolved = if ($command.Source) { $command.Source } elseif ($command.Path) { $command.Path } else { $command.Name }
  if ($resolved -and [System.IO.Path]::GetExtension($resolved) -ieq '.ps1') {
    $cmdSibling = [System.IO.Path]::ChangeExtension($resolved, '.cmd')
    if (Test-Path -LiteralPath $cmdSibling) {
      return (Resolve-Path -LiteralPath $cmdSibling).Path
    }
  }
  return $resolved
}

if (-not (Test-Path -LiteralPath $metroraExe)) {
  throw "Portable Metrora executable not found: $metroraExe"
}
if (-not (Test-Path -LiteralPath $metroraCli)) {
  throw "Bundled Metrora CLI not found: $metroraCli"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $baselineRoot -Force | Out-Null

Write-Host ''
Write-Host 'Metrora Windows baseline'
Write-Host '-------------------------'
Write-Host "Output: $OutputDirectory"
Write-Host 'This reads local AI-tool usage records. It does not upload them.'
Write-Host ''

$results = New-Object System.Collections.ArrayList
$qPrefix = @($metroraCli)

$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-version' -Executable $metroraExe -Arguments ($qPrefix + @('--version')) -OutputFile (Join-Path $OutputDirectory 'metrora-version.txt') -UseElectronAsNode))
$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-doctor' -Executable $metroraExe -Arguments ($qPrefix + @('doctor', '--json')) -OutputFile (Join-Path $OutputDirectory 'metrora-doctor.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-report-lifetime' -Executable $metroraExe -Arguments ($qPrefix + @('report', '--period', 'lifetime', '--format', 'json')) -OutputFile (Join-Path $OutputDirectory 'metrora-report-lifetime.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-report-month' -Executable $metroraExe -Arguments ($qPrefix + @('report', '--period', 'month', '--format', 'json')) -OutputFile (Join-Path $OutputDirectory 'metrora-report-month.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-status' -Executable $metroraExe -Arguments ($qPrefix + @('status', '--format', 'json', '--period', 'lifetime')) -OutputFile (Join-Path $OutputDirectory 'metrora-status.json') -UseElectronAsNode -ExpectJson))
$null = $results.Add((Invoke-CapturedCommand -Name 'metrora-overview-lifetime' -Executable $metroraExe -Arguments ($qPrefix + @('overview', '--period', 'lifetime', '--no-color')) -OutputFile (Join-Path $OutputDirectory 'metrora-overview-lifetime.txt') -UseElectronAsNode))

$resolvedMetrora = $null
$metroraDetectionError = $null
if (-not $SkipMetrora) {
  try {
    $resolvedMetrora = Resolve-MetroraExecutable -ExplicitPath $MetroraPath
  } catch {
    $metroraDetectionError = $_.Exception.Message
  }

  if ($resolvedMetrora) {
    Write-Host "Metrora detected: $resolvedMetrora"
    $null = $results.Add((Invoke-CapturedCommand -Name 'metrora-version' -Executable $resolvedMetrora -Arguments @('--version') -OutputFile (Join-Path $OutputDirectory 'metrora-version.txt')))
    $null = $results.Add((Invoke-CapturedCommand -Name 'metrora-doctor' -Executable $resolvedMetrora -Arguments @('doctor', '--json') -OutputFile (Join-Path $OutputDirectory 'metrora-doctor.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'metrora-report-lifetime' -Executable $resolvedMetrora -Arguments @('report', '--period', 'lifetime', '--format', 'json') -OutputFile (Join-Path $OutputDirectory 'metrora-report-lifetime.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'metrora-report-month' -Executable $resolvedMetrora -Arguments @('report', '--period', 'month', '--format', 'json') -OutputFile (Join-Path $OutputDirectory 'metrora-report-month.json') -ExpectJson))
    $null = $results.Add((Invoke-CapturedCommand -Name 'metrora-overview-lifetime' -Executable $resolvedMetrora -Arguments @('overview', '--period', 'lifetime', '--no-color') -OutputFile (Join-Path $OutputDirectory 'metrora-overview-lifetime.txt')))
  } else {
    Write-Utf8File -Path (Join-Path $OutputDirectory 'metrora-not-detected.txt') -Content @"
Metrora was not found in PATH and no -MetroraPath was supplied.
This does not invalidate the Metrora baseline. Run the script again with:
  powershell -ExecutionPolicy Bypass -File .\Run-Metrora-Baseline.ps1 -MetroraPath "C:\path\to\metrora.cmd"
"@
  }
}

$privateBackupName = $null
$privateBackupStatus = 'skipped'
$cacheDir = if ($env:METRORA_CACHE_DIR) { $env:METRORA_CACHE_DIR } else { Join-Path $HOME '.cache\metrora' }
if (-not $SkipPrivateCacheBackup) {
  if (Test-Path -LiteralPath $cacheDir) {
    $cacheItems = @(Get-ChildItem -LiteralPath $cacheDir -Force -ErrorAction SilentlyContinue)
    if ($cacheItems.Count -gt 0) {
      $privateBackupName = "PRIVATE-DO-NOT-UPLOAD-metrora-cache-$stamp.zip"
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
  metrora = [ordered]@{
    executable = 'Metrora.exe'
    bundledCli = 'resources/cli/dist/launch.js'
    buildInfo = $buildInfo.Trim()
  }
  system = [ordered]@{
    osVersion = [Environment]::OSVersion.VersionString
    architecture = $env:PROCESSOR_ARCHITECTURE
    powershellVersion = $PSVersionTable.PSVersion.ToString()
  }
  comparison = [ordered]@{
    skipped = [bool]$SkipMetrora
    detected = [bool]$resolvedMetrora
    executableName = if ($resolvedMetrora) { [System.IO.Path]::GetFileName($resolvedMetrora) } else { $null }
    detectionError = $metroraDetectionError
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
METRORA BASELINE PRIVACY NOTICE

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
  $archivePath = Join-Path $baselineRoot "Metrora-Baseline-$stamp.zip"
  Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal -Force
}

$metroraFailures = @($results | Where-Object { $_.name -like 'metrora-*' -and $_.exitCode -ne 0 })

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
if ($resolvedMetrora) {
  Write-Host 'Metrora comparison was captured.'
} elseif (-not $SkipMetrora) {
  Write-Host 'Metrora was not detected; Metrora baseline was still captured.'
}

if ($metroraFailures.Count -gt 0) {
  Write-Host ''
  Write-Host 'One or more Metrora commands failed. Keep the generated files for diagnosis.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Baseline completed successfully.' -ForegroundColor Green
exit 0
