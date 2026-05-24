# Three-Brain Verdict: CLAUDE.md (Claude OS Spec)

**Datum:** 2026-05-24
**Input:** `C:\Users\reapertakashi\Downloads\CLAUDE (1).md` (289 Zeilen)
**Routing:** Codex adversarial review + Gemini repo-vs-spec drift audit

## Consensus Recommendation

**REWRITE.** Beide Brains, beide mit confidence=high. Übereinstimmung an der Wurzel: die Spec ist als Verhaltensgrundlage nicht einsetzbar und widerspricht dem realen Repo-Stand fundamental.

## Diff der Brains

| Befund | Codex | Gemini | Konsens |
|---|---|---|---|
| Stack-Drift (Python vs. TypeScript) | Logisch (Sec.3 widerspricht Sec.4-11) | Empirisch (Repo ist 100% TS/Tauri) | JA — Spec ist nicht der Repo |
| Spec ist Mix aus PRD/Policy/Arch | JA | nicht explizit, aber gleiche Diagnose | JA |
| MSP-Sicherheits-Lücken | JA (kritisch) | nicht im Scope | Codex-only — aber blocking |
| Self-Improving Skills = Risk | JA | nicht im Scope | Codex-only |
| Repo hat schon MCP/Tauri/Biome/Sidecar | nicht im Scope | JA (mit Pfaden) | Gemini-only |
| Modell-ID `claude-opus-4-7` falsch | JA | nicht im Scope | Codex-only — System-Prompt sagt: ID stimmt aktuell, aber Codex hat recht es nicht hartzucodieren |

## Die Top-5 Showstopper

1. **Sprach-Stack-Lüge.** Spec sagt Python+uv+Electron+Typer+pytest+mypy+ruff. Das Repo ist TypeScript+npm+Tauri+Commander+Vitest+Biome+TypeBox. Phase 0-DoD (`uv run pytest` grün) ist im aktuellen Repo unmöglich. Wer die Spec befolgt, muss das halbe Repo wegwerfen — wer das Repo weiterbaut, ignoriert die Spec.

2. **Sec. 12 Pkt. 3 stellt Electron explizit in Frage, aber Sec. 3 und Sec. 10 setzen Electron fest.** Die Realität ist Tauri (`gui/src-tauri/`). Klärungspunkt ist längst entschieden, nur die Spec weiß es nicht.

3. **Control-Hierarchy ist unzulässig.** "CLAUDE.md > User > Standard" — Anthropic-Plattform-Policy, Tool-Permissions, Codex/Gemini-Hooks und User-Anweisungen überlagern diese Datei zwingend. Das ist nicht erzwingbar und erzeugt False-Confidence.

4. **MSP-Bridges ohne Trust-Modell.** TANSS/Ninja/Veeam/M365/Securepoint = Customer-Infra. Spec hat: kein Threat-Model, keine Data-Classification, keine Approval-Gates, kein Audit-Log, keine Tenant-Isolation, keine GDPR-Behandlung, nur `.env`-Secrets. **Das ist haftungsrelevant**, nicht nur technisch.

5. **Self-Improving Skill-Loop ohne Sandbox/Review/Rollback.** Skills schreiben sich selbst um, ohne Permission-Modell oder Provenance. Im MSP-Kontext mit Privileged-Access ein offenes Tor.

## Was Codex/Gemini übereinstimmend als bereits-erledigt sehen

Aus Gemini direkt (Repo-Belege):
- `AGENTS.md`, `tasks/todo.md`, `tasks/lessons.md` ✓
- CLI-Struktur via Commander ✓
- CI (`.github/workflows/ci.yml`) ✓
- Biome + Vitest ✓
- Memory/Vault-Sync (`src/domains/vault-sync/`) — teilweise ✓
- MCP-Integration ✓ (von Spec komplett ignoriert)
- Sidecar-Architektur (`src/sidecar/`) ✓ (von Spec komplett ignoriert)
- NAPI-RS Keyring für Secrets ✓ (Spec sagt nur `.env`)

## Konkrete Empfehlung

**Spec in vier separate Dateien aufspalten, statt monolithisch zu rewriten:**

| Datei | Inhalt | Stabilität |
|---|---|---|
| `CLAUDE.md` (kurz) | Verhaltens-Regeln für Claude Code: Plan-First, Verification, Lessons-Loop, Verbote, Sprach-Policy | hoch |
| `ARCHITECTURE.md` | Trust-Modell, Provider-Layer, Memory-Layer, Tauri/Node-Stack (ist-Zustand!) | mittel |
| `ROADMAP.md` | Phasen, MVP-Definition, Definition of Done pro Phase | niedrig — wird oft geändert |
| `SECURITY.md` | Threat-Model, Data-Classification, MSP-Approval-Gates, Audit, Tenant-Isolation | hoch — vor MSP-Bridges Pflicht |

**Vor dem Rewrite zwingend klären:**

1. **Stack final:** TypeScript+Tauri+MCP (= ist-Zustand) bestätigt? Wenn ja, Python-Referenzen komplett raus.
2. **Modell-IDs als Variable, nicht hardcoded:** `claude-opus-4-7` nicht in der Foundation-Doc nageln.
3. **MVP-Tag-1-Workflow:** Was soll Yannik konkret als erstes tun können? Ohne das ist Phase 0-4 sinnloser Bauplan.
4. **Self-improving skills: in oder raus?** Wenn in, dann mit Sandbox + Review + Rollback designt — nicht "ist schon irgendwie sicher".
5. **MSP-Bridges: Read-only zuerst,** Write-Operations erst nach Approval-Gate-Design.

## Konfidenz der Synthese

**Hoch.** Beide Brains liefern unabhängig dieselbe Kern-Diagnose (Spec ↔ Realität entkoppelt). Codex liefert das Policy/Security-Profil, Gemini die empirische Repo-Evidenz. Keine Widersprüche, nur unterschiedliche Tiefen.

## Tests vor dem Rewrite (Codex-Vorschlag, gefiltert)

- [ ] Anthropic-Modell-IDs gegen aktuelle API verifizieren, nicht hartzucodieren
- [ ] End-to-End MVP-Szenario definieren (Input → Provider → Tool → Memory → Recall)
- [ ] Threat-Model für *eine* MSP-Bridge prototypen (Vorschlag: TANSS read-only)
- [ ] Obsidian+FTS5-Prototyp mit Rename/Delete/Frontmatter-Edit/Concurrent-Write
- [ ] Skill-Loader mit malicious/malformed SKILL.md testen
- [ ] Windows-Pfad-Test: OneDrive-Pfad mit Spaces + Umlauten + long paths
- [ ] CI **zuerst auf Windows**, nicht Linux (Yannik-Primärsystem)
- [ ] ADRs für: Stack, GUI, Memory, Provider-Strategy, Permission-Model — VOR Phase 1

## Output-Dateien

```
three-brain-out/2026-05-24-claude-os-spec/
├── input.md            # Original CLAUDE.md
├── codex-review.md     # Codex adversarial review (44.8KB)
├── gemini-drift.md     # Gemini repo-vs-spec drift audit
└── verdict.md          # diese Synthese
```
