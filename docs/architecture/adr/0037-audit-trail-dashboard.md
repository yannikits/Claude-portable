# ADR-0037 — Audit-Trail-Dashboard

**Status:** shipped (2026-05-29, v1.8.0)
**Context:** ADR-0027 finalisierte das Audit-Log-Schema. ADR-0036 brachte Multi-User Stage 2. Bis v1.7.8 hatten Operatoren keine Web-UI über die JSONL-Files — nur `grep` auf den Host.

## Context

Audit-Trail ist seit v1.7.0 strukturell sauber: schema-versioniert (`AUDIT_SCHEMA_VERSION=1`), fixed-key, eine Datei pro UTC-Tag (`<dataDir>/audit/audit-YYYY-MM-DD.jsonl`), 17 Event-Kinds (Phase 7-7 hat 4 admin-Kinds dazugefügt). Audit-Writer ist appendable + redaction-konform (hashed Email/IP per SECURITY.md §4).

**Was fehlte:** kein Read-Tool im Browser. Use-Cases:
- DSGVO-Auskunft: "alle Events betreffend deiner Email der letzten 30 Tage" innerhalb 30 Tagen liefern
- Investigation: "wer hat gestern um 14:00 den Workspace gewechselt"
- Trust-Story: Customer fragt "kannst du beweisen dass …" — Auskunft per CSV-Export
- Coverage-Audit: welche Events fließen überhaupt?

## Decision

Read-only Web-UI über die existierenden JSONL-Files. Drei HTTP-Endpoints + eine Frontend-Page. **Admin-gated** über die existing `CLAUDE_OS_ADMIN_EMAILS`-Allowlist (selbes Pattern wie Web-7-7 Admin-API). Keine Änderung am Writer.

### Backend — neue Domain `src/domains/audit-query/`

5 Module + Tests:
- `types.ts` — `AuditQuery` Filter-Interface, `AuditPage` / `AuditStats` / `AuditExportResult` Shapes
- `reader.ts` — `readAuditFile(path)` parsed JSONL line-by-line mit Skip-on-malformed (tolerant gegen partial tail-lines bei concurrent write)
- `query.ts` — `queryAudit(opts)`: filter (Time-Range / Kinds / Workspace / Tenant / Outcome / Action-substring), Pagination, newest-first Sort + `enumerateDays()` für Day-File-Discovery
- `stats.ts` — `auditStats(opts)`: per-Kind Counts (honours ONLY time-range — Discovery-Tool, andere Filter wären counter-productive)
- `export.ts` — JSONL + CSV (RFC-4180-Escaping) mit 50k Hard-Cap

### Backend — HTTP-Routes `src/server/routes-audit.ts`

Drei GET-Endpoints (alle admin-gated via inline `requireAdmin`):
- `GET /api/audit/list` → `AuditPage`
- `GET /api/audit/stats` → `AuditStats`
- `GET /api/audit/export?format=jsonl|csv` → `AuditExportResult` (Frontend macht Blob-Download)

GET nicht POST damit:
- Filter-State direkt im URL teilbar (DSGVO-Workflow: Investigation-Link weiterleiten)
- Browser-Caching-Layer optional anwendbar
- Meta-Audit-Trail simple (Access-Logs zeigen Filter im query-string)

**JSON-RPC-Dispatcher wird absichtlich NICHT genutzt** — Audit-Endpoints brauchen `req.user`-Context (Admin-Check), den nur das HTTP-Layer hat. Gleiches Pattern wie `routes-admin.ts`.

### Frontend — `gui/src/pages/audit.tsx`

Single-page React-Component (~330 LOC, kein separater Component-Split — inline für eine Page reicht):
- Stats-Strip (Counts pro Kind, sortiert desc) — Discovery-Aid
- Filter-Bar: Time-Range-Preset (heute/7/30/custom), Workspace, Tenant, Outcome, Action-substring
- Kinds-Picker als `<details>` (17 Checkboxen — sonst zu viel Vertical-Space)
- Data-Table mit `.data-table`-Klasse vom Operator-Console-Skin
- Per-Row expandable `details`-JSON
- Pagination + page-size-Selector
- Export-Buttons → Blob-Download mit RFC-konformen `Content-Type`

### Frontend — Admin-Gating

`/api/auth/me` erweitert um `user.isAdmin: boolean` (aus Allowlist berechnet). `useAuthGate()` propagiert das Flag → Layout filtert `NavEntry.adminOnly`, Route wird conditional registriert.

## Consequences

### Vorteile
- DSGVO-Auskunfts-Workflow: Filter → CSV-Export in 30 Sekunden
- Investigation: Live-Filter mit Multi-Day-Range
- Schema bleibt unangetastet — Writer-Path ist nicht angefasst → kein Migration-Risiko
- Admin-Gating reuses Web-7-7 Infrastructure (eine Quelle der Wahrheit für "wer ist Admin")
- Read-Only — keine Mutation der Audit-Files möglich aus dem UI → Audit-Integrity bleibt

### Tradeoffs
- **Multi-Week-Ranges laden N day-files in RAM.** Bei 90 Tage à 1 MB = 90 MB peak. Akzeptabel für Single-Operator-Use-Case. Wenn dense Audit-Data (>1 GB/Tag) zur Realität wird, brauchen wir Streaming-Variante.
- **Export-Cap 50k Rows.** Wer mehr braucht filtert enger. Bewusste Sicherung gegen Memory-Blow.
- **Kein Tail-Streaming.** Operator klickt "Refresh" für Live-View. Auto-Refresh (Polling oder SSE) ist Phase 2.
- **Stats-Strip ignoriert Non-Range-Filter.** Bewusst — sonst sieht der Operator nicht was es überhaupt gibt.

### Performance-Annahmen
- Filter ist im Memory nach JSONL-Parse → O(N×days) wo N = events pro Tag
- Bei 10k Events/Tag, 30 Tage = 300k Events → Filter+Sort in ~100ms auf Single-Core
- Wenn überschritten: Index-Datei pro Day mit Kind→Offset wäre Logical-Next-Step

## ISO-8601 Lexicographic-Gotcha (Bug während Implementation)

`'2026-05-29T00:00:00.000Z' < '2026-05-29T00:00:00Z'` als String-Compare ist TRUE (`.000Z` kommt vor `Z`), aber als Zeitpunkt identisch. Lexicographic-Sort + Filter im query.ts/stats.ts: alle Vergleiche durch `Date.parse()` → numerische Millis. Fix wurde während Test-Schreiben durch ein "expected 10 to be 9" gefangen.

Lesson: ISO-Strings sind im 99%-Fall lexicographic-sortable — ABER `Z` vs `.NNNZ` ist genau der 1%-Fall der dich beißt.

## Out-of-Scope (für ein späteres ADR)

- Audit-Trail-Search (Volltextsuche im `details`-Payload) — Frontend hat aktuell nur Action-substring
- Audit-Retention-UI (heute via env-var, könnte aber als Admin-Setting kommen)
- Audit-Coverage-Gap-Audit (welche Code-Pfade loggen heute NICHT?) — geplant als separates `docs/audit-coverage-gaps.md`
- Live-Tail / SSE-Push
- Per-Event Pin/Annotate (Investigation-Workflow)
- Multi-Tenant-Skoping (Tenant-Operator darf nur eigene Customer-Events sehen) — würde 7-A (Customer-Tenant-Mapping) voraussetzen

## Test-Coverage

- `tests/domains/audit-query/{reader,query,stats,export}.test.ts` — 26 Backend-Unit-Tests
- `tests/server/routes-audit.test.ts` — 8 HTTP-Integration-Tests
- Frontend RTL-Tests deferred — Operator-Smoke nach Merge.
