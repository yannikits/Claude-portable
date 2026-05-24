# Claude OS — Roadmap

Phasen sind sequenziell. Eine Phase darf nur übersprungen werden über ein ADR in `tasks/adr/`. Definition of Done (DoD) ist objektiv prüfbar.

## MVP — "Was kann Yannik an Tag 1?"

**Das ist die Frage, die die ursprüngliche Spec nicht beantwortet hat.** Vorschlag:

> **MVP-Workflow:** Yannik öffnet die Claude-OS-Tauri-GUI, tippt eine Aufgabe ein, Claude-OS lädt relevante Notes aus dem Obsidian-Vault (Top-K via Volltext-Suche), schickt Prompt + Context an Anthropic, Yannik sieht die Antwort, kann sie als neue Note im Vault speichern (mit Frontmatter + Klassifikation). Nächste Session findet die Note via Recall wieder.

**Damit das MVP zählt:**
- [ ] Tauri-GUI öffnet sich, zeigt Eingabefeld
- [ ] Vault-Path aus `.env` gelesen, Verbindung verifiziert
- [ ] Top-K-Retrieval läuft (auch initial mit Linear-Scan, FTS später)
- [ ] Anthropic-Call mit Context-Injection geht raus
- [ ] Response wird angezeigt
- [ ] "Speichern als Note" schreibt Markdown mit Frontmatter
- [ ] Recall in Folge-Session findet die Note

Alles andere ist Phase ≥ 2.

## Ist-Stand (per Gemini-Audit 2026-05-24)

**Bereits gebaut:**
- Repo-Skeleton, `package.json`, CI (`.github/workflows/ci.yml`)
- Biome + Vitest konfiguriert
- `AGENTS.md`, `tasks/todo.md`, `tasks/lessons.md`
- CLI-Skeleton via Commander (`src/cli/index.ts`, `claude-os.cmd`)
- Claude-Bridge in `src/domains/claude-bridge/`
- Vault-Sync-Domain (teilweise) in `src/domains/vault-sync/`
- MCP-Integration (`src/mcp/`)
- Tauri-Sidecar (`src/sidecar/`)
- Tauri-Bundle-CI für MSI/DMG

**Noch nicht gebaut:**
- `SOUL.md`, `TOOLS.md` (Root-Level)
- FTS5-Index für Vault
- Provider-Abstraktion (nur direkt-Anthropic vorhanden)
- MSP-Bridges (alle Phase 6)
- Skill-Auto-Promotion
- House-Watch Phase 6+

## Phasen-Plan (revidiert)

| Phase | Inhalt | Status | DoD |
|---|---|---|---|
| **0 — Bootstrap** | Repo, CI, Lint, Test, Tauri-Bundle | weitgehend ✅ | `npm run build` grün, Biome+Vitest sauber, CI grün auf Windows |
| **1 — Provider-Layer** | `ProviderTransport`-Interface, Anthropic-Impl als erster Provider | offen — ADR-001 zuerst | Contract-Test grün, Tool-Call-Semantik dokumentiert, Modell-ID config-driven |
| **2 — Memory MVP** | Vault-Sync verifizieren, Linear-Scan-Retrieval, Note-Write mit Frontmatter | teilweise ✅ | MVP-Workflow oben durchläuft End-to-End in Vitest + manuellem GUI-Test |
| **3 — Memory FTS5** | SQLite-Index, watchdog-Trigger, Top-K-Ranking | offen — ADR-002 zuerst | Cross-Session-Recall über 3 Sessions funktioniert; Index-Failure degradiert sauber |
| **4 — Skill-Engine** | Skill-Loader, Description-basiertes Matching, Workspace-Path-Resolution | offen | 3 User-Skills funktional eingebunden, malicious SKILL.md sicher abgewiesen |
| **5 — Self-Improvement** | Lessons-Auto-Promotion zu Skill-Drafts, Sandbox, Review-Gate | offen — ADR-003 zuerst | Auto-Vorschlag entsteht, läuft erst nach Yannik-Approval scharf |
| **6 — MSP-Bridges (Read-Only)** | TANSS, NinjaOne, Veeam — nur lesend | offen — ADR-004 + `SECURITY.md` Pflicht | Bridge erzeugt Audit-Log-Eintrag pro API-Call, Schema-validiert, kein Write-Pfad |
| **7 — MSP-Bridges (Write)** | Approval-Gate-Architektur, Write-Operations | offen — explizite User-Freigabe pro Bridge | Approval-Token-Flow, Rollback-Pfad, Tenant-Isolation-Test grün |
| **8 — GUI Polish** | Tauri-Companion vollständig, Tray, Session-Switcher, Multi-Workspace | offen | macOS + Windows-Build verteilbar, Auto-Update funktioniert |
| **9 — House-Watch / Side-Skills** | Immobilien-Crawler etc. (privat, nicht MSP) | offen | dedizierter Workspace, isoliert von MSP-Daten |

## Reihenfolge-Regeln

- Phase 1 (Provider) **vor** Phase 2 (Memory MVP) — sonst kein Provider-Call möglich
- Phase 3 (FTS5) **kann parallel** zu Phase 4 (Skills) laufen, weil unabhängig
- Phase 6 (MSP-Read) **erst nach** `SECURITY.md` finalisiert und ADR-004 entschieden
- Phase 7 (MSP-Write) **niemals** ohne explizite, dokumentierte Yannik-Freigabe pro Bridge
- Phase 5 (Self-Improvement) **niemals** ohne Sandbox + Review (`SECURITY.md` §5)

## Was die alte Spec versprach, das hier rausfällt

- "Hetzner Cloud Phase 4+" — **keine zentrale Cloud-Komponente** im aktuellen Stack. Tauri = lokal. Cloud-Plan braucht eigene ADR, wenn er relevant wird.
- "Multi-Channel-Phase Telegram/Signal/Slack" — verschoben in Phase 9+ als optionale Skills, nicht core.
- "macOS + Windows + Linux gleichermaßen" — **Windows ist Primary** (Yannik-Setup), macOS secondary, Linux best-effort.
- "Identische Outputs bei Provider-Wechsel" — gelöscht. Stattdessen Contract-Tests (siehe `ARCHITECTURE.md` §4).

## Offene Klärungspunkte (vor Phase 1)

Bei Beantwortung jeweils durch ADR ersetzen.

1. **Repo-Ort:** GitHub-public (yannikits/claude-portable), GitHub-private oder Gitea?
2. **Lizenz:** MIT, Apache-2.0 oder proprietär?
3. **Provider-Strategie:** Anthropic-only first oder direkt Multi-Provider designed?
4. **Vault-Pfad-Strategie:** Single-Vault (`<vault>/Claude-OS/`) oder Multi-Workspace (z. B. `personal/`, `msp-work/`, `house-search/`)?
5. **House-Watch:** in dieses Repo oder eigenes? (Empfehlung: eigenes — Privat-Daten separieren)
6. **Video-Inhalt:** Was zeigt das "I Replaced OpenClaw and Hermes With This Claude Code Setup.mp4" konkret an Techniken, die hier fehlen? — Per `video-toolkit` analysieren lassen, dann hier eintragen.

## Geschwindigkeits-Heuristik

- Phase 1+2 sollten in ≤ 2 Wochen MVP-tauglich sein, wenn ADR-001 und ADR-002 schnell entschieden werden
- Phase 6 frühestens, wenn Phase 0-5 stabil — sonst sind MSP-Tickets das mit dem höchsten Schadenspotential
- Bei Schleifen-Verhalten (Phase-Reset > 2× auf gleicher Phase): `three-brain`-Routing für Architektur-Review
