# Phase 7-B — TANSS Read-Bridge

**Status:** Plan (Stand 2026-05-29)
**Ziel-Release:** v1.8.2
**Bedingt durch:** Phase 7-A Foundation (ADR-0038), ADR-0027 (Read-Only)

## Was 7-B liefert

Eine `TanssBridge implements ReadBridge<TanssStatus>` die pro `probe(customer)`
einen **einzigen** read-only Call gegen den MSP-eigenen TANSS-Server macht und
einen kompakten `TanssStatus` zurückgibt (open/owned/lastUpdate). Genug für
das spätere Aggregat-Dashboard (Phase 7-E).

Kein Write, keine GUI, keine Webhooks — reine `probe()`-Pfade.

## TANSS-API-Fakten (PSTANSS-validiert)

- **Auth:** Header `apiToken: <key>` auf jedem Call. Case-sensitive
- **Login:** `POST {server}/api/v1/user/login` (Credentials) → `content.apiKey` (apiKey + refresh)
- **Endpoints (read-only):**
  - `GET /api/v1/tickets/company/{companyId}` — alle Tickets EINER Firma → mappt 1:1 auf `customer.bridges.tanss.customerId`
  - `GET /api/v1/tickets/own` — Tickets des authentifizierten Users
  - `GET /api/v1/tickets/general` — alle offenen/general-Tickets

7-B nutzt **nur** `/tickets/company/{id}` — eine Probe = ein HTTP-Call.
Der globale „own"-Counter kommt im Phase-7-E-Aggregat-Job, nicht hier.

## Config

| Quelle | Schlüssel | Default | Wer setzt |
|--------|-----------|---------|-----------|
| Env | `CLAUDE_OS_TANSS_SERVER_URL` | — (Pflicht) | Admin (Compose-env) |
| Secrets-Backend | `tanss/apiToken` | — (Pflicht) | Admin via `claude-os secrets set` |
| customer.yaml | `bridges.tanss.customerId: number` | — | Per Customer |

**Einmal-Pro-MSP-Instance.** Eine TANSS-Bridge-Instanz für den ganzen Server,
nicht eine pro Customer.

## Module

### `src/domains/msp-bridges/tanss/`

```
types.ts          — TanssStatus, TanssBridgeConfig, raw TanssTicket subset
http-client.ts    — fetch wrapper: apiToken-Header, timeout, retry=1 für 5xx
mapper.ts         — pure: TanssTicket[] → TanssStatus
classify-error.ts — Map HTTP/Network errors → BridgeResult.kind
bridge.ts         — TanssBridge implements ReadBridge<TanssStatus>
index.ts          — barrel
```

### `TanssStatus` (kompakt, kein PII)

```ts
interface TanssStatus {
  readonly openCount: number;          // status != closed/done
  readonly totalCount: number;
  readonly newestUpdateAt: string | null; // ISO
  readonly sample: { id: number; subject: string; status: string } | null;
  // ↑ EIN Sample-Ticket (newest) — gibt Tabellen-Zelle Substanz
}
```

`subject` ist Ticket-Titel — könnte PII enthalten (Customer-Name etc.) aber
ist nicht **mehr** PII als der Customer-Slug selbst. **Nicht** ins Audit-Log
(SECURITY.md §4 hält), nur in den Probe-Return-Value für die laufende
Session.

### Error-Classification (`classify-error.ts`)

| Symptom | → `BridgeResult.kind` |
|---------|----------------------|
| HTTP 401/403 | `auth-failed` |
| HTTP 429 + `Retry-After` | `rate-limited` |
| HTTP 5xx, Timeout, ECONNREFUSED | `unreachable` |
| HTTP 404 für `/company/{id}` | `misconfigured` (customer.yaml-customerId falsch) |
| Config-Fehler (no apiToken/no serverUrl) | `misconfigured` |
| Andere | `error` |

### `TanssBridgeConfig` (DI für die Bridge)

```ts
interface TanssBridgeConfig {
  readonly serverUrl: string;           // z.B. https://tanss.die-its.digital
  readonly getApiToken: () => Promise<string | null>;
  readonly fetch?: typeof globalThis.fetch; // injectable für Tests
  readonly timeoutMs?: number;          // default 10_000
  readonly logger?: Logger;             // pino, optional
}
```

`getApiToken` ist callable damit der Token pro Call frisch geholt wird
(ADR-0038 Hard-Rule #3). Im Production-Code wrappt das den SecretStore.

## Tests (TDD)

### Unit (msp-bridges/tanss/__tests__/)

- `classify-error.test.ts` — alle HTTP/Network-Branches
- `mapper.test.ts` — leeres Array → `openCount=0`, gemischtes Array → korrekt
- `bridge.test.ts` mit gemockter `fetch`:
  - Happy-Path → `ok` + korrekte `TanssStatus`
  - 401 → `auth-failed`, kein Throw
  - 429 mit `Retry-After: 30` → `rate-limited` mit `retryAfterSec: 30`
  - 5xx → `unreachable`
  - Network-Error (`fetch` throws) → `unreachable`
  - Timeout (AbortController) → `unreachable`
  - Customer ohne `bridges.tanss` → `misconfigured`, **kein** HTTP-Call (Beweis: fetch-Mock wird nie aufgerufen)
  - `getApiToken()` returns `null` → `auth-failed`, kein HTTP-Call
- `http-client.test.ts` — verifiziert dass Header `apiToken: <value>` gesetzt wird, nicht `Authorization` oder anderes

### Integration mit Audit-Wrapper

- `audit-integration.test.ts` (in `tests/domains/msp-bridges/tanss/`):
  - `withAuditTrail(new TanssBridge(...), audit).probe(customer)` schreibt
    `bridge.read`-Event mit `action: 'bridge.tanss.probe'` und korrektem
    `outcome` für alle Result-Kinds.

## Phase-Aufteilung

### Phase A — Pure Logik (kein HTTP)
- `types.ts`, `mapper.ts`, `classify-error.ts` + Tests
- **Verification:** vitest grün, tsc clean
- **Commit:** `feat(tanss): pure mapper + error classification (Phase 7-B.A)`

### Phase B — HTTP-Client + Bridge
- `http-client.ts`, `bridge.ts`, `index.ts` (barrel) + Tests mit fetch-Mock
- **Verification:** alle Bridge-Tests grün, integration mit `withAuditTrail` getestet
- **Commit:** `feat(tanss): TanssBridge implements ReadBridge<TanssStatus> (Phase 7-B.B)`

### Phase C — Wiring & Bootstrap
- `src/server/bootstrap-bridges.ts` (oder erweitere bestehende serve-Wiring):
  - Liest `CLAUDE_OS_TANSS_SERVER_URL`
  - Erzeugt `TanssBridge` wenn URL gesetzt + apiToken im Secrets-Store vorhanden
  - `registry.register(withAuditTrail(tanss, audit))`
- Doctor-Check: `tanss-config` — warnt wenn URL gesetzt aber kein apiToken (oder umgekehrt)
- **Verification:** lokaler Smoke-Test mit echtem Token + 1 Customer in vault
- **Commit:** `feat(tanss): wire TanssBridge into serve-bootstrap + doctor (Phase 7-B.C)`

### Phase D — Docs + Release
- ADR-0039 — TANSS Read-Bridge (kurz, nur Bridge-spezifisch)
- `docs/tanss-bridge-guide.md` — User-facing Setup (env + `secrets set` + customer.yaml-Beispiel)
- CHANGELOG `v1.8.2`
- Version-Bump in 4 Manifest-Files
- **Commit:** `feat(tanss): v1.8.2 — TANSS Read-Bridge` + PR

## Out-of-Scope für 7-B

- Refresh-Token-Rotation (apiKey gilt als langlebig, wenn er kippt: re-set per `secrets set`)
- Write-Pfade (ADR-0027 Phase-7 nach v2.0)
- Aggregat-Dashboard (Phase 7-E)
- Pro-Tenant-`/tickets/own`-Aufschlüsselung (kommt in 7-E mit Cross-Bridge-Aggregator)

## Risiken & Mitigationen

| Risiko | Mitigation |
|--------|------------|
| TANSS-Schema kann zwischen v1/v2 brechen | Mapper liest defensiv (`record?.status ?? 'unknown'`), unknown-Felder → `error` mit kurzer Message |
| Token-Leak in Logs | logger redacted `apiToken`-Header explizit (pino redaction-paths) |
| TANSS down → Bridge hängt | `AbortController` mit `timeoutMs` (default 10s) → `unreachable` |
| Customer-ID-Tippfehler in `customer.yaml` | TANSS antwortet 404 → `misconfigured` (nicht `error` — sonst landen die in der Investigation-Falle) |

## Verification-Before-Done-Checkliste

- [ ] alle Unit-Tests grün
- [ ] `tsc --noEmit` clean
- [ ] `biome check` clean
- [ ] Doctor-Check zeigt config-state korrekt
- [ ] Lokaler Smoke-Test: 1 echter Customer-Probe → ok mit echtem `TanssStatus`
- [ ] Audit-Event sichtbar in `audit-YYYY-MM-DD.jsonl` mit korrektem Mapping
- [ ] CHANGELOG + ADR + Guide geschrieben
- [ ] Version-Bump in allen 4 Manifests
