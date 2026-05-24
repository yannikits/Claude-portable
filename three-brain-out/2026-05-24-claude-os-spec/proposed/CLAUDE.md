# Claude OS — Verhaltensgrundlage für Claude Code

Diese Datei steuert ausschließlich das **Verhalten** von Claude Code im Repo.
Architektur steht in `ARCHITECTURE.md`, Phasen in `ROADMAP.md`, Schutz in `SECURITY.md`.

## 1. Identität (kurz)

- **Projekt:** Claude OS (Weiterentwicklung von Claude-portable)
- **Owner:** Yannik, Die ITeen-Schmiede
- **Zweck:** persistente, selbst-verbessernde Claude-Umgebung mit GUI/CLI und Obsidian-Vault als Memory-Layer
- **Was es NICHT ist:** kein Hermes/OpenClaw-Fork (nur Referenz), kein generischer Chatbot, kein Coding-Copilot — Code-Generierung bleibt Claude Code selbst

Detail-Identität (Werte, Tonalität, "warum"): `SOUL.md`.

## 2. Anweisungs-Hierarchie (verbindlich)

Bei Konflikt gilt die obenstehende Quelle:

1. **Anthropic-Platform-Policy** (Sicherheit, Misuse-Verhinderung) — nicht überschreibbar
2. **Repo-CLAUDE.md** (diese Datei)
3. **Explizite User-Anweisung im laufenden Turn**
4. **User-globale CLAUDE.md** (`~/.claude/CLAUDE.md`)
5. **Claude-Code-Default-Verhalten**

Bei Unklarheit zwischen 2 und 3: **fragen, nicht raten** — die explizite Anweisung hat aber im Zweifel Vorrang vor dieser Datei, weil sie aktueller ist.

## 3. Plan-First (verbindlich für nicht-triviale Tasks)

**Nicht-trivial** = Architektur-Implikation ODER ≥ 3 Schritte mit Branching/Decision ODER schreibender Zugriff auf MSP-Bridges.

**Trivial** (Plan optional): Typo-Fix, lokales Refactoring innerhalb einer Funktion, Tests für bestehende Logik, Doku-Updates.

Ablauf für nicht-trivial:
1. Plan in `tasks/todo.md` schreiben — atomare Checkboxen, prüfbar
2. Plan abnehmen lassen: "Plan ok?"
3. Implementieren, Häkchen mitziehen
4. Review-Sektion am Ende ergänzen

## 4. Verification-Before-Done

Kein Task ist "fertig" ohne mindestens *eines*:
- Laufender Test (Vitest grün, neue Testdatei spiegelt Code-Pfad)
- Manuelle Reproduktion mit Log-Beweis
- Read-only-Diff gegen Trunk (siehe `ARCHITECTURE.md` für aktuelle Trunk-Branch)

Selbst-Review-Frage: "Würde ein Senior diesen Diff durchwinken?"

## 5. Lessons-Loop

Nach jeder User-Korrektur:
1. `tasks/lessons.md` ergänzen — Format: `## YYYY-MM-DD — <Kontext>` mit Symptom + Regel
2. Regel so formulieren, dass sie die Wiederholung verhindert
3. Bei Session-Start `lessons.md` lesen
4. Optional `mine-lessons`-Skill für Verdichtung nutzen

## 6. Stop-on-Failure (mit Augenmaß)

- Roter Test, falscher Pfad, falsches Modul: **erste** Korrektur ist erlaubt
- Zweiter Fehlversuch am gleichen Punkt: **Plan-Mode-Reset** (zurück zu Sektion 3) — nicht "noch ein Versuch"
- Bei zwei gleichen Fehlern in Folge: `three-brain`-Routing erwägen (Codex-Rescue)

## 7. Verbote (für Code/Commits/Docs)

- **Keine Floskeln** in Code-Kommentaren oder Commit-Messages ("This is a great solution that …")
- **Keine Emojis** in Code, Commits, Docs, CLI-Output (außer explizit angefordert im UI)
- **Keine Pseudo-Fixes** — Root-Cause oder Issue-Reopen
- **Keine `console.log`-Reste** im committed Code — strukturiertes Logging nutzen
- **Keine try/catch mit leerem Catch** — mindestens loggen
- **Keine Secrets in Code** — NAPI-RS Keyring (siehe `SECURITY.md`)
- **Kein `C:\ProgramData\`** für Script-Outputs — Default `C:\Install\`
- **Keine Legal-Suffixe**: Firma ist "Die ITeen-Schmiede" — niemals "GmbH", "Co. KG"
- **Keine breaking Changes an Workspace-Skills** ohne Migrationspfad
- **Keine root-Folder-Files** für Tests/Working-Docs — `tests/`, `docs/`, `tasks/`, `experiments/` nutzen

## 8. Konventionen (Verhalten, nicht Stack)

### 8.1 Commits
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `security:`
- Subject ≤ 72 Zeichen, konsistent pro Branch (deutsch *oder* englisch)
- Body erklärt **Warum**, nicht Was

### 8.2 Sprache
- **Code, Logs, Tests, Variablen:** Englisch
- **Docs für Yannik** (`tasks/`, README, ADRs, dieses File, `SOUL.md`, `AGENTS.md`, `TOOLS.md`): Deutsch
- **CLI-User-Output** (Hilfetexte, Fehlermeldungen): Deutsch

### 8.3 Datei-Größen
- Funktionen ≤ 50 Zeilen — bei Überschreitung Refactor erwägen
- Dateien ≤ 500 Zeilen — sonst aufspalten
- Klassen ≤ 300 Zeilen

## 9. Subagent-Strategie

- Recherche, parallele Analyse, lange Read-only-Erkundungen: in Subagents auslagern
- Ein Task pro Subagent — Main-Context bleibt sauber
- Bei Stuck: `three-brain`-Routing (Codex für Adversarial, Gemini für Long-Context)

## 10. Skills

Verfügbare User-Skills (Pflichtlektüre vor relevanten Tasks — `SKILL.md` lesen):
- `mine-lessons`, `mine-obsidian` — Lessons-Loop
- `grill-me` — Plan-Stresstest
- `obsidian-markdown`, `obsidian-cli`, `obsidian-bases` — Vault
- `three-brain` — Multi-Brain-Routing
- `defuddle`, `humanizer`, `video-toolkit` — Content-Verarbeitung
- `wbi-doku-assistent` — Wissensdokumente

Geplante Claude-OS-Skills siehe `ROADMAP.md` und `TOOLS.md`.

## 11. Session-Start-Ritual

Bei jedem Session-Start in dieser Reihenfolge:
1. `CLAUDE.md` (diese Datei)
2. `SOUL.md` (Identität)
3. `tasks/todo.md` (aktuelle Aufgabe)
4. `tasks/lessons.md` (relevante Fehler)
5. Bei MSP-Bezug: `SECURITY.md`

## 12. Anker-Regeln (TL;DR)

- Plan-First für nicht-trivial
- Verification-Before-Done immer
- Lessons-Loop nach jeder Korrektur
- Stop-on-Failure mit Augenmaß (1. Fehler korrigieren, 2. Fehler → Plan-Reset)
- Bei MSP-Bridges: `SECURITY.md` ist Pflicht-Read
- Bei Konflikt: User-Turn-Anweisung > diese Datei > Default
- Bei Unklarheit: **fragen**
