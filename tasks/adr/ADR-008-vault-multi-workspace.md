# ADR-008: Vault-Strategie (Multi-Workspace)

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Der Vault speichert sowohl persönliche Notizen, allgemeine MSP-Doku als auch customer-spezifische Daten. Single-Vault-Layout würde diese vermischen — ein einziger Klassifikations-Bug könnte zu Cross-Tenant-Leak führen.

Optionen:
- Single-Vault mit `tenant`-Frontmatter (Klassifikation als einzige Trennung)
- Multi-Workspace im Vault (strukturelle Trennung)
- Mehrere getrennte Vaults (Sync-Albtraum)

## Entscheidung

**Multi-Workspace innerhalb eines Vaults**, mit Default-Workspace `personal`.

```
<vault-root>/Claude-OS/
├── workspaces/
│   ├── personal/                     # Default — Yannik privat
│   │   ├── Sessions/YYYY/MM/
│   │   ├── Skills-Memory/
│   │   ├── People/
│   │   └── Projects/
│   ├── msp-internal/                 # Allgemeine MSP-Doku (firmen-intern, kein Customer)
│   │   └── ...
│   └── msp-customers/
│       └── <customer-id>/            # Tenant-isoliert pro Customer
│           ├── Sessions/
│           ├── Tickets/
│           └── ...
└── .claude-os/
    └── index.db                      # FTS5 mit workspace-column
```

**Aktiver Workspace** ist Session-State:
- Default beim Start: `personal`
- Explizite Umschaltung per CLI (`claude-os workspace use msp-customers/foo`) oder GUI
- Im Audit-Log bei jedem Provider-Call und Vault-Mutation festgehalten

**FTS5-Query immer workspace-gefiltert:**
```sql
SELECT * FROM documents
WHERE workspace = ? AND (tenant IS NULL OR tenant = ?)
AND fts_match(...)
```

**Cross-Workspace-Suche** nur explizit via CLI-Flag (`--all-workspaces`) — niemals automatisch.

**Frontmatter-Pflicht:**
- `workspace: personal | msp-internal | msp-customers/<id>`
- bei msp-customers zusätzlich: `tenant: <customer-id>`

Notes ohne `workspace`-Frontmatter werden als `_unsorted` indexiert und in der GUI markiert.

## Konsequenzen

- Memory-Retrieval ist sauber tenant-isoliert by default
- Workspace-Switch ist ein expliziter Akt (nicht versehentlich)
- Mehr Disziplin beim Note-Schreiben (richtigen Workspace wählen)
- Setup-Aufwand: Yannik strukturiert seinen bestehenden Vault einmal um
- House-Watch lebt NICHT in diesem Vault — eigenes Repo + eigener Vault-Bereich (ADR-007)

## Alternativen erwogen

- **Single-Vault mit `tenant`-only:** verworfen — strukturelle Trennung ist robuster gegen Bugs
- **Getrennte Obsidian-Vaults:** verworfen — Sync, Skill-Sharing und Cross-Workspace-Suchen werden zur Hölle
- **Workspace per Folder ohne FTS-Spalte:** verworfen — Query-Filter wäre fragiler (Pfad-Parsing)

## Migration aus Single-Vault

1. Bestehende Notes in `personal/` schieben (Default-Annahme)
2. Customer-relevante Notes manuell sichten und in `msp-customers/<id>/` verschieben
3. Frontmatter ergänzen (`workspace`, `tenant` falls anwendbar)
4. `.claude-os/index.db` löschen und neu aufbauen lassen
