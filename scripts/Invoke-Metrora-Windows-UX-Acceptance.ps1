param(
  [string]$ArtifactArchive,
  [string]$AcceptanceDirectory,
  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windows-physical-guide-lib.ps1')
. (Join-Path $PSScriptRoot 'windows-physical-context-lib.ps1')

function Read-MetroraUxBoolean([string]$Question) {
  while ($true) {
    $answer = (Read-Host "$Question (si/no)").Trim().ToLowerInvariant()
    if (@('si', 's', 'yes', 'y') -contains $answer) { return $true }
    if (@('no', 'n') -contains $answer) { return $false }
    Write-Host 'Rispondi si oppure no.' -ForegroundColor Yellow
  }
}

function Get-MetroraUxStatus([bool[]]$Values) {
  if ($Values.Count -gt 0 -and @($Values | Where-Object { -not $_ }).Count -eq 0) {
    return 'pass'
  }
  return 'fail'
}

function Invoke-MetroraUxLaunch([string]$Acceptance, [string]$Repository, [string]$Title, [string[]]$Instructions) {
  Write-Host ''
  Write-Host $Title -ForegroundColor Cyan
  foreach ($instruction in $Instructions) { Write-Host "  - $instruction" }
  Confirm-MetroraGuideWord 'Il portable verificato verra aperto. Completa i controlli, poi chiudi Metrora normalmente.' 'AVVIA'
  & (Join-Path $PSScriptRoot 'Start-Metrora-Windows-Physical-Existing-Profile.ps1') `
    -AcceptanceDirectory $Acceptance `
    -RepositoryRoot $Repository
  if (-not $?) { throw 'Il portable verificato non ha completato l avvio richiesto.' }
}

function New-MetroraUxDraft($Context) {
  $emptyScale = {
    param([int]$Scale)
    [ordered]@{
      scale = $Scale
      homeUnderstandable = $false
      navigationReachable = $false
      denseReportsLegible = $false
      workspaceActionsVisible = $false
      overlaysContained = $false
      narrowWindowOperable = $false
    }
  }
  return [ordered]@{
    kind = 'metrora.windows-ux-acceptance-report'
    version = 1
    generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    source = [ordered]@{
      repository = 'maikolsiragusaa/metrora'
      commit = [string]$Context.source.commit
    }
    candidate = [ordered]@{
      artifactName = [string]$Context.candidate.artifactName
      artifactSha256 = [string]$Context.candidate.artifactSha256
      productVersion = [string]$Context.candidate.productVersion
      releaseManifestSha256 = [string]$Context.candidate.releaseManifestSha256
      formatManifestSha256 = [string]$Context.candidate.formatManifestSha256
    }
    platform = [ordered]@{
      edition = [string]$Context.platform.edition
      version = [string]$Context.platform.version
      build = [string]$Context.platform.build
      architecture = [string]$Context.platform.architecture
    }
    observations = [ordered]@{
      keyboard = [ordered]@{
        status = 'not-run'
        forwardFocusOrder = $false
        reverseFocusOrder = $false
        enterAndSpaceActivation = $false
        escapeDismissal = $false
        shortcutRouting = $false
        focusVisible = $false
      }
      scaling = [ordered]@{
        status = 'not-run'
        scales = @(100, 125, 150, 200 | ForEach-Object { & $emptyScale $_ })
      }
      themes = [ordered]@{
        status = 'not-run'
        lightThemeContrast = $false
        darkThemeContrast = $false
        statusMeaningPreserved = $false
        signalOrangeNotSoleCarrier = $false
      }
      motion = [ordered]@{
        status = 'not-run'
        nonEssentialMotionSuppressed = $false
        loadingUnderstandable = $false
        stateChangesUnderstandable = $false
      }
      narrator = [ordered]@{
        status = 'not-run'
        navigationUnderstood = $false
        denseTablesUnderstood = $false
        compareWinnerUnderstood = $false
        workspaceGuidanceUnderstood = $false
        dialogsUnderstood = $false
      }
    }
    privacy = [ordered]@{
      containsPrivatePaths = $false
      containsUsernames = $false
      containsPromptsOrResponses = $false
      containsWorkspaceIdentifiers = $false
      containsKeysOrEvidence = $false
    }
    limitations = @(
      'unsigned-candidate'
      'no-official-release'
      'no-update-channel'
      'single-windows-host'
      'manual-visual-observation'
    )
  }
}

try {
  $repositoryState = Get-MetroraGuideRepositoryState $RepositoryRoot
  $repository = $repositoryState.Repository
  $expectedCommit = $repositoryState.Head
  $shortCommit = $expectedCommit.Substring(0, 12)
  $acceptance = if ($AcceptanceDirectory) {
    [IO.Path]::GetFullPath($AcceptanceDirectory)
  } else {
    [IO.Path]::GetFullPath("C:\Users\Public\MetroraUX\acceptance-$shortCommit")
  }
  $contextPath = Join-Path $acceptance 'ACCEPTANCE_CONTEXT.json'

  Write-Host ''
  Write-Host 'Metrora - collaudo fisico UX Windows' -ForegroundColor Green
  Write-Host "Commit: $expectedCommit"
  Write-Host 'Il test non modifica dati Metrora e non sostituisce il lifecycle R1.B.D.'

  if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) {
    if (Test-Path -LiteralPath $acceptance) {
      $existing = @(Get-ChildItem -LiteralPath $acceptance -Force -ErrorAction Stop)
      if ($existing.Count -gt 0) {
        throw "La cartella UX esiste ma non contiene un contesto valido: $acceptance"
      }
    }
    $archive = Select-MetroraGuideArtifact $ArtifactArchive
    Confirm-MetroraGuideWord 'Lo ZIP verra copiato, estratto in modo confinato e verificato contro il commit corrente.' 'PREPARA'
    & (Join-Path $PSScriptRoot 'Prepare-Metrora-Windows-Physical-Acceptance.ps1') `
      -ArtifactArchive $archive `
      -ExpectedCommit $expectedCommit `
      -OutputDirectory $acceptance `
      -RepositoryRoot $repository
    if (-not $?) { throw 'Preparazione del candidato UX non completata.' }
  }

  $state = Get-MetroraPhysicalAcceptanceState $acceptance $repository
  $context = $state.Context
  if ([string]$context.source.commit -ne $expectedCommit) {
    throw 'Il candidato UX non appartiene al commit Git corrente.'
  }

  $draftPath = Join-Path $acceptance 'WINDOWS_UX_ACCEPTANCE_REPORT.draft.json'
  $finalPath = Join-Path $acceptance 'METRORA-WINDOWS-UX-ACCEPTANCE.json'
  $report = New-MetroraUxDraft $context
  Write-MetroraUtf8Json $draftPath $report
  & node (Join-Path $repository 'scripts\verify-windows-ux-acceptance-report.mjs') `
    $draftPath `
    --expected-commit $expectedCommit `
    --allow-incomplete
  if ($LASTEXITCODE -ne 0) { throw 'Il report UX iniziale non supera la verifica chiusa.' }

  Invoke-MetroraUxLaunch $acceptance $repository 'FASE 1 - TASTIERA' @(
    'usa Tab e Shift+Tab in tutte le sezioni;'
    'prova Enter e Spazio sui controlli;'
    'apri e chiudi almeno un dialogo con Escape;'
    'prova Ctrl+1 fino a Ctrl+9, Ctrl+, e Ctrl+R;'
    'controlla che il focus sia sempre visibile.'
  )
  $keyboard = [ordered]@{
    status = 'fail'
    forwardFocusOrder = Read-MetroraUxBoolean 'Tab segue un ordine prevedibile e raggiunge i controlli?'
    reverseFocusOrder = Read-MetroraUxBoolean 'Shift+Tab percorre correttamente l ordine inverso?'
    enterAndSpaceActivation = Read-MetroraUxBoolean 'Enter e Spazio attivano i controlli previsti?'
    escapeDismissal = Read-MetroraUxBoolean 'Escape chiude dialoghi e overlay dismissibili?'
    shortcutRouting = Read-MetroraUxBoolean 'Ctrl+1..9, Ctrl+, e Ctrl+R funzionano come dichiarato?'
    focusVisible = Read-MetroraUxBoolean 'Il focus resta sempre chiaramente visibile?'
  }
  $keyboard.status = Get-MetroraUxStatus @(
    $keyboard.forwardFocusOrder,
    $keyboard.reverseFocusOrder,
    $keyboard.enterAndSpaceActivation,
    $keyboard.escapeDismissal,
    $keyboard.shortcutRouting,
    $keyboard.focusVisible
  )
  $report.observations.keyboard = $keyboard

  $scaleResults = @()
  foreach ($scale in @(100, 125, 150, 200)) {
    Write-Host ''
    Write-Host "Imposta ora Windows su scala $scale%." -ForegroundColor Yellow
    Confirm-MetroraGuideWord "Conferma che la scala Windows visualizzata nelle Impostazioni sia $scale%." "SCALA$scale"
    Invoke-MetroraUxLaunch $acceptance $repository "FASE 2 - SCALA $scale%" @(
      'controlla il primo viewport Home;'
      'apri almeno una schermata per gruppo di navigazione;'
      'controlla Sessions, Models, Compare, Spend e Optimize;'
      'controlla Workspace e un dialogo;'
      'riduci la finestra a una larghezza ordinaria stretta.'
    )
    $scaleResult = [ordered]@{
      scale = $scale
      homeUnderstandable = Read-MetroraUxBoolean 'Home resta comprensibile nel primo viewport?'
      navigationReachable = Read-MetroraUxBoolean 'Tutti i gruppi e le destinazioni restano raggiungibili?'
      denseReportsLegible = Read-MetroraUxBoolean 'I report densi conservano identita delle righe e valori?'
      workspaceActionsVisible = Read-MetroraUxBoolean 'Workspace mostra guida, blocchi e azioni sicure?'
      overlaysContained = Read-MetroraUxBoolean 'Dropdown, banner, tooltip e dialoghi restano nel viewport?'
      narrowWindowOperable = Read-MetroraUxBoolean 'La finestra stretta resta utilizzabile senza nascondere destinazioni?'
    }
    $scaleResults += $scaleResult
  }
  $report.observations.scaling = [ordered]@{
    status = Get-MetroraUxStatus @($scaleResults | ForEach-Object {
      $_.homeUnderstandable
      $_.navigationReachable
      $_.denseReportsLegible
      $_.workspaceActionsVisible
      $_.overlaysContained
      $_.narrowWindowOperable
    })
    scales = $scaleResults
  }

  Invoke-MetroraUxLaunch $acceptance $repository 'FASE 3 - TEMI' @(
    'prova tema chiaro e tema scuro;'
    'controlla focus, warning, errori, successi e selezione attiva;'
    'verifica che l arancione non sia l unico indicatore di significato.'
  )
  $themes = [ordered]@{
    status = 'fail'
    lightThemeContrast = Read-MetroraUxBoolean 'Il tema chiaro conserva contrasto e focus leggibili?'
    darkThemeContrast = Read-MetroraUxBoolean 'Il tema scuro conserva contrasto e focus leggibili?'
    statusMeaningPreserved = Read-MetroraUxBoolean 'Successo, warning, errore e stato attivo restano distinguibili?'
    signalOrangeNotSoleCarrier = Read-MetroraUxBoolean 'Il Signal Orange non e l unico portatore di significato?'
  }
  $themes.status = Get-MetroraUxStatus @(
    $themes.lightThemeContrast,
    $themes.darkThemeContrast,
    $themes.statusMeaningPreserved,
    $themes.signalOrangeNotSoleCarrier
  )
  $report.observations.themes = $themes

  Write-Host ''
  Write-Host 'Disattiva ora Effetti animazione nelle impostazioni Accessibilita di Windows.' -ForegroundColor Yellow
  Confirm-MetroraGuideWord 'Conferma che gli effetti animazione di Windows siano disattivati.' 'RIDOTTO'
  Invoke-MetroraUxLaunch $acceptance $repository 'FASE 4 - MOVIMENTO RIDOTTO' @(
    'cambia sezione e provoca un caricamento o refresh;'
    'controlla che le animazioni non essenziali siano soppresse;'
    'verifica che loading e cambi di stato restino comprensibili.'
  )
  $motion = [ordered]@{
    status = 'fail'
    nonEssentialMotionSuppressed = Read-MetroraUxBoolean 'Le animazioni non essenziali risultano soppresse?'
    loadingUnderstandable = Read-MetroraUxBoolean 'Il caricamento resta comprensibile senza animazione?'
    stateChangesUnderstandable = Read-MetroraUxBoolean 'I cambi di stato restano comprensibili senza animazione?'
  }
  $motion.status = Get-MetroraUxStatus @(
    $motion.nonEssentialMotionSuppressed,
    $motion.loadingUnderstandable,
    $motion.stateChangesUnderstandable
  )
  $report.observations.motion = $motion

  Write-Host ''
  Write-Host 'Attiva Narrator con Ctrl+Windows+Invio prima del prossimo avvio.' -ForegroundColor Yellow
  Confirm-MetroraGuideWord 'Conferma che Narrator sia attivo e l audio sia udibile.' 'NARRATOR'
  Invoke-MetroraUxLaunch $acceptance $repository 'FASE 5 - NARRATOR' @(
    'ascolta landmark, gruppi, pagina attiva e shortcut;'
    'attraversa una tabella densa;'
    'controlla Compare, Workspace e un dialogo.'
  )
  $narrator = [ordered]@{
    status = 'fail'
    navigationUnderstood = Read-MetroraUxBoolean 'Navigazione, gruppi, pagina attiva e shortcut sono comprensibili?'
    denseTablesUnderstood = Read-MetroraUxBoolean 'Le tabelle annunciano nome, intestazioni, righe e stati mancanti?'
    compareWinnerUnderstood = Read-MetroraUxBoolean 'Il vincitore Compare e comprensibile senza dipendere dal colore?'
    workspaceGuidanceUnderstood = Read-MetroraUxBoolean 'Stato, blocchi e prossima azione Workspace sono comprensibili?'
    dialogsUnderstood = Read-MetroraUxBoolean 'I dialoghi annunciano nome e controllo di chiusura?'
  }
  $narrator.status = Get-MetroraUxStatus @(
    $narrator.navigationUnderstood,
    $narrator.denseTablesUnderstood,
    $narrator.compareWinnerUnderstood,
    $narrator.workspaceGuidanceUnderstood,
    $narrator.dialogsUnderstood
  )
  $report.observations.narrator = $narrator
  $report.generatedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

  Write-MetroraUtf8Json $finalPath $report
  & node (Join-Path $repository 'scripts\verify-windows-ux-acceptance-report.mjs') `
    $finalPath `
    --expected-commit $expectedCommit
  if ($LASTEXITCODE -ne 0) {
    throw 'Una o piu osservazioni UX non sono PASS. Il report e stato conservato ma il gate resta chiuso.'
  }

  Write-Host ''
  Write-Host 'COLLAUDO UX WINDOWS COMPLETATO CON PASS.' -ForegroundColor Green
  Write-Host "Report sanitizzato: $finalPath" -ForegroundColor Yellow
  Open-MetroraGuideDirectory $finalPath
  exit 0
} catch {
  Write-Host ''
  Write-Host 'IL COLLAUDO UX SI E FERMATO IN SICUREZZA.' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Nessuna osservazione mancante o fallita viene convertita in PASS.'
  exit 1
}
