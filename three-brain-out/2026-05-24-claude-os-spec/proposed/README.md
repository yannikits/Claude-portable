# Proposed Split: CLAUDE.md → 4 Files

**Datum:** 2026-05-24
**Quelle:** Three-Brain-Verdikt (siehe `../verdict.md`)
**Status:** Draft — nicht ins Repo-Root übernehmen ohne Yannik-Review.

## Was hier liegt

| Datei | Zweck | Stabilität |
|---|---|---|
| `CLAUDE.md` | Verhaltens-Regeln für Claude Code (Plan-First, Verification, Lessons, Verbote, Sprache) | hoch — selten ändern |
| `ARCHITECTURE.md` | Stack-Wahrheit (TS/Tauri/MCP), Verzeichnis, Domains, Memory, Trust-Boundaries | mittel |
| `ROADMAP.md` | MVP-Definition, Phasen-Plan, Ist-Stand, offene Klärungspunkte | niedrig — wird oft fortgeschrieben |
| `SECURITY.md` | Threat-Model, Data-Classification, Secrets, Audit, MSP-Bridges, Self-Improving-Skills | hoch — bei MSP/Self-Imp Pflicht |

## Was an der Original-Spec rausfällt oder sich ändert

| Original (CLAUDE.md vom 2026-05-24) | Status im Draft |
|---|---|
| Python 3.12 + uv + Typer + pytest + mypy + ruff | gestrichen — Stack ist TypeScript+Tauri+MCP+Biome+Vitest (Realität) |
| Electron als GUI | gestrichen — Repo nutzt Tauri |
| "CLAUDE.md > User-Anweisung > Standard" | korrigiert — User-Turn-Anweisung > CLAUDE.md > Default; Platform-Policy oben drauf |
| `pyproject.toml`, `src/claude_os/` | ersetzt durch `package.json`, `src/` mit Domains |
| Modell-ID `claude-opus-4-7` hardgenagelt | config-driven via `.env`, nicht in der Foundation-Doc |
| Phase 0 = `uv run pytest` grün | Phase 0 = `npm run build` grün + Biome + Vitest |
| Hetzner Cloud Phase 4+ | gestrichen (Tauri = lokal); Cloud-Plan eigene ADR wenn nötig |
| MSP-Bridges als normale Tools | upgraded — `SECURITY.md` ist Pflicht-Read, Phase 6 read-only, Phase 7 write nur mit Approval-Gate |
| Self-Improving Skills implizit OK | Lifecycle (draft → quarantined → reviewed → active), Sandbox + Review-Gate |
| Multi-Channel (Telegram/Signal/Slack) Phase 4 | verschoben auf Phase 9+ als optionale Skills |

## Was NEU dazukommt

- **MVP-Tag-1-Workflow** klar definiert (`ROADMAP.md` §1)
- **Trust-Model** mit 8 Boundaries (`ARCHITECTURE.md` §7)
- **Failure-Mode-Design** für Vault/Index/Provider/Sidecar (`ARCHITECTURE.md` §8)
- **Data-Classification** mit 6 Klassen (`SECURITY.md` §2)
- **Audit-Log-Format** als JSONL (`SECURITY.md` §4)
- **Self-Improving-Skill-Lifecycle** mit Sandbox (`SECURITY.md` §5)
- **Tenant-Isolation** für MSP-Customers (`SECURITY.md` §6.3)
- **DSGVO-Hinweise** (Recht auf Löschung, DSFA, AVV) (`SECURITY.md` §6.4)
- **6 offene ADRs** explizit gelistet vor Phase 1

## Was NOCH offen ist (Yannik-Entscheidung nötig)

Aus `ROADMAP.md`:
1. Repo-Ort (public/private/Gitea)
2. Lizenz (MIT/Apache-2.0/proprietär)
3. Provider-Strategie (Anthropic-only first vs. Multi-Provider designed)
4. Single-Vault vs. Multi-Workspace
5. House-Watch in dieses Repo oder eigenes
6. Video-Analyse (`I Replaced OpenClaw and Hermes...mp4`) — was zeigt das Video an Techniken, die hier fehlen?

## Übernahme ins Repo (wenn du zustimmst)

Vorschlag:
1. Aktuelle (GitNexus-)`CLAUDE.md` umbenennen → `docs/gitnexus.md` (sie hat Wert für Code-Intelligence-Workflow, nur falsche Position)
2. Drafts aus `proposed/` ins Repo-Root verschieben: `CLAUDE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`
3. `SOUL.md` und `TOOLS.md` separat schreiben (Identität bzw. Tool-Inventar) — nicht Teil dieses Drafts
4. Erst-Commit auf eigenem Branch `docs/spec-split-v1`, dann PR

**Nicht** in einem Rutsch — die GitNexus-CLAUDE.md ist aktuell live und wichtig fürs Repo-Navigieren.
