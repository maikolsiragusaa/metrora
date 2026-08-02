Set-StrictMode -Version Latest

function Get-MetroraGuideRepositoryState([string]$RepositoryRoot) {
  $repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
  $head = (& git -C $repository rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40}$') {
    throw 'Impossibile determinare il commit Git corrente.'
  }
  return [pscustomobject]@{
    Repository = $repository
    Head = $head
  }
}

function Get-MetroraGuideAcceptanceDirectory([string]$ExpectedCommit, [string]$AcceptanceDirectory) {
  if ($AcceptanceDirectory) {
    return [IO.Path]::GetFullPath($AcceptanceDirectory)
  }
  $shortCommit = $ExpectedCommit.Substring(0, 12)
  return [IO.Path]::GetFullPath("C:\Users\Public\MetroraR1BD\acceptance-$shortCommit")
}

function Get-MetroraGuideSiblingDirectory([string]$AcceptanceDirectory, [string]$Name) {
  $parent = Split-Path -Parent ([IO.Path]::GetFullPath($AcceptanceDirectory))
  return Join-Path $parent $Name
}

function Read-MetroraGuideResultStatus([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  return [string]$value.status
}

function Get-MetroraPhysicalGuidePhase([string]$AcceptanceDirectory) {
  $acceptance = [IO.Path]::GetFullPath($AcceptanceDirectory)
  $contextPath = Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json'
  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    return 'prepare'
  }

  $p1 = Read-MetroraGuideResultStatus (Join-Path $acceptance 'P1_EXISTING_RESULT.json')
  $p2 = Read-MetroraGuideResultStatus (Join-Path $acceptance 'P2_CLEAN_RESULT.json')
  $p3 = Read-MetroraGuideResultStatus (Join-Path $acceptance 'P3_MIGRATION_RESULT.json')

  if (@($p1, $p2, $p3) -contains 'fail') { return 'stopped' }
  if ($p1 -ne 'pass') { return 'p1' }
  if ($p2 -ne 'pass' -or $p3 -ne 'pass') { return 'dedicated' }

  $finalPath = Join-Path $acceptance 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json'
  if (Test-Path -LiteralPath $finalPath -PathType Leaf) { return 'complete' }
  return 'finalize'
}

function Get-MetroraCurrentProfileFingerprint {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $identity.User) {
    throw 'Impossibile identificare il profilo Windows corrente.'
  }
  $material = "metrora-r1bd-profile-v1`n$($identity.User.Value)"
  $bytes = [Text.Encoding]::UTF8.GetBytes($material)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Write-MetroraGuideLocalState(
  [string]$AcceptanceDirectory,
  [string]$ExpectedCommit,
  [string]$PrimaryProfileFingerprint
) {
  if ($PrimaryProfileFingerprint -notmatch '^[a-f0-9]{64}$') {
    throw 'Fingerprint del profilo principale non valido.'
  }
  $state = [ordered]@{
    kind = 'metrora.windows-physical-guide-local-state'
    version = 1
    sourceCommit = $ExpectedCommit
    primaryProfileFingerprint = $PrimaryProfileFingerprint
    createdAt = [DateTime]::UtcNow.ToString('o')
  }
  $path = Join-Path $AcceptanceDirectory 'GUIDED_ACCEPTANCE_LOCAL.json'
  $json = "$($state | ConvertTo-Json -Depth 4)`n"
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
  return $path
}

function Read-MetroraGuideLocalState([string]$AcceptanceDirectory, [string]$ExpectedCommit) {
  $path = Join-Path $AcceptanceDirectory 'GUIDED_ACCEPTANCE_LOCAL.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw 'Stato locale della procedura guidata mancante. Riavvia dal profilo principale.'
  }
  $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if (
    $state.kind -ne 'metrora.windows-physical-guide-local-state' -or
    [int]$state.version -ne 1 -or
    $state.sourceCommit -ne $ExpectedCommit -or
    [string]$state.primaryProfileFingerprint -notmatch '^[a-f0-9]{64}$'
  ) {
    throw 'Stato locale della procedura guidata non valido.'
  }
  return $state
}

function Select-MetroraGuideArtifact([string]$ArtifactArchive) {
  if ($ArtifactArchive) {
    return (Resolve-Path -LiteralPath $ArtifactArchive).Path
  }

  $downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
  if (Test-Path -LiteralPath $downloads -PathType Container) {
    $matches = @(Get-ChildItem -LiteralPath $downloads -Filter 'metrora-windows-candidate-*.zip' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
    if ($matches.Count -eq 1) {
      Write-Host "Trovato automaticamente: $($matches[0].Name)"
      return $matches[0].FullName
    }
  }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Seleziona lo ZIP candidato Metrora scaricato da GitHub'
    $dialog.Filter = 'Metrora candidate ZIP|metrora-windows-candidate-*.zip|ZIP files|*.zip'
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    if (Test-Path -LiteralPath $downloads -PathType Container) {
      $dialog.InitialDirectory = $downloads
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      return (Resolve-Path -LiteralPath $dialog.FileName).Path
    }
  } catch {
    Write-Host 'Selettore grafico non disponibile; incolla il percorso dello ZIP.'
  }

  $manual = (Read-Host 'Percorso completo dello ZIP candidato').Trim().Trim('"')
  if (-not $manual) { throw 'Nessun ZIP selezionato.' }
  return (Resolve-Path -LiteralPath $manual).Path
}

function Confirm-MetroraGuideWord([string]$Message, [string]$ExpectedWord) {
  Write-Host ''
  Write-Host $Message
  $answer = (Read-Host "Digita $ExpectedWord per continuare").Trim().ToUpperInvariant()
  if ($answer -ne $ExpectedWord.ToUpperInvariant()) {
    throw 'Procedura annullata senza modifiche distruttive.'
  }
}

function Get-MetroraGuideLaunchCount([string]$AcceptanceDirectory) {
  $markerPath = Join-Path $AcceptanceDirectory 'P1_PORTABLE_LAUNCH.json'
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return 0 }
  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  $count = 0
  if (-not [int]::TryParse([string]$marker.launchCount, [ref]$count)) {
    throw 'Marker di avvio P1 non valido.'
  }
  return $count
}

function Write-MetroraGuideContinuation([string]$AcceptanceDirectory, [string]$RepositoryRoot) {
  $acceptance = [IO.Path]::GetFullPath($AcceptanceDirectory)
  $repository = [IO.Path]::GetFullPath($RepositoryRoot)
  $escape = { param([string]$Value) $Value.Replace("'", "''") }
  $scriptPath = Join-Path $acceptance 'CONTINUA-TEST-METRORA.ps1'
  $cmdPath = Join-Path $acceptance 'CONTINUA-TEST-METRORA.cmd'
  $runner = Join-Path $repository 'scripts\Invoke-Metrora-Windows-Physical-Acceptance.ps1'
  $ps1 = @"
& '$(& $escape $runner)' -AcceptanceDirectory '$(& $escape $acceptance)' -RepositoryRoot '$(& $escape $repository)'
exit `$LASTEXITCODE
"@
  [IO.File]::WriteAllText($scriptPath, $ps1, [Text.UTF8Encoding]::new($false))
  $cmd = "@echo off`r`npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"%~dp0CONTINUA-TEST-METRORA.ps1\"`r`nset EXITCODE=%ERRORLEVEL%`r`necho.`r`npause`r`nexit /b %EXITCODE%`r`n"
  [IO.File]::WriteAllText($cmdPath, $cmd, [Text.ASCIIEncoding]::new())
  return $cmdPath
}

function Open-MetroraGuideDirectory([string]$Path) {
  try { Start-Process explorer.exe -ArgumentList @('/select,', $Path) | Out-Null } catch { }
}
