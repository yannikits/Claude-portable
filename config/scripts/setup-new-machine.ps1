# setup-new-machine.ps1 — Claude Code Konfiguration auf neuem PC einrichten
#
# Verwendung (auf dem Arbeits-PC ausfuehren):
#   powershell -File setup-new-machine.ps1 -RepoUrl "https://github.com/DEIN-USER/claude-config.git"

param(
    [Parameter(Mandatory=$true)]
    [string]$RepoUrl
)

$ErrorActionPreference = "Stop"
$claudeDir = "$env:USERPROFILE\.claude"

Write-Host ""
Write-Host "=== Claude Code Setup ===" -ForegroundColor Cyan
Write-Host ""

# --- Voraussetzungen pruefen ---
# Pro Werkzeug eine Liste moeglicher Kommando-Namen (Windows kennt Python oft nur als "py").
$prereqs = [ordered]@{
    "Git"    = @{ Cmds = @("git");                       Hint = "Git        https://git-scm.com/download/win" }
    "Node"   = @{ Cmds = @("node");                      Hint = "Node.js    https://nodejs.org/ (LTS)" }
    "Python" = @{ Cmds = @("py", "python", "python3");   Hint = "Python     https://www.python.org/downloads/" }
}

$allOk = $true
Write-Host "Voraussetzungen:"
foreach ($name in $prereqs.Keys) {
    $entry = $prereqs[$name]
    $found = $null
    foreach ($cmd in $entry.Cmds) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            $found = $cmd
            break
        }
    }
    if ($found) {
        $ver = (& $found --version 2>&1 | Select-Object -First 1)
        Write-Host "  [OK] $name ($found)  ($ver)" -ForegroundColor Green
    } else {
        Write-Host "  [FEHLT] $($entry.Hint)" -ForegroundColor Red
        $allOk = $false
    }
}

if (Get-Command "claude" -ErrorAction SilentlyContinue) {
    $ver = (claude --version 2>&1 | Select-Object -First 1)
    Write-Host "  [OK] claude  ($ver)" -ForegroundColor Green
} else {
    Write-Host "  [HINWEIS] claude CLI nicht gefunden" -ForegroundColor Yellow
    Write-Host "            Nach dem Setup installieren: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
}

if (-not $allOk) {
    Write-Host ""
    Write-Error "Fehlende Tools installieren, dann erneut ausfuehren."
    exit 1
}

Write-Host ""

# --- Git-Repo einrichten ---
$gitDir = Join-Path $claudeDir ".git"

if (Test-Path $gitDir) {
    Write-Host "Git-Repo bereits vorhanden — aktualisiere..."
    Push-Location $claudeDir
    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Pull fehlgeschlagen. Bitte pruefen: cd $claudeDir && git status"
        exit 1
    }
    Pop-Location
    Write-Host "Aktualisiert." -ForegroundColor Green
} else {
    Write-Host "Klone Konfiguration nach $claudeDir ..."
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    Push-Location $claudeDir
    git init
    git remote add origin $RepoUrl
    git fetch origin
    git checkout -b main --track origin/main
    Pop-Location
    Write-Host "Geklont." -ForegroundColor Green
}

# --- settings.local.json anlegen falls fehlend ---
$localSettings = Join-Path $claudeDir "settings.local.json"
$template      = Join-Path $claudeDir "settings.local.json.template"

if (-not (Test-Path $localSettings)) {
    if (Test-Path $template) {
        Copy-Item $template $localSettings
        Write-Host ""
        Write-Host "AKTION ERFORDERLICH:" -ForegroundColor Yellow
        Write-Host "  API-Keys eintragen in:" -ForegroundColor Yellow
        Write-Host "  $localSettings" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  ANTHROPIC_API_KEY  -> https://console.anthropic.com/settings/keys" -ForegroundColor Yellow
        Write-Host "  GITHUB_TOKEN       -> https://github.com/settings/tokens  (Scope: repo)" -ForegroundColor Yellow
    }
}

# --- Memory-Pfad fuer anderen Username anlegen ---
$memSrc  = Join-Path $claudeDir "projects\C--Users-reapertakashi\memory"
$memDest = Join-Path $claudeDir "projects\C--Users-$env:USERNAME\memory"

if ($env:USERNAME -ne "reapertakashi" -and (Test-Path $memSrc) -and -not (Test-Path $memDest)) {
    New-Item -ItemType Directory -Path $memDest -Force | Out-Null
    Copy-Item "$memSrc\*" $memDest -Force
    Write-Host ""
    Write-Host "Memory-Dateien nach $memDest kopiert." -ForegroundColor Green
}

# --- Abschluss ---
Write-Host ""
Write-Host "=== Setup abgeschlossen ===" -ForegroundColor Green
Write-Host ""
Write-Host "Naechste Schritte:"
Write-Host "  1. API-Keys in settings.local.json eintragen (siehe oben)"
Write-Host "  2. claude starten"
Write-Host "  3. Plugins laden sich beim ersten Aufruf automatisch via npx"
Write-Host ""
Write-Host "Taeglich syncen:"
Write-Host "  powershell -File `"$claudeDir\scripts\sync.ps1`""
