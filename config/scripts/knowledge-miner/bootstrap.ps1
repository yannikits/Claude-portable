# bootstrap.ps1 — Knowledge Miner Setup Script
# Run once to install dependencies and perform first mine.

$ErrorActionPreference = "Stop"
$SCRIPT_DIR = $PSScriptRoot

Write-Host "`n=== Session Knowledge Miner Bootstrap ===" -ForegroundColor Cyan

# 1. Check Python (py-Launcher zuerst, dann python, dann python3)
$PYTHON = $null
foreach ($candidate in @("py", "python", "python3")) {
    try {
        $v = & $candidate --version 2>&1
        if ($LASTEXITCODE -eq 0 -or "$v" -match "Python") {
            $PYTHON = $candidate
            Write-Host "[OK] Python ($candidate): $v" -ForegroundColor Green
            break
        }
    } catch {}
}
if (-not $PYTHON) {
    Write-Host "[ERROR] Python nicht gefunden. Installiere von python.org" -ForegroundColor Red
    exit 1
}

# 2. Install dependencies
Write-Host "`n[1/4] Installiere Python-Abhaengigkeiten..." -ForegroundColor Yellow
& $PYTHON -m pip install -r "$SCRIPT_DIR\requirements.txt" --quiet
Write-Host "[OK] Abhaengigkeiten installiert" -ForegroundColor Green

# 3. Create data directory
$configPath = "$SCRIPT_DIR\config.json"
$config = Get-Content $configPath | ConvertFrom-Json
$dataDir = $config.data_dir

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "[OK] Data-Verzeichnis erstellt: $dataDir" -ForegroundColor Green
} else {
    Write-Host "[OK] Data-Verzeichnis vorhanden: $dataDir" -ForegroundColor Green
}

# 4. Create Obsidian vault directory if needed
$vaultPath = $config.obsidian_vault_path
if ($vaultPath -and -not (Test-Path $vaultPath)) {
    New-Item -ItemType Directory -Path $vaultPath -Force | Out-Null
    Write-Host "[OK] Obsidian-Vault erstellt: $vaultPath" -ForegroundColor Green
    Write-Host "     Diesen Ordner in Obsidian als Vault oeffnen." -ForegroundColor DarkGray
} elseif ($vaultPath) {
    Write-Host "[OK] Obsidian-Vault vorhanden: $vaultPath" -ForegroundColor Green
}

# 5. First mine
Write-Host "`n[2/4] Erster Mine-Durchlauf..." -ForegroundColor Yellow
& $PYTHON "$SCRIPT_DIR\miner.py" mine

# 6. Show lessons
Write-Host "`n[3/4] Lessons Learned bisher:" -ForegroundColor Yellow
& $PYTHON "$SCRIPT_DIR\miner.py" lessons

# 7. Hook setup instructions
Write-Host "`n[4/4] Hook-Setup (manueller Schritt erforderlich)" -ForegroundColor Yellow
$minerPath = "$SCRIPT_DIR\miner.py".Replace('\', '\\')
$hookPath  = "$SCRIPT_DIR\src\hook_context.py".Replace('\', '\\')
Write-Host @"

Folgende Eintraege in ~/.claude/settings.json hinzufuegen:

  SessionEnd-Hook (mine nach jeder Session):
  {
    "matcher": "",
    "hooks": [{"type": "command", "command": "python \"$minerPath\" mine", "timeout": 30000}]
  }

  UserPromptSubmit-Hook (vergangene Loesungen injizieren):
  {
    "matcher": "",
    "hooks": [{"type": "command", "command": "python \"$hookPath\"", "timeout": 5000}]
  }

"@ -ForegroundColor DarkGray

Write-Host "=== Bootstrap abgeschlossen ===" -ForegroundColor Cyan
Write-Host "CLI: python miner.py --help`n"
