Set-StrictMode -Version Latest

function Get-MetroraFileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-MetroraUtf8Json([string]$Path, $Value) {
  $json = "$($Value | ConvertTo-Json -Depth 16)`n"
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Expand-MetroraBoundedArtifactArchive([string]$ArchivePath, [string]$DestinationDirectory) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $archiveFile = (Resolve-Path -LiteralPath $ArchivePath).Path
  $destination = [IO.Path]::GetFullPath($DestinationDirectory)
  if (Test-Path -LiteralPath $destination) {
    $existing = @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction Stop)
    if ($existing.Count -gt 0) {
      throw 'artifact extraction destination must be absent or empty'
    }
  }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null

  $rootPrefix = $destination.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $maximumEntries = 20000
  $maximumUncompressedBytes = [int64]5 * 1024 * 1024 * 1024
  $entryCount = 0
  $uncompressedBytes = [int64]0
  $zip = [IO.Compression.ZipFile]::OpenRead($archiveFile)

  try {
    foreach ($entry in $zip.Entries) {
      $entryCount += 1
      if ($entryCount -gt $maximumEntries) {
        throw 'artifact archive contains too many entries'
      }
      $uncompressedBytes += [int64]$entry.Length
      if ($uncompressedBytes -gt $maximumUncompressedBytes) {
        throw 'artifact archive expands beyond the bounded size limit'
      }

      $name = $entry.FullName.Replace('\', '/')
      $isDirectory = $name.EndsWith('/')
      $normalized = if ($isDirectory) { $name.TrimEnd('/') } else { $name }
      if (
        -not $normalized -or
        $normalized.StartsWith('/') -or
        $normalized.Contains(':') -or
        $normalized.IndexOf([char]0) -ge 0
      ) {
        throw 'artifact archive contains an invalid entry path'
      }
      $segments = @($normalized.Split('/'))
      if ($segments | Where-Object { -not $_ -or $_ -eq '.' -or $_ -eq '..' }) {
        throw 'artifact archive contains an invalid entry segment'
      }

      $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixType -eq 0xA000) {
        throw 'artifact archive contains an unsupported symbolic link'
      }

      $relativePath = $normalized.Replace('/', [IO.Path]::DirectorySeparatorChar)
      $target = [IO.Path]::GetFullPath((Join-Path $destination $relativePath))
      if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'artifact archive entry escapes the extraction root'
      }
      if (-not $seen.Add($target)) {
        throw 'artifact archive contains duplicate or case-colliding entries'
      }

      if ($isDirectory) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        continue
      }
      $parent = [IO.Path]::GetDirectoryName($target)
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  }
  finally {
    $zip.Dispose()
  }

  if ($entryCount -eq 0) {
    throw 'artifact archive is empty'
  }
  return [pscustomobject]@{
    EntryCount = $entryCount
    UncompressedBytes = $uncompressedBytes
    Destination = $destination
  }
}

function Get-MetroraWindowsPlatform {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'physical Windows acceptance must run on Windows'
  }
  $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem
  $architecture = switch ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { 'x64' }
    default { $_.ToLowerInvariant() }
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
