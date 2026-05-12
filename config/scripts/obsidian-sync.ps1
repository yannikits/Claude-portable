# obsidian-sync.ps1
# Synct Obsidian-Notizen aus einem dedizierten Ordner in Claude MEMORY.md
#
# Vorbereitung in Obsidian:
#   Erstelle Ordner "Claude-Memory" in deinem Vault.
#   Jede Notiz braucht YAML-Frontmatter mit: name, description, type
#   Gueltige Typen: user | feedback | project | reference
#
# Verwendung:
#   .\obsidian-sync.ps1 -VaultPath "C:\Users\reapertakashi\Obsidian\MeinVault"
#   .\obsidian-sync.ps1 -VaultPath "..." -SourceFolder "KlaudeExport" -DryRun

param(
    [Parameter(Mandatory=$true)]
    [string]$VaultPath,
    [string]$SourceFolder = "Claude-Memory",
    [string]$MemoryPath = "$env:USERPROFILE\.claude\projects\C--Users-reapertakashi\memory",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-FmValue([string]$content, [string]$key) {
    if ($content -match "(?m)^$key\s*:\s*(.+)$") { return $Matches[1].Trim() }
    return $null
}

$sourceDir  = Join-Path $VaultPath $SourceFolder
$memoryIndex = Join-Path $MemoryPath "MEMORY.md"
$validTypes = @("user","feedback","project","reference")

# Validate vault
if (-not (Test-Path $VaultPath)) {
    Write-Error "Vault nicht gefunden: $VaultPath"; exit 1
}

# Create source folder in Obsidian if missing + write example
if (-not (Test-Path $sourceDir)) {
    Write-Host "Erstelle Obsidian-Ordner: $sourceDir"
    if (-not $DryRun) { New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null }

    $example = @'
---
name: Beispiel-Eintrag
description: Kurze Beschreibung (erscheint im MEMORY.md Index, max ~100 Zeichen)
type: reference
---

Hier kommt der Inhalt der Notiz.
Gueltige Typen: user, feedback, project, reference

Fuer feedback-Eintraege bitte dieses Format nutzen:
  Regel direkt als ersten Satz.
  **Why:** Warum diese Regel existiert.
  **How to apply:** Wann/wo sie gilt.
'@
    if (-not $DryRun) {
        $example | Set-Content -Path (Join-Path $sourceDir "_beispiel.md") -Encoding UTF8
    }
    Write-Host "Beispiel-Datei erstellt: $sourceDir\_beispiel.md"
}

if (-not (Test-Path $MemoryPath)) {
    New-Item -ItemType Directory -Path $MemoryPath -Force | Out-Null
}

# Process files (skip files starting with _)
$files   = Get-ChildItem -Path $sourceDir -Filter "*.md" -File | Where-Object { $_.Name -notlike "_*" }
$synced  = 0
$skipped = @()

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $name    = Get-FmValue $content "name"
    $type    = Get-FmValue $content "type"

    if (-not $name -or -not $type -or $type -notin $validTypes) {
        Write-Warning "Uebersprungen (fehlendes/ungueltiges Frontmatter): $($file.Name)"
        $skipped += $file.Name
        continue
    }

    $dest = Join-Path $MemoryPath $file.Name
    if (-not $DryRun) { Copy-Item -Path $file.FullName -Destination $dest -Force }
    Write-Host "  Synced: $($file.Name) [$type]"
    $synced++
}

# Rebuild MEMORY.md from all files in memory dir
if (-not $DryRun -and $synced -gt 0) {
    $allFiles = Get-ChildItem -Path $MemoryPath -Filter "*.md" -File |
        Where-Object { $_.Name -ne "MEMORY.md" } |
        Sort-Object Name

    $lines = @("# Memory Index", "")
    foreach ($f in $allFiles) {
        $fc = Get-Content -Path $f.FullName -Raw -Encoding UTF8
        $n  = Get-FmValue $fc "name"
        $d  = Get-FmValue $fc "description"
        if (-not $n) { $n = $f.BaseName }
        if (-not $d) { $d = "Keine Beschreibung" }
        if ($d.Length -gt 100) { $d = $d.Substring(0, 97) + "..." }
        $lines += "- [$n]($($f.Name)) — $d"
    }

    $lines | Set-Content -Path $memoryIndex -Encoding UTF8
    Write-Host ""
    Write-Host "MEMORY.md neu generiert: $($allFiles.Count) Eintraege"
}

Write-Host ""
if ($DryRun) { Write-Host "[DRY RUN — keine Aenderungen vorgenommen]" }
Write-Host "Fertig. Synced: $synced | Uebersprungen: $($skipped.Count)"
if ($skipped.Count -gt 0) { Write-Host "Uebersprungen: $($skipped -join ', ')" }
