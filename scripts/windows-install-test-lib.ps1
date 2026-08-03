Set-StrictMode -Version Latest

function Wait-MetroraCondition([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureMessage) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $FailureMessage
}

function Get-MetroraUninstallEntries([string]$ExpectedInstallDirectory, [string]$ExpectedUninstaller) {
  $locations = @(
    @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; HiveName = 'HKCU'; View = [Microsoft.Win32.RegistryView]::Registry64; ViewName = '64' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; HiveName = 'HKCU'; View = [Microsoft.Win32.RegistryView]::Registry32; ViewName = '32' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; HiveName = 'HKLM'; View = [Microsoft.Win32.RegistryView]::Registry64; ViewName = '64' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; HiveName = 'HKLM'; View = [Microsoft.Win32.RegistryView]::Registry32; ViewName = '32' }
  )
  $subkeyPath = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $expectedDirectory = [IO.Path]::GetFullPath($ExpectedInstallDirectory).TrimEnd('\')
  $expectedUninstallerPath = [IO.Path]::GetFullPath($ExpectedUninstaller)
  $matches = @()

  foreach ($location in $locations) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
    try {
      $root = $base.OpenSubKey($subkeyPath)
      if ($null -eq $root) { continue }
      try {
        foreach ($name in $root.GetSubKeyNames()) {
          $key = $root.OpenSubKey($name)
          if ($null -eq $key) { continue }
          try {
            $entry = [pscustomobject]@{
              Hive = $location.HiveName
              View = $location.ViewName
              KeyName = $name
              DisplayName = [string]$key.GetValue('DisplayName', '')
              DisplayVersion = [string]$key.GetValue('DisplayVersion', '')
              Publisher = [string]$key.GetValue('Publisher', '')
              InstallLocation = [string]$key.GetValue('InstallLocation', '')
              UninstallString = [string]$key.GetValue('UninstallString', '')
              QuietUninstallString = [string]$key.GetValue('QuietUninstallString', '')
            }
            $installLocation = $entry.InstallLocation.Trim().Trim('"').TrimEnd('\')
            if (
              $entry.DisplayName -like 'Metrora*' -or
              ($installLocation -and [string]::Equals($installLocation, $expectedDirectory, [StringComparison]::OrdinalIgnoreCase)) -or
              $entry.UninstallString.IndexOf($expectedUninstallerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
              $entry.QuietUninstallString.IndexOf($expectedUninstallerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
            ) {
              $matches += $entry
            }
          } finally {
            $key.Dispose()
          }
        }
      } finally {
        $root.Dispose()
      }
    } finally {
      $base.Dispose()
    }
  }

  return @($matches | Group-Object {
    "$($_.Hive)|$($_.KeyName)|$($_.UninstallString)|$($_.QuietUninstallString)"
  } | ForEach-Object {
    $first = $_.Group[0]
    [pscustomobject]@{
      Hive = $first.Hive
      View = (@($_.Group.View | Sort-Object -Unique) -join ',')
      KeyName = $first.KeyName
      DisplayName = $first.DisplayName
      DisplayVersion = $first.DisplayVersion
      Publisher = $first.Publisher
      InstallLocation = $first.InstallLocation
      UninstallString = $first.UninstallString
      QuietUninstallString = $first.QuietUninstallString
    }
  })
}

function Assert-MetroraUninstallRegistration(
  [string]$InstallDirectory,
  [string]$Uninstaller,
  [string]$ExpectedVersion
) {
  $entries = @(Get-MetroraUninstallEntries $InstallDirectory $Uninstaller)
  $diagnostic = $entries | Select-Object Hive, View, KeyName, DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString
  Write-Host "Metrora uninstall registration candidates: $($diagnostic | ConvertTo-Json -Compress)"
  if ($entries.Count -ne 1) {
    throw "expected one logical Metrora uninstall registration, found $($entries.Count)"
  }
  $entry = $entries[0]
  if ($entry.Hive -ne 'HKCU') { throw "per-user Metrora registration is outside HKCU: $($entry.Hive)/$($entry.View)" }
  if ($entry.DisplayName -ne "Metrora $ExpectedVersion") { throw "unexpected uninstall DisplayName: $($entry.DisplayName)" }
  if ($entry.DisplayVersion -ne $ExpectedVersion) { throw "unexpected uninstall DisplayVersion: $($entry.DisplayVersion)" }
  if ($entry.Publisher -ne 'Vensent') { throw "unexpected uninstall Publisher: $($entry.Publisher)" }
  if ($entry.UninstallString.IndexOf($Uninstaller, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'uninstall registration does not target the expected uninstaller'
  }
  return $entry
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

function New-MetroraStateSentinel([string]$RoamingDirectory, [string]$Name) {
  $stateDirectory = Join-Path $RoamingDirectory 'metrora-desktop\metrora-local-state'
  $path = Join-Path $stateDirectory $Name
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  Set-Content -LiteralPath $path -Value "Metrora user-owned state sentinel: $Name" -Encoding UTF8
  return [pscustomobject]@{
    Path = $path
    Hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  }
}

function Assert-MetroraStateSentinel($Sentinel, [string]$Stage) {
  if (-not (Test-Path -LiteralPath $Sentinel.Path)) { throw "$Stage deleted user-owned local state" }
  if ((Get-FileHash -LiteralPath $Sentinel.Path -Algorithm SHA256).Hash -ne $Sentinel.Hash) {
    throw "$Stage modified user-owned local state"
  }
}

function Stop-MetroraProcess($Process) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  & taskkill.exe /PID $Process.Id /T /F | Out-Null
  Wait-MetroraCondition { $Process.HasExited } 20 'Metrora process did not stop after launch smoke test'
}

function Invoke-MetroraSilentInstall([string]$Installer, [string]$InstallDirectory, [string]$Stage) {
  $process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$InstallDirectory") -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Stage installer exited with code $($process.ExitCode)"
  }
}

function Invoke-MetroraSilentUninstall($Installed, [string]$InstallDirectory, [string]$Stage) {
  $process = Start-Process -FilePath $Installed.Uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Stage uninstaller exited with code $($process.ExitCode)"
  }
  Wait-MetroraCondition { -not (Test-Path -LiteralPath $Installed.Executable) } 60 "$Stage did not remove the application executable"
  Wait-MetroraCondition { @(Get-MetroraUninstallEntries $InstallDirectory $Installed.Uninstaller).Count -eq 0 } 30 "$Stage did not remove its registry entry"
  Wait-MetroraCondition { @(Get-MetroraShortcuts $Installed.Executable).Count -eq 0 } 30 "$Stage did not remove the Metrora shortcut"
}
