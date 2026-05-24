# Claude OS — Architektur

Bei Konflikt mit historischen Spec-Dokumenten gewinnt dieses Dokument. ADR-Entscheidungen liegen in `tasks/adr/`.

## 1. Stack (entschieden)

| Schicht | Wahl | ADR |
|---|---|---|
| Runtime | Node.js + TypeScript | — (im Repo etabliert) |
| Package-Manager | npm (package-lock.json) | — |
| GUI-Framework | Tauri (Rust + Vite/TS) | — |
| CLI-Framework | Commander.js | — |
| Linter/Formatter | Biome | — |
| Test-Runner | Vitest | — |
| Schema-Validation | TypeBox (`@sinclair/typebox`) | — |
| Secrets-Storage | NAPI-RS Keyring | siehe `SECURITY.md` §3 |
| Agent-Protocol | MCP (`@modelcontextprotocol/sdk`) | — |
| Inter-Process | Tauri Sidecar (Node-Process unter Tauri-Shell) | — |
| Provider-Abstraktion | Interface designt, nur Anthropic implementiert | ADR-001 |
| Memory-Index | FTS5 in SQLite + watchdog | ADR-002 |
| Lizenz | MIT (für Public-Core) | ADR-006 |
| Repo-Strategie | Hybrid Public-Core + Private MSP-Bridges + Private House-Watch | ADR-007 |
| Vault-Strategie | Multi-Workspace mit `personal/` als Default | ADR-008 |

## 2. Repo-Struktur

```
Claude-portable/                      # Public, MIT, dieses Repo
├── CLAUDE.md                         # Verhalten
├── ARCHITECTURE.md                   # diese Datei
├── ROADMAP.md                        # Phasen + DoD
├── SECURITY.md                       # Trust, Audit, MSP-Gates
├── SOUL.md                           # Identität (geplant)
├── TOOLS.md                          # Tool-Inventar (geplant)
├── AGENTS.md                         # Agent-Rollen
├── README.md                         # User-facing
├── docs/
│   ├── gitnexus.md                   # Code-Intelligence-Workflow
│   └── ...                           # weitere Docs
├── src/
│   ├── core/                         # Provider-Bridge, Session, Compression
│   ├── domains/                      # DDD bounded contexts
│   │   ├── claude-bridge/            # Anthropic-Integration
│   │   └── vault-sync/               # Obsidian-Sync + FTS5
│   ├── mcp/                          # MCP-Server + Tool-Registry
│   ├── sidecar/                      # Tauri-Sidecar-Bridge
│   └── cli/                          # Commander-Entrypoints
├── gui/                              # Tauri (src-tauri/ + Vite-Frontend)
├── workspace/
│   └── skills/<name>/SKILL.md        # User-Skills (heilig)
├── tasks/
│   ├── todo.md
│   ├── lessons.md
│   └── adr/                          # Architecture Decision Records
└── tests/                            # Vitest-Spiegel

claude-os-msp/                        # Private repo (separat)
└── src/domains/
    ├── tanss-bridge/
    ├── ninja-bridge/
    ├── veeam-bridge/
    ├── m365-bridge/
    └── securepoint-bridge/

house-watch/                          # Private repo (separat)
└── src/                              # Immobilien-Crawler
```

MSP-Bridges und House-Watch konsumieren `Claude-portable` als npm-Dependency oder Git-Submodule. Niemals umgekehrt.

## 3. Domain Boundaries (DDD)

| Context | Repo | Verantwortung | Externe Dependencies |
|---|---|---|---|
| `claude-bridge` | public | Anthropic + MCP | `@anthropic-ai/sdk`, MCP-SDK |
| `vault-sync` | public | Obsidian-Vault als Memory | filesystem, sql.js |
| `mcp` | public | MCP-Server, Tool-Registry | `@sinclair/typebox` |
| `sidecar` | public | Tauri-Sidecar-IPC | Tauri runtime |
| `cli` | public | Commander-Subcommands | (keine cross-domain) |
| `tanss-bridge` etc. | **private MSP-Repo** | API-Clients mit Approval-Gates | `SECURITY.md`-Compliance |
| `house-watch` | **private House-Repo** | Immobilien-Crawler | defuddle, eigene Parser |

**Regel:** Domains rufen einander nur über definierte Public-Interfaces an. Keine direkten Datenstruktur-Imports zwischen `domains/*`.

## 4. Provider-Layer

`ProviderTransport`-Interface in `src/domains/claude-bridge/transport.ts` (Soll).

Einzige Implementierung: `AnthropicTransport`. **Modell-ID via `.env`** (`CLAUDE_OS_MODEL`), niemals im Code hardgenagelt.

Provider-Equivalence wird über **Contract-Tests** verifiziert (Schema, Tool-Call-Semantik, Retry-Verhalten), niemals über "identische Outputs".

Trigger für weitere Provider (OpenRouter, lokales Modell): konkrete Kostenobergrenze oder Rate-Limit-Bottleneck erreicht (siehe ADR-001).

## 5. Memory-Layer

### 5.1 Vault als Source of Truth (Multi-Workspace)

```
<vault-root>/Claude-OS/
├── workspaces/
│   ├── personal/                     # Default — Yannik privat
│   │   ├── Sessions/YYYY/MM/
│   │   ├── Skills-Memory/
│   │   ├── People/
│   │   └── Projects/
│   ├── msp-internal/                 # Allgemeine MSP-Doku (nicht customer-spezifisch)
│   │   └── ...
│   └── msp-customers/
│       └── <customer-id>/            # Tenant-isoliert pro Customer
│           └── ...
└── .claude-os/
    └── index.db                      # FTS5 mit workspace-column
```

Vault-Pfad in `.env` als `CLAUDE_OS_VAULT_PATH`. Aktiver Workspace als Session-State, expliziter Wechsel per CLI/GUI.

### 5.2 Frontmatter (Pflicht)

```yaml
---
created: 2026-05-24T03:30:00Z
updated: 2026-05-24T03:30:00Z
tags: [...]
type: session|skill-memory|person|project
classification: personal|operational|customer-confidential|secret|ephemeral
workspace: personal             # oder msp-internal | msp-customers/<id>
schema_version: 1
---
```

Fehlende `classification` → fail-safe `customer-confidential` (siehe `SECURITY.md` §2).

### 5.3 FTS5-Index (ADR-002)

- SQLite-DB unter `<vault>/.claude-os/index.db`
- Re-Indexierung trigger-basiert (watchdog auf Vault-Mutations)
- Schema: `documents(path, workspace, frontmatter_json, body, mtime, classification)` + FTS5-Virtual-Table
- **Conflict-Resolution:** Vault ist Source-of-Truth; bei Index-Inkonsistenz wird neu indexiert, nie der Vault korrigiert
- **Failure-Mode:** Linear-Scan-Fallback, kein Crash

### 5.4 Context-Injection

- Top-K Retrieval-Policy (nicht starre 30 %): Ranking aus Recency + Source-Type + Classification-Trust + FTS-Match
- **Workspace-Scope:** nur aktiver Workspace, niemals cross-workspace by default
- `SOUL.md` immer geladen
- Aktive `Projects/*.md` mit `status: active`
- `customer-confidential` niemals automatisch — nur auf explizite Anforderung

## 6. Concurrency-Modell

- **I/O-Default:** async/await (`fs/promises`, `fetch`)
- **Parallel-Fan-out:** `Promise.all` mit semaphore-begrenztem Pool (max 8)
- **Worker-Threads** nur für CPU-bound Tasks (FTS-Index-Build), explizit dokumentiert

## 7. Trust-Boundaries

Von vertraut nach un-vertraut:
1. Local User (Yannik) — full trust
2. `CLAUDE.md` / `SOUL.md` / `SECURITY.md` — repo-verifizierte Policies
3. Lokaler Vault — vertraut, aber `classification`-Frontmatter respektieren
4. Workspace-Skills — vertraut nach Erstellung; vor Erstellung quarantänisiert
5. MCP-Tools (built-in) — vertraut nach Schema-Validation
6. MSP-API-Responses — un-vertraut, immer validieren
7. Web-Content (defuddle etc.) — un-vertraut
8. Self-improving Skill-Drafts — un-vertraut, Sandbox + Review (siehe ADR-003)

## 8. Failure-Mode-Design

| Failure | Verhalten |
|---|---|
| Vault unavailable | Read-only-Modus, klare Fehlermeldung, kein Crash |
| FTS-Index korrupt | Auto-Rebuild im Background, Linear-Scan als Fallback |
| Provider-API down | klar fehlschlagen mit Hint auf `.env`-Modell-Switch; kein silent fallback |
| MCP-Tool wirft | Logging mit Correlation-ID, kein silent catch |
| Sidecar-Process crasht | Auto-Restart mit Exponential-Backoff, max 3 Versuche, dann GUI-Notification |
| Memory-Konflikt | User-Notify "Konflikt erkannt", keine Auto-Resolution |

## 9. Versioning & Migration

- **Vault-Frontmatter-Schema:** `schema_version` als Integer, Migrations in `src/domains/vault-sync/migrations/`
- **SQLite-Index:** eigene Migration-Files, never destructive
- **Skill-Format:** `version` in SKILL.md-Frontmatter, breaking-changes mit Migrations-Doku
- **MCP-Tool-Schemas:** semver in `TOOLS.md`

## 10. Packaging & Distribution

- **Tauri-Bundle:** MSI für Windows (Primary), DMG für macOS (Secondary), Linux best-effort
- **Sidecar:** als Tauri-managed externalBin
- **Update-Strategie:** Tauri-Updater + GitHub-Release-Source (ADR-005 vor v1.0)
- **Code-Signing:** offen — ADR vor v1.0
- **Config-Locations:**
  - User-Config: `%APPDATA%\claude-os\config.json` (Win) / `~/Library/Application Support/claude-os/` (mac)
  - Project-Config: `<repo>/.claude-os/`
  - Secrets: NAPI-RS Keyring (siehe `SECURITY.md`)

## 11. ADRs (entschieden — Details in `tasks/adr/`)

| ADR | Thema | Entscheidung |
|---|---|---|
| ADR-001 | Provider-Abstraction | Interface designt, nur Anthropic implementiert, Modell-ID config-driven |
| ADR-002 | Memory-Indexierung | FTS5 in SQLite + watchdog |
| ADR-003 | Skill-Auto-Promotion | Lifecycle draft→quarantined→reviewed→active, Sandbox + Yannik-Signatur |
| ADR-004 | MSP-Bridge Permission | Read-only Phase 6, Write Phase 7 mit Approval-Gate |
| ADR-005 | Update-Mechanismus | Tauri-Updater + GitHub-Release (Detail vor v1.0) |
| ADR-006 | Lizenz | MIT für Public-Core, proprietär für MSP-/House-Repos |
| ADR-007 | Repo-Strategie | Hybrid Public-Core + Private MSP-Bridges + Private House-Watch |
| ADR-008 | Vault-Strategie | Multi-Workspace mit `personal/` als Default |
