# ADR-0029 — Lizenz: MIT für Public-Core, proprietär für Private-Repos

**Status:** Akzeptiert
**Datum:** 2026-05-24
**Bedingt durch:** Spec-Split (PR #123) — Lizenz-Frage war offen, Public-Repo brauchte Klarstellung

## Kontext

Claude Develop Environment OS ist eine MSP-getriebene Personal-Agent-Umgebung. Referenz-Projekte:

- Hermes Agent (NousResearch): Apache-2.0
- OpenClaw (Steinberger): MIT

Der Wert liegt nicht im Core-Code (Vault + Sidecar-IPC + MCP-Bridge ist generic), sondern in den MSP-Bridges. Algorithmus-Schutz für den Public-Core ist nicht das Ziel.

## Entscheidung

| Repo | Lizenz | Begründung |
|------|--------|------------|
| `Claude-portable` (public) | **MIT** | Maximale Kompatibilität mit OpenClaw (MIT) und Hermes (Apache-2.0). Minimale juristische Komplexität. OSS-Sichtbarkeit ohne Patent-Klausel-Diskussion. |
| `claude-os-msp` (private) | proprietär (keine LICENSE-Datei) | Customer-Konfigurationen + Business-Logik. "All rights reserved" by Default. |
| `house-watch` (private) | proprietär | Privater Use-Case ohne Verbreitungsabsicht. |

**Required im Public-Core:**

- `LICENSE`-Datei mit MIT-Text
- Attribution-Notiz im README für übernommene Patterns (Hermes, OpenClaw, Claude Code, Tauri-Beispiele)

## Konsequenzen

**Positiv**

- Klare Lizenz-Trennung zwischen Public und Privat
- Forks/Kommerzialisierung des Public-Core sind erlaubt — kein praktischer Schutz nötig, da der Wert in den Private-Repos sitzt
- MSP-Bridge-Code ist juristisch geschützt durch „All rights reserved" (deutsches Urheberrecht greift automatisch ohne LICENSE-Datei)
- Public-Beiträge dürfen Public-Core berühren, MSP-Bridges bleiben intern

**Negativ**

- Kein Patent-Schutz im Public-Core (Apache-2.0-Vorteil entfällt) — akzeptabel, da der Code generic ist
- MIT erlaubt theoretisch Fork-and-Sell ohne Attribution-Rückfluss — pragmatisch egal

## Alternativen verworfen

- **Apache-2.0 für Public-Core:** zusätzliche Komplexität (CLA, Patent-Klauseln) für null Mehrwert in dieser Größenordnung
- **GPL/AGPL für Public-Core:** schreckt MSP-Kollegen ab, die das übernehmen könnten
- **Proprietär für alles:** verschenkt OSS-Sichtbarkeit ohne Schutz-Effekt

## Quellen

- ADR-0030 (Repo-Strategie — separate Public/Private-Repos)
- ROADMAP.md (Repo-Ort entschieden)
