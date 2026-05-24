# ADR-006: Lizenz

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Claude OS ist eine MSP-getriebene Persönliche-Agent-Umgebung. Referenz-Projekte:
- Hermes Agent (NousResearch): Apache-2.0
- OpenClaw (Steinberger): MIT

Der Wert liegt nicht im Core-Code (Vault + LLM-Bridge ist generic), sondern in den MSP-Bridges. Algorithmus-Schutz für den Public-Core ist nicht das Ziel.

## Entscheidung

| Repo | Lizenz | Begründung |
|---|---|---|
| `Claude-portable` (public) | **MIT** | Maximale Kompatibilität mit OpenClaw (MIT) und Hermes (Apache-2.0). Minimale Komplexität. OSS-Sichtbarkeit ohne Patent-Klausel-Diskussion. |
| `claude-os-msp` (private) | **proprietär** (keine LICENSE-Datei) | Customer-Konfigurationen + Business-Logik der ITeen-Schmiede. "All rights reserved" by Default. |
| `house-watch` (private) | **proprietär** (keine LICENSE-Datei) | Privater Use-Case ohne Verbreitungsabsicht. |

**Required:** im Public-Core MIT-Header in `LICENSE`-Datei + Attribution-Notiz für übernommene Patterns (Hermes/OpenClaw).

## Konsequenzen

- Kein Patent-Schutz im Public-Core (Apache-2.0-Vorteil entfällt) — akzeptabel, da generic Code
- Forks/Kommerzialisierung des Public-Core sind erlaubt — kein praktischer Schutz nötig
- MSP-Bridge-Code ist juristisch geschützt durch "All rights reserved" (deutsches Urheberrecht greift automatisch)
- Klare Trennung: Public-Beiträge dürfen Public-Core berühren, MSP-Bridges bleiben intern

## Alternativen erwogen

- **Apache-2.0 für Public-Core:** verworfen — zusätzliche Komplexität (CLA, Patent-Klauseln) für null Mehrwert in dieser Größenordnung
- **GPL/AGPL für Public-Core:** verworfen — schreckt MSP-Kollegen ab, die das übernehmen könnten
- **Proprietär für alles:** verworfen — verschenkt OSS-Sichtbarkeit ohne Schutz-Effekt
