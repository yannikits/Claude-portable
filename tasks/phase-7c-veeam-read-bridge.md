# Phase 7-C — Veeam Read-Bridge

**Status:** Plan (Stand 2026-05-29)
**Ziel-Release:** v1.8.3
**Bedingt durch:** ADR-0038 (Foundation), ADR-0039 (TANSS — Pattern)

## Was 7-C liefert

`VeeamBridge implements ReadBridge<VeeamStatus>`. Pro `probe(customer)`:
fetcht die jüngsten Job-Sessions für die in `customer.bridges.veeam.jobNames`
genannten Veeam-Jobs, mapped sie auf einen kompakten Backup-Health-Snapshot.

Use-Case: „welche Backups sind ok / warning / failed je Customer".

## Architektur

**Per-Customer-VBR** (Yannik-Entscheidung 2026-05-29). Jeder Customer
hat seinen eigenen Veeam-Backup-Server vor Ort. claude-os kommt per
VPN/MPLS dran. Konsequenzen:

- `bridges.veeam.serverHostname` wird Pflicht-Feld (NICHT mehr optional).
  Schema-Update am `CustomerRecord.veeam` aus v1.8.1 — niemand nutzt
  das in Produktion, kein Migrationspfad nötig.
- `bridges.veeam.serverPort` optional, default 9419.
- `bridges.veeam.jobNames` wird optional — leer/weggelassen = ALLE Jobs
  des Customer-VBR. Wenn gesetzt: Filter auf diese.
- Credentials pro Host im Secrets-Backend:
  - `veeam/<serverHostname>/username`
  - `veeam/<serverHostname>/password`
- Token-Cache pro Bridge-Instance ist ein `Map<host, {token, expiresAt}>`
  — alle Probes für denselben Host teilen sich einen OAuth-Login.

KEIN globales `CLAUDE_OS_VEEAM_SERVER_URL`-Env mehr — Host kommt aus
`customer.yaml`. Was bleibt als globales Env: `CLAUDE_OS_VEEAM_API_VERSION`
(Default `1.1-rev1`) und `CLAUDE_OS_VEEAM_INSECURE_TLS=1` (Opt-In, weil
Veeam-Default ist self-signed Cert).

## Veeam VBR REST API (v12+)

- **Auth (OAuth2 Password Grant):**
  ```
  POST {server}/api/oauth2/token
    Content-Type: application/x-www-form-urlencoded
    x-api-version: 1.1-rev1
  Body: grant_type=password&username=<u>&password=<p>
  Returns: { access_token, refresh_token, expires_in, token_type }
  ```
- **API-Version-Header Pflicht** auf JEDEM Call (`x-api-version: 1.1-rev1`)
- **Bearer-Auth** auf allen Read-Calls: `Authorization: Bearer <access_token>`
- **Sessions-Endpoint:**
  ```
  GET {server}/api/v1/sessions?skip=0&limit=200&typeFilter=Backup
  ```
- **Jobs-States-Endpoint** (alternativ, lighter):
  ```
  GET {server}/api/v1/jobs/states?skip=0&limit=200
  ```

7-C nutzt `/api/v1/sessions?typeFilter=Backup` und filtert client-seitig
per `jobName` (Veeam erlaubt keinen serverseitigen jobName-Filter im
Sessions-Endpoint). Pro Job nehmen wir die JÜNGSTE Session.

## Config

| Quelle | Schlüssel | Default | Wer setzt |
|--------|-----------|---------|-----------|
| Env | `CLAUDE_OS_VEEAM_API_VERSION` | `1.1-rev1` | Admin (optional) |
| Env | `CLAUDE_OS_VEEAM_INSECURE_TLS` | `0` | Admin (opt-in für self-signed) |
| Secrets-Backend | `veeam/<host>/username` | — (Pflicht je Host) | Admin via `secrets set` |
| Secrets-Backend | `veeam/<host>/password` | — (Pflicht je Host) | Admin via `secrets set` |
| customer.yaml | `bridges.veeam.serverHostname: string` | — (Pflicht) | Per Customer |
| customer.yaml | `bridges.veeam.serverPort?: number` | `9419` | Per Customer (optional) |
| customer.yaml | `bridges.veeam.jobNames?: string[]` | `[]` = alle Jobs | Per Customer (optional) |

## Module

### `src/domains/msp-bridges/veeam/`

```
types.ts          — VeeamStatus, VeeamBridgeConfig, raw VeeamSession subset
auth.ts           — OAuth2-Login: user+password → access_token + cache
http-client.ts    — fetch wrapper with bearer + x-api-version + token-cache
mapper.ts         — sessions[] + jobNames[] → VeeamStatus
classify-error.ts — HTTP/Network → BridgeResult.kind
bridge.ts         — VeeamBridge implements ReadBridge<VeeamStatus>
index.ts          — barrel
```

### `VeeamStatus`

```ts
interface VeeamStatus {
  readonly knownJobs: number;                  // jobNames matched in response
  readonly missingJobs: readonly string[];     // jobNames not in response (rename detection!)
  readonly okCount: number;                    // latest session per job: Success
  readonly warningCount: number;
  readonly failedCount: number;
  readonly runningCount: number;
  readonly newestSuccessAt: string | null;
  readonly oldestUnsuccessfulAt: string | null;
  readonly latestRuns: readonly {
    readonly jobName: string;
    readonly state: string;
    readonly endTimeUtc: string | null;
  }[];
}
```

`missingJobs` ist wichtig: erkennt Job-Renames im Veeam-UI, die sonst
silent "alles fein" zeigen würden.

### Token-Cache

In-Memory pro Bridge-Instance: `{ token, expiresAt }`. Refresh wenn
`Date.now() >= expiresAt - 60_000` (60s Sicherheitspuffer). Bei HTTP 401
auf einem Read-Call: Cache invalidieren + EINMAL retry. Mehrfach-Retry
ist `error`.

User+Password kommen pro Probe frisch aus dem Secrets-Backend (ADR-0038
Hard-Rule); aber nur wenn Token expired ist passiert ein OAuth-Login.

### Error-Classification

| Symptom | → `BridgeResult.kind` |
|---------|----------------------|
| HTTP 401 von OAuth | `auth-failed` (user/pwd falsch) |
| HTTP 401 von Read + Retry auch 401 | `auth-failed` |
| HTTP 429 | `rate-limited` |
| HTTP 5xx, Timeout, ECONN* | `unreachable` |
| Config-Fehler (keine creds, kein URL) | `misconfigured` |
| `customer.bridges?.veeam.jobNames === []` | `misconfigured` |
| Andere | `error` |

### Customer-bridges-Probe

Bridge prüft: `customer.bridges?.veeam?.jobNames?.length > 0`. Sonst
`misconfigured`, **kein** HTTP-Call.

## Tests (TDD)

### Unit
- `mapper.test.ts` — leeres jobNames + leere sessions → 0; mehrere Jobs mit
  verschiedenen states, Job-Rename-Detection (jobNames hat 3 Einträge, nur 2
  in response → missingJobs hat 1), Newest-per-Job-Logic
- `classify-error.test.ts` — gleicher Pattern wie tanss
- `auth.test.ts` — happy login → `{ access_token, expiresAt }`; 401 → auth-failed;
  Token-Cache: 2x consecutive login-calls innerhalb expires_in → 1x OAuth-call
- `bridge.test.ts` — mit fetch-Mock:
  - happy path (login + sessions)
  - 401 auf OAuth → auth-failed
  - 401 auf Read + retry-succeeds → ok
  - 401 auf Read + retry-also-401 → auth-failed
  - misconfigured ohne creds
  - misconfigured ohne jobNames (kein HTTP-Call)
  - 5xx → unreachable
  - Bearer-Header + x-api-version-Header geprüft
- `audit-integration.test.ts` — withAuditTrail mappt outcome korrekt

## Phase-Aufteilung

### Phase A — Pure Logik
- `types.ts`, `mapper.ts`, `classify-error.ts` + Tests
- **Commit:** `feat(veeam): pure mapper + error classification (Phase 7-C.A)`

### Phase B — Auth + HTTP + Bridge
- `auth.ts`, `http-client.ts`, `bridge.ts`, `index.ts` + Tests (fetch-mock)
- **Commit:** `feat(veeam): VeeamBridge implements ReadBridge<VeeamStatus> (Phase 7-C.B)`

### Phase C — CLI + Doctor
- Erweitere `claude-os msp probe`-Command: neue Subkommando `veeam <slug>`
- Doctor-Check `veeam-config` (URL + username + password)
- **Commit:** `feat(veeam): wire VeeamBridge into CLI + doctor (Phase 7-C.C)`

### Phase D — Docs + Release
- ADR-0040
- `docs/veeam-bridge-guide.md`
- CHANGELOG `v1.8.3`
- Version-Bump 4 Manifests
- **Commit:** `feat(veeam): v1.8.3 — Veeam Read-Bridge` + PR

## Out-of-Scope
- Per-Customer-VBR (`bridges.veeam.serverHostname`)
- Refresh-Token-Flow (wir machen Password-Grant pro Cache-Miss)
- Repository-/Storage-Capacity-Checks (separater Endpoint, separate Phase)
- Veeam ONE / Veeam Cloud Connect (anderes Auth-Modell)

## Risiken

| Risiko | Mitigation |
|--------|------------|
| `x-api-version` mismatch zwischen claude-os und VBR | Env-Override `CLAUDE_OS_VEEAM_API_VERSION`, Default 1.1-rev1; bei VBR-Response „unsupported api version" → `misconfigured` mit klarer Message |
| Job-Rename in Veeam → claude-os sagt fälschlich „ok" | `missingJobs`-Liste im Status — wenn nicht-leer, warn im UI |
| Sessions-Endpoint returnt 1000+ Einträge (history) | `limit=200`, pro Job nur die jüngste behalten; für 7-E mit echten Caches verfeinern |
| OAuth-Login bei 100+ Customers concurrent | Token-Cache pro Bridge-Instance — alle Customer-Probes teilen sich EIN OAuth-Login pro Veeam-Server |
| TLS-Selbst-signiert (Veeam-Default!) | `CLAUDE_OS_VEEAM_INSECURE_TLS=1` als bewusster Opt-In — sonst hartes `unreachable` mit Hint |

## Verification

- [ ] alle Unit-Tests grün
- [ ] `tsc --noEmit` clean
- [ ] `biome check` clean
- [ ] Doctor-Check zeigt config-state korrekt
- [ ] Smoke-Test: 1 Customer, 1+ Job → `ok` mit echtem `VeeamStatus`
- [ ] Audit-Event `bridge.read` mit `action: 'bridge.veeam.probe'`
- [ ] CHANGELOG + ADR + Guide
- [ ] Version-Bump in allen 4 Manifests
