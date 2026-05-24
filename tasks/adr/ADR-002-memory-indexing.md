# ADR-002: Memory-Indexierung

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Memory-Layer braucht schnelle Suche über mehrere tausend Markdown-Notes im Obsidian-Vault. Optionen:
- FTS5 in SQLite (Hermes-Pattern)
- Vektor-Embedding-Store (Chroma, sqlite-vec, AgentDB)
- Externes Index-Tool (Meilisearch, Tantivy)
- Linear-Scan (nur für kleine Vaults tragbar)

## Entscheidung

1. **FTS5 in SQLite als Primary-Index.** SQLite via sql.js (Cross-Platform, kein native-build). Schema:
   ```sql
   CREATE TABLE documents(
     path TEXT PRIMARY KEY,
     workspace TEXT NOT NULL,
     classification TEXT NOT NULL,
     frontmatter_json TEXT,
     body TEXT,
     mtime INTEGER
   );
   CREATE VIRTUAL TABLE documents_fts USING fts5(body, content='documents', content_rowid='rowid');
   ```
2. **Watchdog-getriggerte Re-Indexierung.** Vault-Mutations (write/rename/delete) triggern Index-Update.
3. **Vault ist Source-of-Truth.** Bei Index-Inkonsistenz wird neu indexiert, niemals der Vault korrigiert.
4. **Linear-Scan-Fallback.** Wenn Index korrupt oder nicht erreichbar, degradiert die Suche auf Linear-Scan statt zu crashen.
5. **Vektor-Embeddings später.** Wenn Top-K-FTS-Relevanz nachweisbar zu schlecht wird (subjektive Yannik-Bewertung), eigenes ADR.

## Konsequenzen

- Phase 3 fokussiert auf FTS5-Schema + watchdog (kein ONNX, kein Embedding)
- Workspace-Spalte garantiert Cross-Tenant-Sicherheit (siehe `SECURITY.md` §6.3)
- Initialisierung: Voll-Indexierung beim ersten Start kann mehrere Minuten dauern (10k+ Notes)
- Migration auf Embeddings später möglich, ohne Schema-Bruch (zusätzliche Tabelle)

## Alternativen erwogen

- **AgentDB / ruvector mit HNSW:** verworfen — overengineering für initialen Stand, externe Dependencies
- **Meilisearch extern:** verworfen — zusätzlicher Service zu deployen, gegen "Local-First"-Prinzip
- **Linear-Scan only:** als Fallback OK, als Primary nicht skalierbar
