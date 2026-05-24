# ADR-003: Skill-Auto-Promotion (Self-Improving Skills)

**Status:** Accepted (Konzept) — Implementation gated auf Phase 5
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Hermes/DSPy/GEPA-Pattern: aus Lessons werden automatisch neue Skills generiert oder bestehende verbessert. Risiken:
- LLM-generierter Code könnte Exfiltration enthalten
- Customer-Konflikte mit Approval-Pflicht (`SECURITY.md`)
- Stille Verschlechterung der Skill-Qualität ohne Review

## Entscheidung

**Lifecycle mit harten Gates:**

```
draft → quarantined → reviewed → active → deprecated → disabled
```

1. **draft:** Auto-generiert aus `tasks/lessons.md`. Liegt unter `workspace/skills/_drafts/`. Nicht ladbar im normalen Loader.
2. **quarantined:** Manuell promoted von draft. Liegt im Sandbox-Workspace. Read-only-Test mit synthetischen Inputs erlaubt. Kein Filesystem-Write außer `<sandbox>/`. Kein Netz außer explicit-allowlist. Kein Zugriff auf `customer-confidential`-Notes. Timeout 30s pro Tool-Call.
3. **reviewed:** Yannik hat den Diff (Side-by-Side in GUI) gesehen und signiert (lokaler Ed25519-Key im Keyring). Audit-Log enthält Signatur.
4. **active:** Im normalen Skill-Loader. Kann jederzeit zu deprecated/disabled.
5. **deprecated:** Warnung bei Nutzung, noch ladbar. Migrations-Hinweis im SKILL.md.
6. **disabled:** Nicht ladbar. Bleibt im Repo zur Forensik.

**Bei Touchpoint mit `customer-confidential`-Klassifikation:** zusätzlicher Confirm-Step beim Review.

**Implementation gated:** Phase 5 darf erst starten, wenn:
- Sandbox-Process-Isolation (Tauri/Node Worker) prototyped
- Yannik-Signatur-Flow im GUI implementiert
- Audit-Log-Format finalisiert

## Konsequenzen

- Self-improving ist real, aber niemals autonom destruktiv
- Zusätzliche GUI-Komplexität für Review-Surface
- Lessons-Loop (manuelles `tasks/lessons.md`-Edit) bleibt Default — Auto-Promotion ist optional

## Alternativen erwogen

- **Keine Self-Improvement:** verworfen — Hermes-Pattern hat klaren Mehrwert bei sicherer Implementation
- **Auto-Promotion ohne Review:** verworfen — Security-untragbar bei MSP-Kontext
- **Review per LLM (Codex/Gemini):** verworfen für Skill-Aktivierung; akzeptabel als Pre-Review für Yannik (Heuristik), aber finale Approval bleibt menschlich
