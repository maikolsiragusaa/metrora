param(
  [string]$ArtifactArchive,
  [string]$AcceptanceDirectory,
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-guide-lib.ps1')

function Invoke-MetroraGuideScript([string]$ScriptName, [hashtable]$Arguments) {
  $script = Join-Path $PSScriptRoot $ScriptName
  & $script @Arguments
  if (-not $?) {
    throw "$ScriptName non completato."
  }
}

function Show-MetroraP1Instructions {
  Write-Host ''
  Write-Host 'FASE P1 - PROFILO WINDOWS PRINCIPALE' -ForegroundColor Cyan
  Write-Host 'Metrora verra aperto due volte dal portable verificato.'
  Write-Host 'Durante ogni apertura controlla soltanto:'
  Write-Host '  - identita endpoint e Workspace invariati;'
  Write-Host '  - stato di produzione ed evidence gia accettate ancora disponibili;'
  Write-Host '  - nessuna produzione o batch duplicato;'
  Write-Host '  - conteggi invalidi e quarantena pari a zero.'
  Write-Host 'Non creare, firmare, esportare, eliminare o resettare nulla per far passare il test.'
  Write-Host 'Chiudi Metrora normalmente quando hai finito il controllo.'
}

function Show-MetroraDedicatedInstructions {
  Write-Host ''
  Write-Host 'FASE P2/P3 - UTENTE WINDOWS DEDICATO' -ForegroundColor Cyan
  Write-Host 'Questa fase installa, disinstalla e ricostruisce una fixture storica locale.'
  Write-Host 'Il launcher ha verificato che questo non sia lo stesso profilo usato per P1.'
  Write-Host 'Non interrompere il processo e non aprire manualmente installer o portable.'
}

try {
  $repositoryState = Get-MetroraGuideRepositoryState $RepositoryRoot
  $repository = $repositoryState.Repository
  $expectedCommit = $repositoryState.Head
  $acceptance = Get-MetroraGuideAcceptanceDirectory $expectedCommit $AcceptanceDirectory
  $shortCommit = $expectedCommit.Substring(0, 12)
  $installDirectory = Get-MetroraGuideSiblingDirectory $acceptance "install-$shortCommit"
  $workingDirectory = Get-MetroraGuideSiblingDirectory $acceptance "work-$shortCommit"
  $phase = Get-MetroraPhysicalGuidePhase $acceptance

  Write-Host ''
  Write-Host 'Metrora - accettazione fisica Windows guidata' -ForegroundColor Green
  Write-Host "Commit: $expectedCommit"
  Write-Host "Fase rilevata: $phase"

  if ($phase -eq 'prepare') {
    if (Test-Path -LiteralPath $acceptance) {
      $existing = @(Get-ChildItem -LiteralPath $acceptance -Force -ErrorAction Stop)
      if ($existing.Count -gt 0) {
        throw "La cartella di accettazione esiste ma non contiene un contesto valido: $acceptance"
      }
    }
    $archive = Select-MetroraGuideArtifact $ArtifactArchive
    Write-Host "ZIP selezionato: $([IO.Path]::GetFileName($archive))"
    Confirm-MetroraGuideWord 'Lo ZIP verra copiato, estratto in modo confinato e verificato contro il commit corrente.' 'PREPARA'

    Invoke-MetroraGuideScript 'Prepare-Metrora-Windows-Physical-Acceptance.ps1' @{
      ArtifactArchive = $archive
      ExpectedCommit = $expectedCommit
      OutputDirectory = $acceptance
      RepositoryRoot = $repository
    }
    Write-MetroraGuideLocalState $acceptance $expectedCommit (Get-MetroraCurrentProfileFingerprint) | Out-Null
    $phase = 'p1'
  }

  if ($phase -eq 'p1') {
    $guideState = Read-MetroraGuideLocalState $acceptance $expectedCommit
    $currentFingerprint = Get-MetroraCurrentProfileFingerprint
    if ($currentFingerprint -ne $guideState.primaryProfileFingerprint) {
      throw 'P1 deve essere completata dallo stesso profilo Windows che ha preparato il test.'
    }

    Show-MetroraP1Instructions
    $launchCount = Get-MetroraGuideLaunchCount $acceptance
    while ($launchCount -lt 2) {
      $launchNumber = $launchCount + 1
      Confirm-MetroraGuideWord "Avvio verificato $launchNumber di 2. Controlla lo stato e poi chiudi Metrora normalmente." 'AVVIA'
      Invoke-MetroraGuideScript 'Start-Metrora-Windows-Physical-Existing-Profile.ps1' @{
        AcceptanceDirectory = $acceptance
        RepositoryRoot = $repository
      }
      $launchCount = Get-MetroraGuideLaunchCount $acceptance
    }

    if ((Read-MetroraGuideResultStatus (Join-Path $acceptance 'P1_EXISTING_RESULT.json')) -ne 'pass') {
      Write-Host ''
      Write-Host 'Ora registra soltanto le osservazioni richieste.'
      Write-Host 'Per le domande booleane usa yes oppure no; i conteggi normali devono essere 0.'
      Invoke-MetroraGuideScript 'Record-Metrora-Windows-Physical-Existing-Profile.ps1' @{
        AcceptanceDirectory = $acceptance
        RepositoryRoot = $repository
      }
    }

    if ((Read-MetroraGuideResultStatus (Join-Path $acceptance 'P1_EXISTING_RESULT.json')) -ne 'pass') {
      throw 'P1 non ha prodotto un risultato PASS. La procedura resta fermata.'
    }

    $continuation = Write-MetroraGuideContinuation $acceptance $repository
    Write-Host ''
    Write-Host 'P1 COMPLETATA.' -ForegroundColor Green
    Write-Host 'Adesso accedi a un altro utente Windows locale dedicato al test.'
    Write-Host 'Da quell utente apri con doppio clic:'
    Write-Host "  $continuation" -ForegroundColor Yellow
    Write-Host 'Non continuare P2/P3 sul profilo principale.'
    Open-MetroraGuideDirectory $continuation
    exit 0
  }

  if ($phase -eq 'stopped') {
    throw 'Un risultato precedente e FAIL. Il wrapper non lo trasforma in PASS e non esegue riparazioni distruttive.'
  }

  if ($phase -eq 'dedicated') {
    $guideState = Read-MetroraGuideLocalState $acceptance $expectedCommit
    $currentFingerprint = Get-MetroraCurrentProfileFingerprint
    if ($currentFingerprint -eq $guideState.primaryProfileFingerprint) {
      throw 'Sei ancora nel profilo Windows principale. Accedi a un utente locale separato e rilancia il file di continuazione.'
    }

    Show-MetroraDedicatedInstructions
    Confirm-MetroraGuideWord 'Conferma che questo account Windows e dedicato al test e non contiene lo stato Metrora principale.' 'DEDICATO'

    if ((Read-MetroraGuideResultStatus (Join-Path $acceptance 'P2_CLEAN_RESULT.json')) -ne 'pass') {
      Write-Host 'Avvio P2: installazione pulita, primo avvio e disinstallazione.'
      Invoke-MetroraGuideScript 'Test-Metrora-Windows-Physical-Clean.ps1' @{
        AcceptanceDirectory = $acceptance
        InstallDirectory = $installDirectory
        DedicatedProfileAcknowledged = $true
        RepositoryRoot = $repository
      }
    }

    if ((Read-MetroraGuideResultStatus (Join-Path $acceptance 'P3_MIGRATION_RESULT.json')) -ne 'pass') {
      Write-Host 'Avvio P3: migrazione, reinstallazione, rollback e re-upgrade.'
      Write-Host 'Questa fase puo essere lunga perche ricostruisce localmente la fixture storica.'
      Invoke-MetroraGuideScript 'Test-Metrora-Windows-Physical-Migration.ps1' @{
        AcceptanceDirectory = $acceptance
        WorkingDirectory = $workingDirectory
        DedicatedProfileAcknowledged = $true
        RepositoryRoot = $repository
      }
    }
    $phase = 'finalize'
  }

  if ($phase -eq 'finalize') {
    Invoke-MetroraGuideScript 'Complete-Metrora-Windows-Physical-Acceptance.ps1' @{
      AcceptanceDirectory = $acceptance
      RepositoryRoot = $repository
    }
    $phase = 'complete'
  }

  if ($phase -eq 'complete') {
    $report = Join-Path $acceptance 'METRORA-WINDOWS-PHYSICAL-ACCEPTANCE.json'
    $verification = (& node (Join-Path $repository 'scripts\verify-windows-physical-acceptance-report.mjs') `
      $report `
      --expected-commit $expectedCommit 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw "Il report finale non supera la verifica: $verification"
    }
    Write-Host ''
    Write-Host 'ACCETTAZIONE FISICA COMPLETATA CON PASS.' -ForegroundColor Green
    Write-Host "Report sanitizzato: $report" -ForegroundColor Yellow
    Open-MetroraGuideDirectory $report
    exit 0
  }

  throw "Fase guidata non supportata: $phase"
} catch {
  Write-Host ''
  Write-Host 'LA PROCEDURA SI E FERMATA IN SICUREZZA.' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nessun FAIL viene convertito automaticamente in PASS.'
  exit 1
}
