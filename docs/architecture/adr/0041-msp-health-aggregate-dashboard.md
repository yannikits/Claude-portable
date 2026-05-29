# ADR-0041 — MSP-Health Aggregat-Dashboard (Phase 7-E)

**Status:** shipped (2026-05-29, v1.9.0)
**Bedingt durch:** ADR-0038 (Foundation), 0039 (TANSS), 0040 (Veeam), 0037 (Audit-Dashboard-Pattern)

## Kontext

ADR-0038/0039/0040 lieferten zwei konkrete Read-Bridges + CLI-Smoke-Test.
Yannik konnte einzelne Customers per CLI proben — was fehlte: **eine
Übersicht über alle Customer × alle Bridges** ohne 100 CLI-Calls.

## Entscheidung

Web-UI im Operator-Console-Style, admin-gated wie das Audit-Trail-Dashboard
(ADR-0037). Backend orchestriert parallele Bridge-Probes mit TTL-Cache.

### Backend-Domain: `src/domains/msp-aggregate/`

```
types.ts       — AggregateSnapshot, BridgeCellResult<T>, CustomerHealthRow
prober.ts      — runProbes(registry, customers, opts)
cache.ts       — AggregateCache (single-slot TTL + stampede protection)
aggregator.ts  — MspHealthAggregator (cache + lazy loader + forceRefresh)
```

**Probe-Topologie:**
- **Per-Bridge: seriell** (eine Customer-Probe nach der anderen) — so dass
  der bridge-interne Token-Cache (Veeam) sich amortisiert
- **Across-Bridges: parallel** (Promise.all über Bridge-Kinds) — 2-3 Bridges
  saturieren das Netz ohne einen einzelnen MSP-System zu fluten

**Wall-Clock-Guards:**
- Per-Probe-Timeout: caller-konfigurierbar, capped bei 10s
- Whole-Aggregate-Hard-Cap: 30s default — alles unfertig wird `{kind:'timeout'}`

**Cache:**
- Single-Slot (immer der letzte Snapshot), TTL 60s default
  (`CLAUDE_OS_MSP_HEALTH_TTL_SEC`-override)
- **Stampede-Protection:** 10 Admins drücken simultan Refresh → 1 Loader läuft,
  alle warten auf das selbe Promise (via `inFlight: Promise<Snapshot>`)
- Loader-Throw löscht in-flight, nächster Caller retries

### HTTP-Routes: `src/server/routes-msp-health.ts`

Drei admin-gated Endpoints (same Pattern wie `routes-audit.ts`,
env-driven `CLAUDE_OS_ADMIN_EMAILS`-Allowlist):

```
GET  /api/msp-health/rows     → AggregateSnapshot (cache-hit-friendly)
GET  /api/msp-health/config   → { registeredBridges, customerCount, cacheAgeMs }
POST /api/msp-health/refresh  → invalidate + fresh probe
```

`/config` ist `peek`-only (kein Probe-Trigger), `/refresh` ist POST damit
manuelles Cache-Bust nicht versehentlich von Crawlern/GETs ausgelöst wird.

### Frontend: `gui/src/pages/msp-health.tsx`

- Header: customer-count + registered bridges + cache age + Refresh-Button
- Tabelle: Customer × Bridge-Kind, color-coded (tone-ok/warn/error)
- Per-Bridge-Cell-Rendering:
  - `tanss-ok`: „N open / M total · last <date>"
  - `veeam-ok`: „X ok · Y warn · Z failed · W running [· N missing]"
  - Non-ok: kurzer kind + message tinted
- Click → expand inline detail-blocks (JSON-formatted) pro Bridge

Nav-Entry „MSP Health" in OVERVIEW-Section, `adminOnly: true`. Route nur
registered bei `isAdmin === true`. Selbes Pattern wie Audit-Page.

### Bootstrap-Wiring in `serve.ts`

Nur aktiv wenn **multi-user mode** + **adminEmails gesetzt** (kein Sinn
ohne Admin-Gate). Bridges werden env-/vault-driven registriert:

- **TANSS:** registered iff `CLAUDE_OS_TANSS_SERVER_URL` gesetzt
- **Veeam:** registered iff IRGENDEIN Customer `bridges.veeam` hat

`withAuditTrail`-Wrap pflicht — alle Probes schreiben `bridge.read` audit
events. Nicht-konfigurierte Customer/Bridge-Kombi: Customer hat `bridges.X`
aber X nicht registered → cell wird NICHT emittiert (rendert als „—").

### Privacy by Design

Audit-Wrapper (aus Phase 7-A) garantiert: nur `customerSlug`, `bridgeKind`,
`resultKind`, `durationMs` im Audit-Log. Niemals API-Bodies, Sample-Tickets
oder Job-Namen im Audit. Das Aggregate-Dashboard wird über das
existierende Audit-Dashboard auditierbar (Phase Web-7-7 + 7-Audit).

## Konsequenzen

**Positiv:**
- **Foundation hat sich bewährt:** 0 LOC vendor-spezifisch in der Aggregat-
  Domain. `runProbes` kennt nur `BridgeRegistry` + `CustomerRecord`.
  Phase 7-D (Sophos+Securepoint) wird ohne Backend-Aggregat-Änderungen
  funktionieren — nur Frontend-Cell-Component pro Vendor.
- Stampede-Protection skaliert: 100 Admins refreshen gleichzeitig → 1
  Probe-Run.
- Cache-Stale-Tolerance via `getEvenIfStale()` ist eingebaut für eventuelle
  „show-stale-then-refresh"-UX-Iteration ohne Domain-Change.

**Negativ / Trade-offs:**
- Erster Page-Load wartet auf Probe-Pass (bei 10 Customers × 2 Bridges ~10s).
  Cold-Hit-UX: Loading-Indicator + dann full-render. Akzeptiert für MVP.
  Pre-Warming-Job kann später kommen (Phase 7-E.1).
- Per-Bridge-Timeout capped bei 10s — wer eine TANSS-Instance hat die
  >10s antwortet, sieht `timeout`. Bewusste Härte, das Aggregat darf nicht hängen.
- `mspHealth` ServerConfig-Field typed als `any` (avoid pulling msp-aggregate
  into server type-graph). Akzeptiert weil nur der Bootstrap-Pfad das setzt.
- TLS-Insecure ist process-wide (`NODE_TLS_REJECT_UNAUTHORIZED=0` global) wenn
  `CLAUDE_OS_VEEAM_INSECURE_TLS=1` — dokumentiert, kein per-request Agent.
- Frontend hat noch keine echte Pagination. Bei > 200 Customers wird's
  scrollig. Phase 7-E.1.

**Folge-Schritte:**
- Phase 7-D (Sophos/Securepoint) → Frontend-Cell-Components pro Vendor +
  customer.yaml-Schema-Erweiterung. Backend `runProbes` unverändert.
- Phase 7-E.1: Auto-Refresh, Pagination, Per-Cell-Drill-Down zu Audit-
  Entries (klick-through).
- Per-Vendor-SLA-Threshold (z.B. „warn if Veeam-failed > 24h").

## Referenzen
- ADR-0037 — Audit-Trail-Dashboard (Admin-Gating-Pattern + Operator-Style)
- ADR-0038 — MSP-Health-Foundation
- ADR-0039 — TANSS Read-Bridge
- ADR-0040 — Veeam Read-Bridge
- `docs/msp-health-dashboard-guide.md` — User-Setup
