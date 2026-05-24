# ADR-0031 — Vault-Strategie: Multi-Workspace mit `personal/` als Default

**Status:** Akzeptiert
**Datum:** 2026-05-24
**Bedingt durch:** Spec-Split (PR #123) — Tenant-Isolation für MSP-Phase erzwingt strukturelle Trennung

## Kontext

Der Vault speichert sowohl persönliche Notizen, allgemeine MSP-Doku als auch customer-spezifische Daten. Single-Vault-Layout würde diese vermischen — ein einziger Klassifikations-Bug könnte zu Cross-Tenant-Leak führen, was im MSP-Kontext haftungsrelevant ist.

Optionen:

1. **Single-Vault mit `tenant`-Frontmatter** — Klassifikation als einzige Trennung
2. **Multi-Workspace innerhalb eines Vaults** — strukturelle Trennung
3. **Mehrere separate Obsidian-Vaults** — Sync-Albtraum, kein Cross-Workspace-Search

## Entscheidung

**Multi-Workspace innerhalb eines Vaults**, mit Default-Workspace `personal`.

### Layout

```
<vault-root>/Claude-OS/
├── workspaces/
│   ├── personal/                     # Default — Yannik privat
│   │   ├── Sessions/YYYY/MM/
│   │   ├── Skills-Memory/
│   │   ├── People/
│   │   └── Projects/
│   ├── msp-internal/                 # Allgemeine MSP-Doku (firmenintern, kein Customer)
│   │   └── ...
│   └── msp-customers/
│       └── <customer-id>/            # Tenant-isoliert pro Customer
│           ├── Sessions/
│           ├── Tickets/
│           └── ...
└── .claude-os/
    └── index.db                      # FTS5 mit workspace-column (ADR-0025)
```

Vault-Pfad in `.env` als `CLAUDE_OS_VAULT_PATH`.

### Aktiver Workspace als Session-State

- Default beim Start: `personal`
- Explizite Umschaltung per CLI (`claude-os workspace use msp-customers/foo`) oder GUI
- Audit-Log-Eintrag (SECURITY.md §4) bei jedem Workspace-Switch
- Audit-Log enthält den `workspace`-Field bei jedem Provider-Call und Vault-Mutation

### FTS5-Query immer workspace-gefiltert

```sql
SELECT * FROM documents
WHERE workspace = ?
  AND (tenant IS NULL OR tenant = ?)
  AND fts_match(...)
```

Cross-Workspace-Suche **nur explizit** via CLI-Flag (`--all-workspaces`) — niemals automatisch.

### Frontmatter-Pflicht

```yaml
---
workspace: personal               # oder msp-internal | msp-customers/<id>
tenant: <customer-id>             # nur bei msp-customers Pflicht
classification: personal|operational|customer-confidential|secret|ephemeral
schema_version: 1
---
```

Notes ohne `workspace`-Frontmatter werden als `_unsorted` indexiert und in der GUI markiert.

### House-Watch

Lebt **NICHT** in diesem Vault — eigenes Repo + eigener Vault-Bereich (ADR-0030). Klare Privacy-Trennung.

### Migration aus Single-Vault

1. Bestehende Notes in `personal/` schieben (Default-Annahme)
2. Customer-relevante Notes manuell sichten und in `msp-customers/<id>/` verschieben
3. Frontmatter ergänzen (`workspace`, `tenant`, `classification`)
4. `.claude-os/index.db` löschen und neu aufbauen lassen

## Konsequenzen

**Positiv**

- Memory-Retrieval ist sauber tenant-isoliert by default
- Workspace-Switch ist ein expliziter Akt (nicht versehentlich)
- DSGVO-Recht-auf-Löschung ist trivial: Workspace-Folder + Index-Eintrag löschen
- Audit-Trail per Workspace

**Negativ**

- Mehr Disziplin beim Note-Schreiben (richtigen Workspace wählen)
- Setup-Aufwand: bestehenden Vault einmal umstrukturieren
- Cross-Workspace-Search braucht explizites Opt-in — manche Workflows werden manuell

## Alternativen verworfen

- **Single-Vault mit `tenant`-only:** strukturelle Trennung ist robuster gegen Bugs als Disziplin
- **Getrennte Obsidian-Vaults:** Sync, Skill-Sharing, Cross-Workspace-Suchen werden zur Hölle
- **Workspace per Folder ohne FTS-Spalte:** Query-Filter wäre fragiler (Pfad-Parsing statt Index-Lookup)

## Quellen

- ADR-0002 (Cloud-Mount Data Placement — Vault-Pfad-Konvention)
- ADR-0025 (FTS5-Index — workspace-Spalte)
- ADR-0027 (MSP-Bridge — Tenant-Isolation)
- ADR-0030 (Repo-Strategie — House-Watch separat)
- SECURITY.md §6.3 (Tenant-Isolation-Detail)
