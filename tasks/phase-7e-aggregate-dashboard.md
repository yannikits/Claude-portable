# Phase 7-E — MSP-Health Aggregat-Dashboard

**Status:** Plan (Stand 2026-05-29)
**Ziel-Release:** v1.9.0
**Bedingt durch:** ADR-0038 (Foundation), 0039 (TANSS), 0040 (Veeam)

## Was 7-E liefert

Web-UI über alle konfigurierten Bridges × alle Customer im Vault.
**Eine** Tabelle mit einer Zeile pro Customer und einer Spalte pro
Bridge-Kind. Cells zeigen den aktuellen Status (counts + farbcodiert).
Admin-gated wie das Audit-Trail-Dashboard.

User-Story (Yannik): „Ich öffne MSP-Health, scrolle durch meine
Customers, sehe sofort wo Tickets stehen + wo Backups kippen, ohne pro
Customer eine CLI-Probe laufen zu lassen."

## Architektur

### Backend domain: `src/domains/msp-aggregate/`

```
types.ts        — CustomerHealthRow, BridgeCellResult, AggregateSnapshot
prober.ts       — runProbes(registry, customers, opts) — parallel-fan-out mit Concurrency-Limit
cache.ts        — TTL-Cache (default 60s) für Snapshots; singleton pro Bootstrap
aggregator.ts   — Orchestriert prober + cache → AggregateSnapshot
index.ts        — barrel
```

### HTTP-Routes: `src/server/routes-msp-health.ts`

Drei admin-gated GETs + ein POST:

- `GET /api/msp-health/rows` — `AggregateSnapshot` (von cache wenn frisch)
- `GET /api/msp-health/config` — welche Bridges registriert sind + Customer-Count
- `POST /api/msp-health/refresh` — invalidiert cache + re-probe (force)

Admin-Gate über die existierende `requireAdmin`-Hook aus `routes-admin.ts`.

### Frontend: `gui/src/pages/msp-health.tsx`

Single-Page-Component im Operator-Console-Style (phosphor-cyan, JetBrains
Mono — wie audit-Dashboard). Layout:

- Header-Strip: Anzahl Customer, registrierte Bridges, „Last refreshed: …"
- Refresh-Button (manuell)
- Tabelle: Customer × Bridge-Kind
  - Cell-Inhalt: kompakte Status-Pille (color + count)
  - Bei `misconfigured` / nicht-konfiguriert: grauer Strich „—"
  - Hover/Click → expand-row mit Details (latestRuns/sample-ticket etc.)

Tone: dense, terminal-aesthetic, scrollable. Keine Pagination für v1 —
für > 200 Customer kommt v1.9.1.

## Concurrency + Performance

- Outer Loop: über Bridge-Kinds parallel (alle 2-3 Bridges starten gleichzeitig)
- Inner Loop pro Bridge: über Customers SERIELL für 1 Bridge (token-cache!)
- Per-Bridge Probe-Timeout = `min(probe.timeout, 10s)` — Aggregat darf nicht hängen
- Hard-Cap: gesamter `runProbes` exit nach 30s, alle nicht-fertigen Cells werden
  als `{ kind: 'timeout' }` markiert
- Cache: in-memory TTL (default 60s), shared singleton pro Bootstrap

Bei N=10 Customers, 2 Bridges, jede 500ms: ~10s seriell pro Bridge × 2 parallel
= 10s Gesamt. Acceptable.

## Cache-Strategie

```ts
class AggregateCache {
  get(): AggregateSnapshot | null;          // null if stale
  set(snap: AggregateSnapshot): void;
  invalidate(): void;
  ageMs(): number | null;
}
```

TTL 60s default, override via `CLAUDE_OS_MSP_HEALTH_TTL_SEC` env. Force-refresh
via `POST /api/msp-health/refresh` invalidiert.

## CustomerHealthRow / BridgeCellResult

```ts
interface CustomerHealthRow {
  readonly slug: string;
  readonly displayName: string;
  readonly cells: {                           // present iff bridge registered AND configured
    readonly tanss?: BridgeCellResult<TanssStatus>;
    readonly veeam?: BridgeCellResult<VeeamStatus>;
  };
  // future: sophos, securepoint, m365
}

type BridgeCellResult<T> =
  | { kind: 'ok'; data: T; durationMs: number; probedAt: string }
  | { kind: 'misconfigured'; message: string }
  | { kind: 'auth-failed'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'rate-limited'; retryAfterSec: number; message?: string }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };
```

## Bootstrap-Wiring in `serve.ts`

In `serve.ts`-Action: vor `startServer`:

```ts
const registry = new BridgeRegistry();
const audit = new AuditLogger();

// TANSS (env-driven)
if (process.env.CLAUDE_OS_TANSS_SERVER_URL) {
  const tanss = new TanssBridge({
    serverUrl: process.env.CLAUDE_OS_TANSS_SERVER_URL,
    getApiToken: () => secrets.get('tanss/apiToken'),
  });
  registry.register(withAuditTrail(tanss, audit));
}

// Veeam (any customer has bridges.veeam → register)
const repo = new CustomerRepository({ vaultRoot, autoCreate: false });
const customers = await repo.list();
if (customers.some((c) => c.bridges?.veeam !== undefined)) {
  const veeam = new VeeamBridge({
    getCredentialsForHost: (h) => getVeeamCreds(secrets, h),
    apiVersion: process.env.CLAUDE_OS_VEEAM_API_VERSION,
    insecureTls: process.env.CLAUDE_OS_VEEAM_INSECURE_TLS === '1',
  });
  registry.register(withAuditTrail(veeam, audit));
}

const cache = new AggregateCache({ ttlSec: 60 });
const aggregator = new MspHealthAggregator({ registry, repo, cache });
serverConfig.mspHealth = aggregator;
```

Hinweis: insecureTls im Service-Bootstrap heißt request-scoped Agent, NICHT
process-weites `NODE_TLS_REJECT_UNAUTHORIZED`. Vorerst: env auf process-level
wenn gesetzt, dokumentiert als „affects whole process".

## Phase-Aufteilung

### Phase A — Backend domain `msp-aggregate/`
- `types.ts`, `prober.ts`, `cache.ts`, `aggregator.ts`, `index.ts` + Tests
- Tests mit Mock-Bridges (NullBridge + Stub-Bridges)
- **Commit:** `feat(msp-health): aggregator domain (Phase 7-E.A)`

### Phase B — HTTP-Routes
- `routes-msp-health.ts` mit 3 GETs + 1 POST, admin-gated
- Integration-Tests gegen Mock-aggregator
- **Commit:** `feat(msp-health): admin-gated REST routes (Phase 7-E.B)`

### Phase C — Frontend
- `gui/src/pages/msp-health.tsx`
- Nav-Entry "MSP Health" (adminOnly)
- Route-Wiring
- **Commit:** `feat(msp-health): admin web UI (Phase 7-E.C)`

### Phase D — Bootstrap + Docs + Release
- `serve.ts` Erweiterung
- ADR-0041
- `docs/msp-health-dashboard-guide.md`
- CHANGELOG v1.9.0
- Version-Bump 4 Manifests
- **Commit:** `feat(msp-health): v1.9.0 — Aggregat-Dashboard` + PR

## Out-of-Scope für 7-E

- Pro-Cell-Drill-Down (Click → Modal mit allen Details + audit-Link)
- Time-Series / historische Graphen
- Auto-Refresh-Polling
- Alerting / Notifications
- Sophos / Securepoint (Phase 7-D vorher)
- Bulk-Action UI (Restart all probes etc.)

## Risiken

| Risiko | Mitigation |
|--------|------------|
| Erster Page-Load wartet 10+ Sekunden | Loading-State + Background-Probe, danach Cache-Hit |
| Bridge X hängt, blockt aggregate | Per-probe Timeout + Aggregat-Hard-Cap 30s |
| Cache-Stampede (10 admins refreshen gleichzeitig) | `inFlight: Promise<Snapshot>` → alle warten auf denselben Probe |
| Frontend rendert null-Cells für nicht-konfigurierte Bridges | Cell-Component erkennt undefined + zeigt grauen Strich „—" |
| Probe-Cost bei 100 Customers | Token-Cache pro Bridge → 1 OAuth + 100 Reads je Bridge, parallel über Bridges |

## Verification

- [ ] alle Unit-Tests grün (Aggregator, Cache, Routes, UI-Component)
- [ ] `tsc --noEmit` clean
- [ ] `biome check` clean
- [ ] Smoke: `/api/msp-health/rows` returnt valid JSON für 1 Customer mit 2 Bridges
- [ ] Smoke: Page lädt, Tabelle rendert, Refresh-Button funktioniert
- [ ] Auth: Non-Admin sieht 403 + Nav-Entry versteckt
- [ ] Audit: Aufruf von `/api/msp-health/rows` schreibt `admin.api.access`-Event
- [ ] Doctor-Check `msp-health-config` (zeigt registrierte Bridges)
- [ ] CHANGELOG + ADR + Guide
- [ ] Version-Bump in allen 4 Manifests

## Mini-Mockup (Frontend)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MSP HEALTH                                          [↻ Refresh]   age: 12s  │
│ 14 customers · 2 bridges registered (tanss · veeam)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ CUSTOMER              │ TANSS                  │ VEEAM                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ mueller-gmbh          │ ●●●  3 open / 12 total │ ●●  3 ok · 1 warn           │
│ schmitt-bau           │ ●  1 open / 4 total    │ ●●●  4 ok                   │
│ wagner-eg             │ —                      │ ●  1 failed (4d ago)        │
│ ...                   │                        │                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Klick auf Zelle → Inline-Expansion mit Details. Esc/erneutes Klick → collapse.
