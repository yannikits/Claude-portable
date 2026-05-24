# Claude OS — Architektur (Ist-Zustand + Ziel)

Dieses Dokument beschreibt die tatsächliche Architektur des Repos und die geplante Erweiterung. **Bei Konflikt mit der ursprünglichen Spec gewinnt dieses Dokument.**

## 1. Stack-Wahrheit (was im Repo steht)

| Schicht | Tatsächlich gewählt | Spec-Drift behoben gegen |
|---|---|---|
| Runtime | **Node.js + TypeScript** | (Spec sagte Python 3.12) |
| Package-Manager | **npm** (package-lock.json) | (Spec sagte uv) |
| GUI-Framework | **Tauri** (Rust + Vite/TS) | (Spec sagte Electron) |
| CLI-Framework | **Commander.js** | (Spec sagte Typer + Rich) |
| Linter/Formatter | **Biome** | (Spec sagte ruff) |
| Test-Runner | **Vitest** | (Spec sagte pytest) |
| Schema-Validation | **TypeBox (@sinclair/typebox)** | nicht in Spec |
| Secrets-Storage | **NAPI-RS Keyring** | (Spec sagte nur .env) |
| Agent-Protocol | **MCP (@modelcontextprotocol/sdk)** | nicht in Spec |
| Inter-Process | **Tauri Sidecar** (Node-Process unter Tauri-Shell) | nicht in Spec |

Diese Entscheidungen sind **getroffen** und im Repo gelandet. Sie werden nicht mehr offen-diskutiert (alte Spec-Section "Stack-Annahmen zu bestätigen" ist obsolet).

Offene Frage in dieser Schicht: **Provider-Abstraktion** (siehe §4).

## 2. Verzeichnisstruktur (Soll, basierend auf Ist)

```
claude-portable/
├── CLAUDE.md                     # Verhalten
├── ARCHITECTURE.md               # diese Datei
├── ROADMAP.md                    # Phasen + DoD
├── SECURITY.md                   # Trust, Audit, MSP-Gates
├── SOUL.md                       # Identität/Werte (geplant)
├── TOOLS.md                      # Tool-Inventar mit Schemas (geplant)
├── AGENTS.md                     # vorhanden — Agent-Rollen
├── README.md                     # User-facing
├── package.json                  # Node-Manifest
├── biome.json                    # Lint/Format
├── vitest.config.ts              # Test-Runner
├── src/
│   ├── core/                     # Provider-Bridge, Session, Compression
│   ├── domains/                  # DDD bounded contexts
│   │   ├── claude-bridge/        # Claude/Anthropic-Integration
│   │   ├── vault-sync/           # Obsidian-Sync (FTS5 geplant)
│   │   └── <msp-domains>/        # TANSS/Ninja/Veeam/M365 — siehe SECURITY.md
│   ├── mcp/                      # MCP-Server + Tool-Registry
│   ├── sidecar/                  # Tauri-Sidecar-Bridge
│   └── cli/                      # Commander-Entrypoints
├── gui/                          # Tauri (src-tauri/ + Vite-Frontend)
├── workspace/
│   └── skills/<name>/SKILL.md    # User-Skills (heilig, kein breaking change)
├── tasks/
│   ├── todo.md
│   ├── lessons.md
│   └── adr/                      # Architecture Decision Records
├── tests/                        # Vitest-Spiegel
└── experiments/                  # Spielwiese — nichts produktiv
```

## 3. Domain Boundaries (DDD bounded contexts)

| Context | Verantwortung | Externe Dependencies |
|---|---|---|
| `claude-bridge` | Provider-Layer für Anthropic API + MCP | `@modelcontextprotocol/sdk` |
| `vault-sync` | Obsidian-Vault als Memory (Markdown + Frontmatter) | filesystem, künftig FTS5 |
| `mcp` | MCP-Server, Tool-Registry, Schema-Bindings | `@sinclair/typebox` |
| `sidecar` | Tauri-Sidecar-IPC, Window-Management | Tauri runtime |
| `cli` | Commander-Subcommands, Output-Formatting | (keine cross-domain) |
| `<msp-*>` | TANSS/Ninja/Veeam/M365/Securepoint-Bridges (Phase 6) | API-Clients + `SECURITY.md`-Gates |

Regel: **Domains rufen einander nur über definierte Public-Interfaces an.** Keine direkten Datenstruktur-Imports zwischen `domains/*`.

## 4. Provider-Layer (offen — ADR erforderlich)

Aktuell: nur Anthropic-Bridge in `src/domains/claude-bridge/`.

Geplant (ADR vor Implementierung): **`ProviderTransport`-Interface** für künftige Provider (OpenRouter, lokale Modelle). Aber:

- **Modell-IDs nicht hardcoden** — der Foundation-Doc darf keine konkrete Modell-Version nageln (Lehre aus der ersten Spec). Modell-Auswahl per Config (`.env` + Runtime-Override).
- Provider-Equivalence-Tests: **Contract-Shape + Tool-Call-Semantik**, nicht "identische Outputs" (sinnloses Ziel bei LLMs).

## 5. Memory-Layer

### 5.1 Source of Truth
Obsidian-Vault unter `<vault>/Claude-OS/`, Pfad via `.env` (`CLAUDE_OS_VAULT_PATH`).

Struktur:
```
Sessions/YYYY/MM/YYYY-MM-DD-<slug>.md
Skills-Memory/<skill-name>.md
People/<name>.md
Projects/<project>.md
```

Frontmatter (Pflicht): `created`, `updated`, `tags`, `type`, **`classification`** (siehe `SECURITY.md` §2 für Klassen).

### 5.2 FTS5-Index (geplant)
- SQLite-DB unter `<vault>/.claude-os/index.db`
- Re-Indexierung trigger-basiert (watchdog auf Vault-Mutations)
- Schema: `documents(path, frontmatter_json, body, mtime, classification)` + FTS5-Virtual-Table
- **Conflict-Resolution:** Vault ist Source-of-Truth; bei Index-Inkonsistenz wird neu indexiert, nie der Vault korrigiert.
- **Re-Index-Failure:** Search degradiert auf Linear-Scan, nicht auf Crash.

### 5.3 Context-Injection
- Top-K Retrieval-Policy (nicht starre 30 %): Ranking aus Recency + Source-Type + Classification-Trust + FTS-Match
- `SOUL.md` immer geladen
- Aktive `Projects/*.md` mit `status: active`
- **Sensitive Klassifizierungen** (siehe `SECURITY.md`) niemals automatisch — nur auf explizite User-Anforderung

## 6. Concurrency-Modell

- **I/O-Default: async/await** (Node native, `fs/promises`, `fetch`)
- **Parallel-Fan-out: `Promise.all` mit semaphore-begrenztem Pool** (max 8 — analog Hermes-ThreadPoolExecutor, aber single-threaded Node-style)
- **Keine Mischung** mit Worker-Threads, außer explizit für CPU-bound Tasks (FTS-Index-Build)

## 7. Trust-Model (Vor-Anker, Details in SECURITY.md)

Trust-Boundaries (von vertraut nach un-vertraut):
1. **Local User (Yannik)** — full trust
2. **CLAUDE.md / SOUL.md / SECURITY.md** — repo-verifizierte Policies
3. **Lokaler Vault** — vertraut, aber `classification`-Frontmatter respektieren
4. **Workspace-Skills** — vertraut nach Erstellung, vor Erstellung gequarantänisiert
5. **MCP-Tools (built-in)** — vertraut nach Schema-Validation
6. **MSP-API-Responses** — un-vertraut, immer validieren
7. **Web-Content (defuddle etc.)** — un-vertraut
8. **Self-improving Skill-Drafts** — un-vertraut, Sandbox + Review (siehe `SECURITY.md`)

## 8. Failure-Mode-Design

| Failure | Verhalten |
|---|---|
| Vault unavailable | Read-only-Modus, klare Fehlermeldung, kein Crash |
| FTS-Index korrupt | Auto-Rebuild im Background, Linear-Scan als Fallback |
| Provider-API down | Fallback-Provider versuchen (wenn konfiguriert), sonst klar fehlschlagen |
| MCP-Tool wirft | Logging mit Correlation-ID, kein silent catch |
| Sidecar-Process crasht | Auto-Restart mit Exponential-Backoff, max 3 Versuche, dann GUI-Notification |
| Memory-Injection liefert Konflikt | User-Notify "konflikt erkannt", keine Auto-Resolution |

## 9. Versioning & Migration

- **Vault-Frontmatter-Schema:** `schema_version: 1` (geplant, vor Phase 3)
- **SQLite-Index:** Drizzle-Migration oder eigene Migration-Files in `src/domains/vault-sync/migrations/`
- **Skill-Format:** `version` in SKILL.md-Frontmatter, breaking-changes erfordern Migrations-Doku
- **MCP-Tool-Schemas:** semver in `TOOLS.md`

## 10. Packaging & Distribution

- **Tauri-Bundle:** MSI für Windows (Primary), DMG für macOS (Secondary)
- **Sidecar:** als Tauri-managed externalBin
- **Update-Strategie:** Tauri-Updater + GitHub-Release-Source (genauer Endpoint via ADR)
- **Code-Signing:** offen — ADR erforderlich vor v1.0
- **Config-Locations:**
  - User-Config: `%APPDATA%\claude-os\config.json` (Win) / `~/Library/Application Support/claude-os/` (mac)
  - Project-Config: `<repo>/.claude-os/`
  - Secrets: NAPI-RS Keyring (siehe `SECURITY.md`)

## 11. Offene ADRs (vor Phase 1 Pflicht)

1. **ADR-001** — Provider-Abstraction-Pattern (Interface + ein erster Provider final)
2. **ADR-002** — Memory-Indexierung (FTS5 vs. Alternativen wie LiteLLM-Memory)
3. **ADR-003** — Skill-Auto-Promotion-Modell (siehe `SECURITY.md` §5)
4. **ADR-004** — MSP-Bridge Permission-Modell (read-only/write/destructive Scopes)
5. **ADR-005** — Update-Mechanismus Tauri-Bundle
6. **ADR-006** — Lizenz (MIT vs. proprietär)

Solange diese offen sind: Code zu den jeweiligen Themen bleibt in `experiments/`.
