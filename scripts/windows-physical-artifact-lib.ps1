Set-StrictMode -Version Latest

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
