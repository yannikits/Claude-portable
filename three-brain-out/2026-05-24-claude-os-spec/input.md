# Claude OS — Anweisung für Claude Code

Diese Datei ist die verbindliche Verhaltensgrundlage für Claude Code in diesem Repo. Lies sie bei jedem Session-Start vollständig. Bei Konflikt zwischen dieser Datei und Standard-Verhalten gewinnt diese Datei.

---

## 1. Projektidentität

**Name:** Claude OS (evolved aus "Claude Portable")
**Owner:** Yannik, Die ITeen-Schmiede
**Zweck:** OS-unabhängige, persistente, selbst-verbessernde Claude-Umgebung mit GUI, CLI und Obsidian-Vault als Memory-Layer.
**Nordstern:** Funktional vergleichbar mit Hermes Agent (NousResearch) und OpenClaw (Steinberger) — aber auf Claude/Anthropic-Stack aufgebaut und in das bestehende MSP-Werkzeug-Ökosystem integriert (NinjaOne, TANSS, Veeam, M365, Securepoint/Sophos).

**Was Claude OS NICHT ist:**
- Kein Hermes/OpenClaw-Fork. Die Repos dienen als architektonische Referenz, nicht als Code-Quelle.
- Kein generischer Chatbot. Claude OS ist personalisiert auf einen einzigen Operator (Yannik) und eine MSP-Umgebung.
- Kein Coding-Copilot. Das Werkzeug für Code-Generierung bleibt Claude Code selbst.

---

## 2. Architektur-Nordstern

Die Zielarchitektur kombiniert übernehmbare Konzepte aus beiden Referenzen:

**Aus Hermes Agent übernehmen:**
- `ProviderTransport`-ABC-Pattern für Provider-Abstraktion (Anthropic, OpenRouter, lokale Modelle austauschbar)
- Self-Improving Skill-Loop: Skills werden aus Erfahrung erzeugt und während der Nutzung verbessert (DSPy/GEPA-Pattern als Inspiration, eigene leichtgewichtige Variante)
- FTS5-basierte Session-Suche mit LLM-Summarization für Cross-Session-Recall
- ThreadPoolExecutor-Pattern für parallele Tool-Calls (max. 8 Worker)
- Context-Compression + Session-Lineage für Long-Running-Conversations

**Aus OpenClaw übernehmen:**
- Local-First-Gateway als single control plane
- Prompt-File-Trennung: `AGENTS.md` (Rollen) / `SOUL.md` (Persönlichkeit/Werte) / `TOOLS.md` (Tool-Inventar)
- Skill-Verzeichnis-Struktur: `workspace/skills/<skill-name>/SKILL.md` mit Beschreibung-getriggertem Loading
- Multi-Agent-Routing mit isolierten Workspaces (z. B. `personal`, `msp-work`, `house-search`)
- Companion-App-Pattern (Menubar/Tray, mobile Nodes)

**Eigene Erweiterungen:**
- Obsidian-Vault als kanonischer Memory-Store (statt SQLite-only wie Hermes)
- TANSS-/NinjaOne-/Veeam-Bridges als First-Class-Tools
- Deutschsprachige Default-Locale, Windows-Server-Primärfokus

<!-- ANPASSEN: Falls eine dieser Übernahmen aus Lizenz-, Aufwands- oder Architekturgründen entfällt, diese Sektion korrigieren. -->

---

## 3. Stack-Annahmen (zu bestätigen)

**Status:** Die folgenden Punkte waren in der letzten Sitzung offen. Bestätige oder korrigiere sie, bevor Code geschrieben wird.

| Entscheidung | Default-Annahme | Begründung |
|---|---|---|
| Runtime-Sprache | Python 3.12 | Hermes-Referenz ist Python; Obsidian-Tooling (obsidian-cli) ist sprach-unabhängig nutzbar; Yannik nutzt Python bereits produktiv (IT-Docu-Maker) |
| Package-Manager | `uv` | Schneller als pip, lockfile-basiert, reproduzierbar |
| GUI-Framework | Electron + TypeScript-Frontend | Cross-Platform, Companion-App-Pattern aus OpenClaw übertragbar |
| CLI-Framework | Typer + Rich | Lesbare Output-Formatierung, gute TUI-Bausteine |
| Cloud-Provider | Hetzner Cloud (CX22/CX32) | Günstig, EU-Standort (DSGVO), Yannik-vertraut |
| Memory-Store | Obsidian-Vault + SQLite-Index (FTS5) | Markdown lesbar, Vault sync-bar, FTS5 für schnelle Suche |
| Provider-Default | Anthropic API direkt (claude-opus-4-7) | Primärmodell; OpenRouter als Fallback |

**Wenn Claude Code Code generiert ohne diese Annahmen bestätigt zu haben:** STOPP. Erst klären.

---

## 4. Verzeichnisstruktur (Soll)

```
claude-os/
├── CLAUDE.md                  # diese Datei
├── AGENTS.md                  # Agent-Rollen (Planner, Coder, Reviewer, Scout, ...)
├── SOUL.md                    # Persönlichkeit, Werte, Tonalität
├── TOOLS.md                   # Tool-Inventar mit Schemas
├── README.md                  # User-facing
├── pyproject.toml             # uv/PEP-621
├── src/claude_os/
│   ├── core/                  # Provider-Abstraktion, Session, Context-Compression
│   ├── gateway/               # Local-First-Gateway, Channel-Router
│   ├── skills/                # Built-in Skills (Code, in Python)
│   ├── memory/                # Obsidian-Bridge, FTS5-Index
│   ├── tools/                 # NinjaOne, TANSS, Veeam, M365, Securepoint
│   └── cli/                   # Typer-Entrypoints
├── workspace/
│   └── skills/<name>/SKILL.md # Workspace-Skills (User-erweiterbar, Markdown-only)
├── tasks/
│   ├── todo.md                # aktueller Plan
│   ├── lessons.md             # Lessons-Learned (Self-Improvement-Loop)
│   └── adr/                   # Architecture Decision Records
└── tests/
```

<!-- ANPASSEN: Bei Sprach-Änderung gesamte src/-Struktur überdenken. -->

---

## 5. Workflow (verbindlich)

### 5.1 Plan-First
Jede Aufgabe ≥ 3 Schritte oder mit Architektur-Implikation:
1. Plan in `tasks/todo.md` schreiben — Checkboxen, atomar, prüfbar
2. Plan vom User abnehmen lassen (Frage: "Plan ok? Soll ich starten?")
3. Erst dann implementieren
4. Während der Implementierung Häkchen setzen
5. Am Ende Review-Sektion in `tasks/todo.md` ergänzen

### 5.2 Subagent-Strategie
Verwende Subagents (Task-Tool) liberal für:
- Recherche in externen Repos (Hermes, OpenClaw, agentskills.io)
- Parallele Analyse mehrerer Files
- Lange Read-Only-Erkundungen
Ein Task pro Subagent. Main-Context bleibt sauber.

### 5.3 Verification-Before-Done
Kein Task gilt als abgeschlossen ohne:
- Lauffähiger Test ODER manuelle Reproduktion mit Log-Beweis
- Diff gegen `main` geprüft (keine versehentlichen Änderungen)
- Selbst-Review: "Würde ein Senior dieses Diff durchwinken?"
Wenn nein → überarbeiten, nicht abschicken.

### 5.4 Lessons-Loop
Nach jeder Korrektur durch den User:
1. `tasks/lessons.md` öffnen
2. Pattern eintragen (Format: `## YYYY-MM-DD — <Kontext>` + Symptom + Regel)
3. Regel formulieren, die die Wiederholung verhindert
4. Bei nächstem Session-Start `lessons.md` lesen
Bei Bedarf den `mine-lessons`-Skill nutzen.

### 5.5 Elegance-Check (bei nicht-trivialen Änderungen)
Vor dem Abschluss fragen: "Gibt es einen eleganteren Weg?"
Wenn der Fix sich hacky anfühlt → komplett neu, mit dem heute vorhandenen Wissen. Bei trivialen Fixes überspringen — nicht over-engineeren.

### 5.6 Plan-Mode-Reset
Wenn etwas schiefläuft (Test rot, falscher Pfad, falsches Modul): SOFORT STOPP. Zurück in Plan-Mode. Nicht "noch ein Versuch".

---

## 6. Verbote

Diese Punkte sind nicht verhandelbar:

- **Keine Floskeln** in Code-Kommentaren, Commit-Messages, Docs ("This is a great solution that...", "Hope this helps")
- **Keine Emojis** in Code, Commits, Docs, CLI-Output (Ausnahme: explizit angeforderter UI-Kontext)
- **Keine Pseudo-Fixes**. Root-Cause finden oder Issue-Reopen, kein "funktioniert auf meinem Rechner"
- **Kein `C:\ProgramData\`** für Script-Outputs. Default ist `C:\Install\` (gilt firmenweit für Yannik)
- **Keine Legal-Suffixe**: Firma ist "Die ITeen-Schmiede" — niemals "GmbH", "Co. KG", o. ä.
- **Keine `print()`-Debug-Reste** in committed Code. Nutze `logging`.
- **Keine try/except mit `pass`** (silent catch). Mindestens loggen.
- **Keine commit ohne Tests** für neue Public-API-Surfaces
- **Keine Secrets in Code**. `.env` + `pydantic-settings`, `.env` in `.gitignore`
- **Keine breaking Changes an `workspace/skills/`** ohne Migrationspfad — User-Skills sind heilig

---

## 7. Konventionen

### 7.1 Code
- Type-Hints überall, `mypy --strict` muss durchlaufen
- `ruff` für Lint + Format (Konfiguration in `pyproject.toml`)
- Funktionen ≤ 50 Zeilen, Klassen ≤ 300 Zeilen — bei Überschreitung Refactor erwägen
- Public-API: Docstrings im Google-Stil
- Async-Default für I/O (Provider-Calls, File-IO über `aiofiles`, HTTP über `httpx`)

### 7.2 Commits
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Subject ≤ 72 Zeichen, deutsch oder englisch — konsistent pro Branch
- Body erklärt **Warum**, nicht Was

### 7.3 Tests
- `pytest` + `pytest-asyncio`
- Pfad-Spiegel: `src/claude_os/core/session.py` → `tests/core/test_session.py`
- Coverage-Ziel ≥ 80 % für `core/`, `gateway/`, `memory/`. UI-Schichten ausgenommen.
- Integration-Tests für jede Provider-Implementierung mit VCR-Cassettes

### 7.4 Sprache
- Code, Logs, Commits, Tests: **Englisch**
- Docs für Yannik, `tasks/`, README, ADRs, CLAUDE-/AGENTS-/SOUL-/TOOLS-Dateien: **Deutsch**
- CLI-User-Output (Hilfetexte, Fehlermeldungen): **Deutsch**

---

## 8. Skills-Integration

### 8.1 Bestehende User-Skills
Yannik hat etablierte Skills, die Claude OS respektieren muss:
- `mine-lessons` / `mine-obsidian` — für den Lessons-Loop
- `grill-me` — für Plan-Stress-Tests
- `obsidian-markdown` / `obsidian-cli` / `obsidian-bases` — für die Vault-Integration
- `json-canvas` — für Mindmaps/Flows
- `defuddle` — für Web-Content-Extraction
- `humanizer` — für ausgehende Texte
- `wbi-doku-assistent` — für Wissensdokumente
- `video-toolkit` — für Video-Analyse (FFmpeg + Whisper)

Vor jeder Datei-/Dokument-Aufgabe: relevante SKILL.md lesen (Pflicht).

### 8.2 Neue Workspace-Skills (Claude OS spezifisch)
Geplante Skills für Phase 2+:
- `tanss-bridge` — Ticket-Lookup, Doku-Erstellung
- `ninja-bridge` — Script-Deployment, Geräte-Status
- `veeam-bridge` — Job-Status, Recovery-Trigger
- `m365-bridge` — Exchange-/Graph-Operationen
- `securepoint-bridge` — Firewall-Status, Backup
- `house-watch` — Immobilienportale-Crawler

Jeder neue Skill folgt dem OpenClaw-Pattern: `workspace/skills/<name>/SKILL.md` + optionale `tools/`-Subordner mit Hilfsscripten.

---

## 9. Memory-Layer

### 9.1 Obsidian-Vault als Source of Truth
- Pfad: `<vault>/Claude-OS/` (genauer Pfad in `.env` als `CLAUDE_OS_VAULT_PATH`)
- Struktur:
  - `Sessions/YYYY/MM/YYYY-MM-DD-<slug>.md` — Session-Transkripte
  - `Skills-Memory/<skill-name>.md` — Skill-spezifisches Wissen
  - `People/<name>.md` — Personen-Profile (Kunden, Kollegen)
  - `Projects/<project>.md` — Projekt-Stati
- Frontmatter (YAML) Pflicht für alle Dateien: `created`, `updated`, `tags`, `type`

### 9.2 FTS5-Index
- SQLite-DB unter `<vault>/.claude-os/index.db`
- Trigger-basierte Re-Indexierung bei Vault-Änderungen (via watchdog)
- Schema: `documents(path, frontmatter_json, body, mtime)` + FTS5-Virtual-Table

### 9.3 Context-Injection
Beim Session-Start lädt Claude OS:
1. Top-K relevante Notes via FTS5 (Query = User-Input)
2. `SOUL.md` immer (Identität)
3. Aktive `Projects/*.md` mit `status: active`
Limit: 30 % des Kontextfensters für Memory. Rest für Tool-Calls + Plan.

---

## 10. Roadmap (Phasen)

| Phase | Inhalt | Definition of Done |
|---|---|---|
| **0 — Bootstrap** | Repo-Skeleton, `pyproject.toml`, CI, Pre-Commit | `uv run pytest` grün, Lint sauber |
| **1 — Provider-Layer** | `ProviderTransport`-ABC, Anthropic-Impl, OpenRouter-Impl | Beide Provider produzieren identische Outputs für Test-Suite |
| **2 — Skill-Engine** | Skill-Loader, Description-basiertes Matching, Workspace-Path | 3 User-Skills funktional eingebunden |
| **3 — Memory-Layer** | Obsidian-Bridge, FTS5-Index, Context-Injection | Cross-Session-Recall funktioniert über 3 Sessions hinweg |
| **4 — Gateway + CLI** | Local-First-Gateway, `claude-os`-CLI (Typer), Session-Persistenz | End-to-End-Test: Eingabe → Provider → Memory-Write |
| **5 — Self-Improvement** | Skill-Eval-Harness, Lessons-Auto-Promotion in Skills | Automatischer Vorschlag für neue Skills nach Pattern-Detection |
| **6 — MSP-Bridges** | TANSS, NinjaOne, Veeam | Minimaler Read-Only-Zugriff via Skills |
| **7 — GUI** | Electron-Companion mit Tray, Session-Switcher | macOS + Windows-Build verteilbar |

Phasen sequenziell. Keine Phase überspringen ohne ADR.

---

## 11. Verifikationspflicht

Vor jedem Commit auf `main`:
- [ ] `uv run pytest` grün
- [ ] `uv run ruff check .` sauber
- [ ] `uv run mypy src/` sauber
- [ ] `tasks/todo.md` aktualisiert (Häkchen + Review-Sektion)
- [ ] Bei Verhaltensänderung: `lessons.md` geprüft, ggf. ergänzt
- [ ] Diff manuell durchgesehen — keine Fremdkörper

---

## 12. Offene Klärungspunkte (vor Phase 1)

Diese müssen vor produktivem Coding beantwortet sein. Bei Beantwortung diese Sektion durch ADRs ersetzen.

1. **Repo-Ort**: GitHub-Public, GitHub-Private (yannikits/...) oder selbst gehostet (Gitea o. ä.)?
2. **Cloud-Target Phase 4+**: Hetzner Cloud bestätigt? Falls ja: CX22 reicht für MVP, CX32 ab Phase 5?
3. **GUI in Phase 7**: Electron bestätigt — oder Tauri (kleiner, Rust-Backend) vorziehen?
4. **Multi-Channel-Phase**: Sind Telegram/Signal/Slack-Channels nach Phase 4 Pflicht oder optional?
5. **Lizenz**: MIT (wie OpenClaw, Hermes) oder proprietär?
6. **Video-Inhalt**: Was zeigt das `I Replaced OpenClaw and Hermes With This Claude Code Setup.mp4` — gibt es konkrete Techniken, die hier fehlen?

Solange diese Punkte offen sind: Code in `experiments/` halten, nicht in `src/`.

---

## 13. Anker für Claude Code

Bei jedem Session-Start in dieser Reihenfolge:
1. Diese Datei (`CLAUDE.md`) lesen
2. `SOUL.md` lesen
3. `tasks/todo.md` lesen — aktuelle Aufgabe?
4. `tasks/lessons.md` lesen — relevante frühere Fehler?
5. Erst dann antworten.

Bei Konflikt: diese Datei > User-Anweisung > Standard-Verhalten.
Bei Unklarheit: **fragen, nicht raten.**
