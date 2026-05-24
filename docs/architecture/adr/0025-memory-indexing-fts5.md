# ADR-0025 — Memory-Indexierung via FTS5 in SQLite

**Status:** Akzeptiert (Konzept) — Implementation gated auf Memory-Phase
**Datum:** 2026-05-24
**Bedingt durch:** Spec-Split (PR #123) — Multi-Workspace-Vault braucht skalierbare Suche

## Kontext

Der Obsidian-Vault wächst auf mehrere tausend Markdown-Notes (Sessions, Skill-Memory, People, Projects, Customer-Workspaces). Linear-Scan auf jeder Query wird unbrauchbar, sobald der Vault > 1000 Notes hat. Optionen für Search-Layer:

1. **FTS5 in SQLite** — Bordmittel via `sql.js` (ADR-0014-Stack), kein zusätzlicher Service
2. **Vector-Embedding-Store** (Chroma, sqlite-vec, AgentDB) — semantische Suche, aber ONNX/embedding-Pipeline + tooling-Overhead
3. **Externes Tool** (Meilisearch, Tantivy) — separater Service zu deployen, gegen Local-First-Prinzip
4. **Linear-Scan** — nur für kleinen Vault tragbar

## Entscheidung

**FTS5 in SQLite als Primary-Index, Linear-Scan als Failure-Fallback.**

### Schema

```sql
CREATE TABLE documents(
  path TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  tenant TEXT,
  classification TEXT NOT NULL,
  frontmatter_json TEXT,
  body TEXT,
  mtime INTEGER
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  body,
  content='documents',
  content_rowid='rowid'
);
```

`workspace`-Spalte garantiert die Cross-Tenant-Sicherheit aus ADR-0031 (Multi-Workspace) und SECURITY.md §6.3.

### Re-Indexierung

- Watchdog auf Vault-Mutations (write/rename/delete) triggert Index-Update
- Initial-Indexierung beim ersten Start kann mehrere Minuten dauern (10k+ Notes)
- Bei Crash mitten in der Indexierung: nächster Start prüft `mtime`-Diff und holt den Rückstand nach

### Conflict-Resolution

Vault ist Source-of-Truth. Bei Inkonsistenz:
- Index ohne Vault-Datei → Eintrag löschen
- Vault-Datei ohne Index → neu indexieren
- Niemals der Vault korrigieren, um den Index zu „retten"

### Failure-Modes

- Index-File korrupt → automatischer Rebuild im Hintergrund, Linear-Scan als Fallback in der Zwischenzeit
- `documents_fts` wirft FTS-spezifische Errors → degradiert auf `WHERE body LIKE ?` (langsam aber korrekt)

### Vektor-Embeddings später

Wenn Top-K-FTS-Relevanz nachweisbar zu schlecht wird (subjektive Yannik-Bewertung): eigenes ADR. Migration ohne Schema-Bruch möglich (zusätzliche Tabelle `embeddings`, kein Drop).

## Konsequenzen

**Positiv**

- Bordmittel, kein externer Service
- Workspace-Filter baked in (`WHERE workspace = ?` jederzeit)
- Schnelle Volltext-Suche selbst bei 50k+ Notes
- Cross-Platform via `sql.js` (kein native-build wie `better-sqlite3`)

**Negativ**

- Keine semantische Suche (Synonyme, Konzept-Match)
- Initial-Index-Build kann lang dauern (UX: Progress-Bar im First-Start-Wizard)
- FTS5-Query-Sprache hat eigene Quirks (Phrase-Quoting, NEAR-Operator)

## Alternativen verworfen

- **AgentDB / ruvector mit HNSW:** Overengineering für Initial-State, externe Dependencies, native-build-Pain
- **Meilisearch extern:** zusätzlicher Service zu deployen, widerspricht Local-First aus ADR-0001 / ADR-0006
- **Linear-Scan only:** unbrauchbar ab ~1000 Notes

## Quellen

- ADR-0014 (Biome) — code-quality-stack
- ADR-0031 (Multi-Workspace) — workspace-spalte begründet
- SECURITY.md §6.3 — Tenant-Isolation via Workspace-Filter
