# ADR-0040 — Veeam Read-Bridge (per-customer VBR)

**Status:** shipped (2026-05-29, v1.8.3)
**Bedingt durch:** ADR-0027 (Read-Only-Phase), ADR-0038 (Foundation), ADR-0039 (TANSS — Pattern)

## Kontext

Phase 7-C ist die zweite konkrete Bridge. Use-Case (Yannik):
„welche Backups sind ok / warning / failed je Customer" — analog zur
TANSS-Ticket-Übersicht, aber für Veeam Backup & Replication.

## Entscheidung

### Architektur: Per-Customer-VBR

Anders als TANSS (ein zentraler Server pro MSP) entscheiden wir uns für
**per-Customer-VBR**. Begründung (Yannik 2026-05-29): viele MSPs betreiben
Veeam **beim Kunden vor Ort** (Backup-Daten verlassen den Standort nicht),
und claude-os greift via VPN/MPLS auf den jeweiligen VBR-Host zu.

Konsequenzen am Schema:
- `bridges.veeam.serverHostname` wird **Pflicht**-Feld (war optional in v1.8.1)
- `bridges.veeam.serverPort` optional, default `9419`
- `bridges.veeam.jobNames` wird **optional** — leer/weggelassen = alle Jobs auf
  diesem VBR. Wenn gesetzt: Filter auf diese Job-Namen.

Kein globales `CLAUDE_OS_VEEAM_SERVER_URL`-Env mehr. Was bleibt:
- `CLAUDE_OS_VEEAM_API_VERSION` (Default `1.1-rev1`) — Veeam REST API-Version-Header
- `CLAUDE_OS_VEEAM_INSECURE_TLS=1` (Opt-In) — weil Veeam-Default ist self-signed Cert

**Breaking change am Schema:** Ja, gegenüber v1.8.1. Niemand produktiv darauf,
keine Migration nötig. Wer eine `customer.yaml` mit `bridges.veeam.jobNames`
ohne `serverHostname` hatte, bekommt jetzt eine klare Schema-Fehlermeldung mit
Pointer auf diese ADR.

### Auth: OAuth2 Password Grant

```
POST {baseUrl}/api/oauth2/token
  Headers: x-api-version, Content-Type: application/x-www-form-urlencoded
  Body:    grant_type=password&username=<u>&password=<p>
Returns: { access_token, refresh_token, expires_in, token_type:"bearer" }
```

Credentials kommen pro Probe frisch aus dem Secrets-Backend (ADR-0038 Hard-Rule),
Schlüssel: `veeam/<serverHostname>/username` + `veeam/<serverHostname>/password`.

### Token-Cache

In-Memory pro Bridge-Instance: `Map<host, {token, expiresAtMs}>`. Default-Margin
60s vor `expires_in`. Mehrere Customer-Probes für denselben VBR teilen sich
einen OAuth-Login. Bei 401 auf einem Read: Cache-Eintrag für den Host
invalidieren, EINEN Re-Login-Retry. Zweite 401 → `auth-failed`.

Der Token-Cache ist Optimierung, kein Bypass von ADR-0038: die langlebigen
Credentials werden weiterhin pro Probe gefetched.

### Endpoint

```
GET {baseUrl}/api/v1/sessions?typeFilter=Backup&limit=200
  Headers: Authorization: Bearer <access_token>, x-api-version: 1.1-rev1
```

Veeam erlaubt keinen serverseitigen `jobName`-Filter im Sessions-Endpoint.
Filter wird client-seitig im Mapper angewandt.

### Status-Shape

```ts
interface VeeamStatus {
  readonly knownJobs: number;
  readonly missingJobs: readonly string[];   // jobNames im YAML ABER nicht im Response
  readonly okCount: number;                  // letzte Session pro Job: Success
  readonly warningCount: number;
  readonly failedCount: number;
  readonly runningCount: number;
  readonly newestSuccessAt: string | null;
  readonly oldestUnsuccessfulAt: string | null;  // Alarm-Age — wie lange schon kaputt
  readonly latestRuns: readonly VeeamRun[];      // max 20, sorted newest-first
}
```

**`missingJobs` ist der wichtigste Wert** den 7-C über die naive
ok/warn/fail-Übersicht hinaus liefert: erkennt Job-Renames im Veeam-UI, die
sonst silent als „alles fein" durchgehen würden (Job nicht in der Liste =
keine Failure, aber auch kein Backup mehr).

### State-Bucketing

Veeam meldet Status uneinheitlich: `result` (Success/Warning/Failed/None) und
`state` (Working/Starting/Stopping/Idle/Postprocessing/Resuming). Mapping:

| Quelle | → Bucket |
|--------|----------|
| `result === 'Success'` | `ok` |
| `result === 'Warning'` | `warning` |
| `result === 'Failed'` | `failed` |
| `state ∈ {Working, Starting, Stopping, Postprocessing, Resuming}` (kein result) | `running` |
| Alles andere (z.B. result=None state=Idle) | `unknown` (zählt in `knownJobs`, nicht in den Sub-Countern) |

Closed-Detection ist case-insensitive, mehrere Sprachen abgedeckt
(en/de — vgl. TANSS-Pattern).

### Error-Mapping

| Symptom | → `BridgeResult.kind` |
|---------|----------------------|
| OAuth 401 / 403 | `auth-failed` (user/pwd falsch) |
| Read 401 + Retry auch 401 | `auth-failed` |
| HTTP 429 (+ Retry-After) | `rate-limited` |
| HTTP 400 mit „api-version not supported" Body | `misconfigured` (hint: `CLAUDE_OS_VEEAM_API_VERSION`) |
| HTTP 404 | `misconfigured` |
| HTTP 5xx, AbortError, ECONN* | `unreachable` |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` & Geschwister | `unreachable` mit TLS-Hint (`CLAUDE_OS_VEEAM_INSECURE_TLS`) |
| `customer.bridges?.veeam` undefined | `misconfigured` (**kein** HTTP-Call) |
| `getCredentialsForHost()` → null/leer | `auth-failed` (**kein** HTTP-Call) |
| Andere | `error` |

Audit-Outcome-Mapping bleibt das Standard-`withAuditTrail`-Schema:
`ok → ok`, `auth-failed → denied`, sonst `error`.

### CLI-Smoke-Test

```bash
claude-os msp probe veeam <slug>                # human-readable
claude-os msp probe veeam <slug> --json         # BridgeProbe als JSON
claude-os msp probe veeam <slug> --insecure-tls # für Veeam-Default-Cert
```

Exit 0 nur bei `result.kind === 'ok'`.

### Doctor-Check

`veeam-config`:
1. enumeriert Customer-Workspaces
2. sammelt distinct `serverHostname`-Werte
3. probt für jeden Host `veeam/<host>/{username,password}` im Secrets-Backend
4. **ok** wenn keine Veeam-Customers ODER alle Hosts haben beide Creds
5. **warn** wenn N von M Hosts ohne Creds — listet welche
6. **never fail** — Veeam optional

## Konsequenzen

**Positiv:**
- Pattern aus ADR-0038/0039 zahlt sich aus: 0 LOC Audit-Code, 0 LOC Schema-Code in
  der Bridge, 0 LOC Repository-Code. Alles aus der Foundation.
- `missingJobs` löst ein echtes MSP-Problem (Job-Rename-Blindheit).
- Token-Cache pro Host skaliert sauber: 100 Customers auf demselben VBR teilen
  sich EINEN OAuth-Login (über die Lifetime einer Bridge-Instance).

**Negativ / Trade-offs:**
- Schema-Breaking-Change gegen v1.8.1 — akzeptiert weil nichts produktiv.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` im CLI-Pfad ist process-weit, nicht request-scoped
  — der CLI-Prozess exit'ed direkt nach der Probe, kein Spillover. Für Phase 7-E
  Service-Bootstrap brauchen wir einen request-scoped Agent.
- Per-Probe-Cost: 1 OAuth-Login (alle 24h-1min pro Host) + 1 sessions-Call.
  Für 100 Customers auf 100 verschiedenen VBRs in 7-E sequentiell = 100×2 = 200
  Calls. Concurrency-Strategie kommt in 7-E.
- Sessions-Endpoint mit `limit=200` — wer mehr als 200 aktuelle Backup-Sessions hat,
  verliert die ältesten. Pro Job nehmen wir die neueste, also nur bei Customers mit
  > 200 verschiedenen aktiven Jobs ein Problem. Realistic OOH.

**Folge-Schritte:**
- Phase 7-C.1 (optional): Refresh-Token-Flow falls 24h expiry zu kurz wird
- Phase 7-D: Sophos + Securepoint (gleiches Pattern)
- Phase 7-E: Aggregat-Dashboard

## Referenzen
- ADR-0027 — MSP-Bridge Permission-Modell
- ADR-0038 — MSP-Health-Foundation
- ADR-0039 — TANSS Read-Bridge (Pattern-Vorlage)
- `docs/veeam-bridge-guide.md` — User-Setup
- `src/domains/msp-bridges/veeam/` — Implementation
- Veeam VBR REST API Reference (v12+)
