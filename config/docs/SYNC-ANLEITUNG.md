# Claude Code Sync — Anleitung

Konfiguration, Memory und Einstellungen zwischen mehreren PCs synchron halten.

---

## Was wird synchronisiert

| Datei/Ordner | Inhalt |
|---|---|
| `CLAUDE.md` | Globale Claude-Instruktionen |
| `settings.json` | MCP-Server, Permissions, Hooks |
| `templates/` | Projekt-Templates |
| `scripts/` | Sync- und Hilfs-Skripte |
| `hooks/` | Custom Hook-Skripte |
| `helpers/` | Hilfs-Skripte |
| `commands/` | Custom Slash-Commands |
| `plugins/*.json` | Installierte Plugin-Liste |
| `projects/*/memory/*.md` | Persistentes Memory |

**Nicht synchronisiert:** `plugins/cache/` (1.1GB Binaries), `agents/`, `skills/`, Session-Daten, Logs, Credentials

---

## Einmalige Einrichtung — Home-PC

### Schritt 1: Privates GitHub-Repo erstellen

Auf https://github.com/new:
- Name: `claude-config`
- Sichtbarkeit: **Private** (wichtig — enthalt settings.json mit MCP-Konfiguration)
- Kein README, kein .gitignore hinzufuegen

### Schritt 2: settings.json auf Secrets pruefen

Oeffne `%USERPROFILE%\.claude\settings.json` und pruefe den `env`-Block.
Falls dort API-Keys stehen: Keys in `settings.local.json` verschieben (wird nicht committed).

```json
// settings.local.json — NUR lokal, nicht im Git
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "GITHUB_TOKEN": "ghp_..."
  }
}
```

### Schritt 3: Git initialisieren und ersten Push

PowerShell oeffnen (kein Admin noetig):

```powershell
cd "$env:USERPROFILE\.claude"

git init
git remote add origin https://github.com/yannikits/claude-config.git
git add -A
git status        # Pruefen: Keine Secrets sichtbar?
git commit -m "initial: claude config"
git branch -M main
git push -u origin main
```

---

## Taeglich syncen

### Standard: Pull + Push

```powershell
powershell -File "$env:USERPROFILE\.claude\scripts\sync.ps1"
```

Oder direkt aus dem scripts-Ordner:

```powershell
cd "$env:USERPROFILE\.claude\scripts"
.\sync.ps1           # Pull + Push
.\sync.ps1 -Pull     # Nur holen
.\sync.ps1 -Push     # Nur hochladen
```

### Empfohlener Workflow

```
Morgens am Arbeits-PC:   .\sync.ps1 -Pull
Abends am Arbeits-PC:    .\sync.ps1 -Push
Morgens am Home-PC:      .\sync.ps1 -Pull
```

---

## Arbeits-PC einrichten (einmalig)

### Schritt 1: Voraussetzungen installieren

- Git: https://git-scm.com/download/win
- Node.js (LTS): https://nodejs.org/
- Python: https://www.python.org/downloads/
- Claude Code: `npm install -g @anthropic-ai/claude-code`

### Schritt 2: Setup-Skript uebertragen und ausfuehren

Das Skript `setup-new-machine.ps1` auf den Arbeits-PC kopieren (USB, E-Mail, etc.) und ausfuehren:

```powershell
powershell -File setup-new-machine.ps1 -RepoUrl "https://github.com/yannikits/claude-config.git"
```

Das Skript erledigt automatisch:
1. Voraussetzungen pruefen
2. Konfiguration von GitHub klonen nach `~/.claude/`
3. `settings.local.json` aus Template anlegen
4. Memory-Dateien in den richtigen Pfad kopieren (auch bei anderem Windows-Username)

### Schritt 3: API-Keys eintragen

```powershell
notepad "$env:USERPROFILE\.claude\settings.local.json"
```

Platzhalter ersetzen:
- `ANTHROPIC_API_KEY` => https://console.anthropic.com/settings/keys
- `GITHUB_TOKEN` => https://github.com/settings/tokens (Scope: `repo`)

### Schritt 4: Claude Code starten

```powershell
claude
```

Plugins und MCPs laden sich beim ersten Aufruf automatisch via npx nach.

---

## Obsidian-Sync (optional)

Notizen aus Obsidian in Claude Memory uebertragen:

```powershell
.\scripts\obsidian-sync.ps1 -VaultPath "C:\Users\reapertakashi\Obsidian\MeinVault"
.\scripts\sync.ps1   # Danach auf Arbeits-PC synchronisieren
```

---

## Troubleshooting

| Problem | Loesung |
|---|---|
| `git push` schlaegt fehl — kein Remote | `git remote add origin https://github.com/yannikits/claude-config.git` |
| Konflikt beim Pull | `git status` → Datei bearbeiten → `git rebase --continue` |
| Plugin laedt nicht | Plugins werden via npx automatisch beim ersten Aufruf geladen |
| MCP-Server fehlt auf Arbeits-PC | Steht in `settings.json` — wird nach Pull automatisch erkannt |
| Memory fehlt auf Arbeits-PC | `setup-new-machine.ps1` kopiert Memory automatisch, auch bei anderem Username |
