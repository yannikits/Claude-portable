# sync.ps1 — Claude Code Konfiguration synchronisieren
#
# Verwendung:
#   .\sync.ps1                     -> Pull + Push (Standard)
#   .\sync.ps1 -Pull               -> Nur Pull (Aenderungen holen)
#   .\sync.ps1 -Push               -> Nur Push (Aenderungen hochladen)
#   .\sync.ps1 -Push -Message "x"  -> Push mit eigenem Commit-Text

param(
    [switch]$Pull,
    [switch]$Push,
    [string]$Message = "sync: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

$ErrorActionPreference = "Stop"
$claudeDir = "$env:USERPROFILE\.claude"

if (-not (Test-Path (Join-Path $claudeDir ".git"))) {
    Write-Error "Kein Git-Repo in $claudeDir. Bitte erst Setup ausfuehren (siehe docs\SYNC-ANLEITUNG.md)."
    exit 1
}

Push-Location $claudeDir

try {
    $doPull = $Pull -or (-not $Push)
    $doPush = $Push -or (-not $Pull)

    # === PULL ===
    if ($doPull) {
        Write-Host "Hole Aenderungen vom Server..."
        git fetch origin
        if ($LASTEXITCODE -ne 0) { Write-Error "Fetch fehlgeschlagen."; exit 1 }

        git pull --rebase origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "KONFLIKT — manuell loesen:" -ForegroundColor Red
            Write-Host "  cd $claudeDir" -ForegroundColor Yellow
            Write-Host "  git status            (zeigt betroffene Dateien)" -ForegroundColor Yellow
            Write-Host "  git rebase --abort    (Abbrechen und zuruecksetzen)" -ForegroundColor Yellow
            exit 1
        }
        Write-Host "Pull: OK" -ForegroundColor Green
    }

    # === PUSH ===
    if ($doPush) {
        $status = git status --porcelain
        if (-not $status) {
            Write-Host "Keine lokalen Aenderungen zu pushen."
        } else {
            Write-Host ""
            Write-Host "Geaenderte Dateien:"
            git status --short
            Write-Host ""

            git add -A
            git commit -m $Message
            if ($LASTEXITCODE -ne 0) { Write-Error "Commit fehlgeschlagen."; exit 1 }

            git push origin main
            if ($LASTEXITCODE -ne 0) { Write-Error "Push fehlgeschlagen."; exit 1 }

            Write-Host "Push: OK  [$Message]" -ForegroundColor Green
        }
    }
} finally {
    Pop-Location
}
