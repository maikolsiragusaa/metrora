Set-StrictMode -Version Latest

function Get-MetroraFileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-MetroraUtf8Json([string]$Path, $Value) {
  $json = "$($Value | ConvertTo-Json -Depth 16)`n"
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Assert-MetroraPhysicalRepositoryAuthority([string]$RepositoryRoot, [string]$ExpectedCommit) {
  if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$') {
    throw 'physical acceptance expected commit is invalid'
  }
  $repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
  $head = (& git -C $repository rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) {
    throw 'physical acceptance repository HEAD does not match the candidate source commit'
  }
  & git -C $repository diff --quiet -- .
  if ($LASTEXITCODE -ne 0) {
    throw 'physical acceptance repository has modified tracked files'
  }
  & git -C $repository diff --cached --quiet -- .
  if ($LASTEXITCODE -ne 0) {
    throw 'physical acceptance repository has staged tracked changes'
  }
  return $repository
}

function Get-MetroraWindowsPlatform {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'physical Windows acceptance must run on Windows'
  }

  $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem
  $processor = @(Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1)
  if ($processor.Count -ne 1) {
    throw 'physical Windows acceptance could not determine processor architecture'
  }

  $architecture = switch ([int]$processor[0].Architecture) {
    0 { 'x86' }
    5 { 'arm' }
    6 { 'ia64' }
    9 { 'x64' }
    12 { 'arm64' }
    default { "unknown-$([int]$processor[0].Architecture)" }
  }

  return [ordered]@{
    edition = [string]$operatingSystem.Caption
    version = [string]$operatingSystem.Version
    build = [string]$operatingSystem.BuildNumber
    architecture = $architecture
  }
}

function New-MetroraNotRunProfiles {
  return [ordered]@{
    existing = [ordered]@{
      status = 'not-run'
      portableVerified = $false
      identityPreserved = $false
      workspacePreserved = $false
      lifecyclePreserved = $false
      evidencePreserved = $false
      reopenPassed = $false
      recoveryMode = 'not-run'
      duplicateProductionCount = 0
      duplicateBatchCount = 0
      invalidCount = 0
      quarantinedCount = 0
    }
    clean = [ordered]@{
      status = 'not-run'
      registrationCount = 0
      shortcutCount = 0
      cliVersion = $null
      firstLaunchPassed = $false
      uninstallPassed = $false
      sentinelPreserved = $false
    }
    migration = [ordered]@{
      status = 'not-run'
      transitions = @()
      sentinelPreserved = $false
      fixtureRemoved = $false
    }
  }
}

function Read-MetroraAcceptanceChoice([string]$Prompt, [string[]]$Allowed) {
  while ($true) {
    $value = (Read-Host "$Prompt [$($Allowed -join '/')]").Trim().ToLowerInvariant()
    if ($Allowed -contains $value) { return $value }
    Write-Host "Unsupported value. Allowed: $($Allowed -join ', ')."
  }
}

function Read-MetroraAcceptanceBoolean([string]$Prompt) {
  return (Read-MetroraAcceptanceChoice $Prompt @('yes', 'no')) -eq 'yes'
}

function Read-MetroraAcceptanceCount([string]$Prompt, [int]$Maximum = 1000000) {
  while ($true) {
    $raw = (Read-Host "$Prompt [0-$Maximum]").Trim()
    $value = 0
    if ([int]::TryParse($raw, [ref]$value) -and $value -ge 0 -and $value -le $Maximum) {
      return $value
    }
    Write-Host "Enter a whole number between 0 and $Maximum."
  }
}

function Assert-MetroraPhysicalSentinel([string]$SentinelPath, [string]$ExpectedSha256) {
  if (-not (Test-Path -LiteralPath $SentinelPath -PathType Leaf)) {
    throw 'physical acceptance sentinel is missing'
  }
  $actual = Get-MetroraFileSha256 $SentinelPath
  if ($actual -ne $ExpectedSha256) {
    throw 'physical acceptance sentinel changed'
  }
}

function Get-MetroraPhysicalOverallStatus($Profiles) {
  $statuses = @($Profiles.existing.status, $Profiles.clean.status, $Profiles.migration.status)
  if ($statuses -contains 'fail') { return 'fail' }
  if ($statuses -contains 'not-run') { return 'incomplete' }
  return 'pass'
}
