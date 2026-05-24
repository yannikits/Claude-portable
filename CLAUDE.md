# Claude OS — Verhaltensgrundlage für Claude Code

Diese Datei steuert das **Verhalten** von Claude Code im Repo.
Architektur: `ARCHITECTURE.md` · Phasen: `ROADMAP.md` · Schutz: `SECURITY.md` · GitNexus-Code-Intelligence: `docs/gitnexus.md`.

## 1. Identität (kurz)

- **Projekt:** Claude OS (Weiterentwicklung von Claude-portable)
- **Owner:** Yannik, Die ITeen-Schmiede
- **Zweck:** persistente, selbst-verbessernde Claude-Umgebung mit Tauri-GUI, Node-CLI und Obsidian-Vault als Memory-Layer
- **Was es NICHT ist:** kein Hermes/OpenClaw-Fork (nur Referenz), kein generischer Chatbot, kein Coding-Copilot — Code-Generierung bleibt Claude Code selbst

Detail-Identität (Werte, Tonalität, "warum"): `SOUL.md` (geplant).

## 2. Anweisungs-Hierarchie

Bei Konflikt gilt die obenstehende Quelle:

1. **Anthropic-Platform-Policy** (Sicherheit, Misuse-Verhinderung) — nicht überschreibbar
2. **`SECURITY.md`** (Trust, Audit, MSP-Gates) — verbindlich bei Security-Bezug
3. **Repo-`CLAUDE.md`** (diese Datei)
4. **Explizite User-Anweisung im laufenden Turn**
5. **User-globale `CLAUDE.md`** (`~/.claude/CLAUDE.md`)
6. **Claude-Code-Default-Verhalten**

Bei Unklarheit zwischen 3 und 4: **fragen, nicht raten** — die explizite Anweisung hat im Zweifel Vorrang, weil sie aktueller ist.

## 3. Plan-First (für nicht-triviale Tasks)

**Nicht-trivial** = Architektur-Implikation ODER ≥ 3 Schritte mit Branching ODER schreibender Zugriff auf MSP-Bridges ODER Edit an einem Symbol mit Impact-Level HIGH/CRITICAL (siehe `docs/gitnexus.md`).

**Trivial** (Plan optional): Typo-Fix, lokales Refactoring innerhalb einer Funktion, Tests für bestehende Logik, Doku-Updates.

Ablauf für nicht-trivial:
1. Plan in `tasks/todo.md` — atomare Checkboxen, prüfbar
2. Plan abnehmen lassen: "Plan ok?"
3. Implementieren, Häkchen mitziehen
4. Review-Sektion am Ende ergänzen

## 4. Code-Intelligence-Pflicht (vor Symbol-Edits)

**Vor jedem Edit an Funktion, Klasse, Methode:**
- `gitnexus_impact({target: "symbolName", direction: "upstream"})` laufen
- Blast-Radius an User melden
- Bei HIGH/CRITICAL: warnen und Plan-First aktivieren

**Vor jedem Commit:**
- `gitnexus_detect_changes()` ausführen, prüfen ob nur erwartete Symbole betroffen sind

Details: `docs/gitnexus.md`.

## 5. Verification-Before-Done

Kein Task ist "fertig" ohne mindestens *eines*:
- Laufender Test (Vitest grün, neue Testdatei spiegelt Code-Pfad)
- Manuelle Reproduktion mit Log-Beweis
- Read-only-Diff gegen Trunk

Selbst-Review: "Würde ein Senior diesen Diff durchwinken?"

## 6. Lessons-Loop

Nach jeder User-Korrektur:
1. `tasks/lessons.md` ergänzen — Format: `## YYYY-MM-DD — <Kontext>` mit Symptom + Regel
2. Regel so formulieren, dass sie die Wiederholung verhindert
3. Bei Session-Start `lessons.md` lesen
4. Optional `mine-lessons`-Skill für Verdichtung

## 7. Stop-on-Failure

- Erste Korrektur am gleichen Fehler: **erlaubt**
- Zweiter Fehlversuch am gleichen Punkt: **Plan-Mode-Reset** (zurück zu §3)
- Bei zwei gleichen Fehlern in Folge: `three-brain`-Routing (Codex-Rescue) erwägen

## 8. Verbote

- Keine Floskeln in Code-Kommentaren oder Commit-Messages
- Keine Emojis in Code, Commits, Docs, CLI-Output (außer explizit angefordert)
- Keine Pseudo-Fixes — Root-Cause oder Issue-Reopen
- Keine `console.log`-Reste im committed Code — strukturiertes Logging
- Keine `try/catch` mit leerem catch — mindestens loggen
- Keine Secrets in Code — NAPI-RS Keyring (siehe `SECURITY.md`)
- Kein `C:\ProgramData\` für Script-Outputs — Default `C:\Install\`
- Keine Legal-Suffixe — Firma heißt "Die ITeen-Schmiede"
- Keine breaking Changes an Workspace-Skills ohne Migrationspfad
- Keine root-Folder-Files für Tests/Working-Docs — `tests/`, `docs/`, `tasks/`, `experiments/`

## 9. Konventionen

### 9.1 Commits
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `security:`
- Subject ≤ 72 Zeichen, konsistent pro Branch (deutsch *oder* englisch)
- Body erklärt **Warum**, nicht Was

### 9.2 Sprache
- **Code, Logs, Tests, Variablen:** Englisch
- **Docs für Yannik** (`tasks/`, README, ADRs, dieses File, `SOUL.md`, `AGENTS.md`, `TOOLS.md`): Deutsch
- **CLI-User-Output:** Deutsch

### 9.3 Datei-Größen
- Funktionen ≤ 50 Zeilen, Dateien ≤ 500 Zeilen, Klassen ≤ 300 Zeilen

## 10. Subagent-Strategie

- Recherche, parallele Analyse, lange Read-only-Erkundungen: in Subagents auslagern
- Ein Task pro Subagent — Main-Context bleibt sauber
- Bei Stuck: `three-brain`-Routing (Codex für Adversarial, Gemini für Long-Context)

## 11. Skills

Verfügbare User-Skills (vor relevanten Tasks `SKILL.md` lesen):
- `mine-lessons`, `mine-obsidian` — Lessons-Loop
- `grill-me` — Plan-Stresstest
- `obsidian-markdown`, `obsidian-cli`, `obsidian-bases` — Vault
- `three-brain` — Multi-Brain-Routing
- `defuddle`, `humanizer`, `video-toolkit` — Content-Verarbeitung
- `wbi-doku-assistent` — Wissensdokumente

Geplante Claude-OS-Skills siehe `ROADMAP.md`.

## 12. Session-Start-Ritual

1. `CLAUDE.md` (diese Datei)
2. `SOUL.md` (Identität — wenn vorhanden)
3. `tasks/todo.md` (aktuelle Aufgabe)
4. `tasks/lessons.md` (relevante Fehler)
5. Bei MSP-Bezug: `SECURITY.md`
6. Bei Code-Edit: `docs/gitnexus.md` und `gitnexus_impact` für Ziel-Symbol

## 13. Anker-Regeln (TL;DR)

- Plan-First für nicht-trivial
- `gitnexus_impact` vor Symbol-Edits
- Verification-Before-Done immer
- Lessons-Loop nach jeder Korrektur
- Stop-on-Failure mit Augenmaß
- Bei MSP-Bridges: `SECURITY.md` ist Pflicht
- Bei Konflikt: User-Turn > diese Datei > Default
- Bei Unklarheit: **fragen**
