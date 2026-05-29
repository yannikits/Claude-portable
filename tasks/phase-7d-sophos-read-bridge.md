# Phase 7-D — Sophos XG/XGS Read-Bridge

**Status:** Plan (Stand 2026-05-29)
**Ziel-Release:** v1.9.1
**Bedingt durch:** ADR-0038 (Foundation), 0039 (TANSS pattern), 0040 (Veeam pattern), 0041 (Dashboard)

## Was 7-D liefert

`SophosBridge implements ReadBridge<SophosStatus>` für Sophos XG/XGS
Firewalls — die Firewall ist ein DICKES Stück MSP-Infrastruktur und der
operator-relevante Health-Indikator ist „**ist die Firewall up-to-date
+ ist die Lizenz noch lange genug gültig**". Mehr braucht das Dashboard
zunächst nicht.

Sophos Central (Cloud-Mgmt-Variante) ist out-of-scope für 7-D — nur die
direkte XG/XGS-XML-API auf dem Customer-Firewall.

## API-Fakten (Sophos-SDK-validiert)

Hard-confirmed aus `sophos/sophos-firewall-sdk` (Sophos-eigener Python-Module):

- **URL:** `https://<firewall-host>:<port>/webconsole/APIController` (Default-Port 4444)
- **Method:** POST, `Content-Type: application/x-www-form-urlencoded`, Body: `reqxml=<XML>`
- **Auth:** inline in **jedem** Request — kein Token, kein Session:
  ```xml
  <Request>
    <Login><Username>...</Username><Password>...</Password></Login>
    <Get><Firmware></Firmware></Get>
    <Get><LicenseInformation></LicenseInformation></Get>
  </Request>
  ```
- **Multiple `<Get>`-Blöcke pro Request** sind erlaubt → 7-D nutzt EINEN Call mit ZWEI Gets.
- **Response:** XML, `<Response>`-Root, jeder `<Get>` returnt ein eigenes Element
- **Status-Codes** (im `<Status code="..." />`-Element):
  - `534` — IP nicht in API-Access-List → `auth-failed` mit klarer Message
  - `532` — API-Zugriff nicht enabled → `misconfigured`
  - `2xx` — ok
- **TLS:** XG/XGS-Default ist self-signed Cert → wir respektieren
  `CLAUDE_OS_SOPHOS_INSECURE_TLS=1` (gleiches Pattern wie Veeam)

## Config

| Quelle | Schlüssel | Default | Wer setzt |
|--------|-----------|---------|-----------|
| Env | `CLAUDE_OS_SOPHOS_INSECURE_TLS` | `0` | Admin (opt-in für self-signed Default) |
| Secrets-Backend | `sophos/<host>/username` | — | Admin via `secrets set` |
| Secrets-Backend | `sophos/<host>/password` | — | Admin via `secrets set` |
| customer.yaml | `bridges.sophos.firewallHostname: string` | — (Pflicht) | Per Customer |
| customer.yaml | `bridges.sophos.firewallPort?: number` | `4444` | Per Customer (optional) |

`centralCustomerId` bleibt im Schema als reserved-for-future — Sophos
Central kommt evtl. später als 7-D.2.

## Module

### `src/domains/msp-bridges/sophos/`

```
types.ts          — SophosStatus, SubscriptionInfo, SophosBridgeConfig, raw XML shapes
xml-builder.ts    — buildGetRequest(username, password, tags[]) → XML string
xml-parser.ts     — parseSophosResponse(xml) → { firmware, license, status-code }
mapper.ts         — pure: parsed-response → SophosStatus (license-summary heuristic)
classify-error.ts — HTTP + Sophos-status-codes + thrown → BridgeResult.kind
bridge.ts         — SophosBridge implements ReadBridge<SophosStatus>
index.ts          — barrel
```

### `SophosStatus` (kompakt)

```ts
interface SophosStatus {
  readonly firmwareVersion: string;        // e.g. "SFOS 20.0.1 MR-1"
  readonly firmwareType: string | null;    // "Default" | "Maintenance Release"
  readonly licenseSummary: 'active' | 'expiring-soon' | 'expired' | 'mixed' | 'unknown';
  readonly daysToEarliestExpiry: number | null;
  readonly subscriptions: readonly {
    readonly name: string;                 // "Network Protection", "Web Protection", …
    readonly status: string;               // "Subscribed" | "Trial" | "Expired"
    readonly expiresAt: string | null;     // ISO
    readonly daysRemaining: number | null;
  }[];
}
```

**`licenseSummary`-Heuristic:**
- `expired` — alle subscriptions expired
- `mixed` — manche aktiv, manche expired
- `expiring-soon` — alle aktiv aber MIN(daysRemaining) ≤ 30
- `active` — alle aktiv mit > 30 Tagen
- `unknown` — keine subscriptions im Response (Parse-Problem)

Use-Case: das Dashboard-Cell zeigt `firmware-version · license-summary [· N days]`.

### Error-Classification

| Symptom | → `BridgeResult.kind` |
|---------|----------------------|
| HTTP 200 mit `<Status code="534">` | `auth-failed` (IP nicht in API-ACL) |
| HTTP 200 mit `<Status code="532">` | `misconfigured` (API nicht enabled) |
| HTTP 200 mit Login-status != "Authentication Successful" | `auth-failed` (creds falsch) |
| HTTP 4xx (außer 404) | `error` |
| HTTP 5xx, AbortError, ECONN* | `unreachable` |
| TLS-Errors (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` etc.) | `unreachable` mit `INSECURE_TLS`-Hint |
| Customer ohne `bridges.sophos` | `misconfigured` (**kein** HTTP-Call) |
| Keine Creds für Host im Secrets-Backend | `auth-failed` (**kein** HTTP-Call) |
| Andere | `error` |

### XML parsing

Wir nehmen `fast-xml-parser` (~10M weekly downloads, well-maintained,
TypeScript-types built-in). Klein, einzige neue Top-Level-Dep für die
gesamte 7-X-Serie.

Defensive Parsing:
- Tolerant gegen fehlende Felder
- License-Subscriptions können auf XG vs XGS unterschiedliche Strukturen
  haben (manchmal Array, manchmal Single-Element) — Parser normalisiert das.

## Tests

### Unit-Tests

- `xml-builder.test.ts` — POST-Body shape, escapt Sonderzeichen in Username/Password
- `xml-parser.test.ts` — happy-path mit beispiel-Response (firmware + license), Status-code 534 + 532, missing-fields-tolerance, Subscriptions als Array vs Single
- `mapper.test.ts` — license-summary für alle 5 Kategorien, daysToEarliestExpiry, edge-cases (kein expiry, kein status)
- `classify-error.test.ts` — wie tanss-Pattern + Sophos-Spezifika
- `bridge.test.ts` mit fetch-Mock: happy, 534-auth-failed, 532-misconfigured, customer-without-bridges-no-call, no-creds-no-call, TLS-error, timeout, 5xx, audit-integration

### Frontend

- `gui/src/pages/msp-health.tsx` — neuer `SophosCell` der `firmware · license-summary [· N days]` rendert mit license-color-bucketing

## Phase-Aufteilung

### A — Schema + Pure Logik (kein HTTP)
- Schema-Update: `firewallHostname` required, `firewallPort` neu optional
- types/xml-builder/xml-parser/mapper/classify-error + Tests
- **Commit:** `feat(sophos): schema + pure XML parser/mapper (Phase 7-D.A)`

### B — Bridge
- bridge.ts + index.ts mit fetch-Mock-Tests + audit-integration
- **Commit:** `feat(sophos): SophosBridge implements ReadBridge<SophosStatus> (Phase 7-D.B)`

### C — Wiring (CLI + Doctor + Bootstrap + Frontend-Cell)
- `claude-os msp probe sophos <slug>`
- Doctor-Check `sophos-config` (multi-host like Veeam)
- Bootstrap: register iff irgendein Customer `bridges.sophos.firewallHostname` hat
- Frontend `SophosCell` Component
- **Commit:** `feat(sophos): wire SophosBridge into CLI + doctor + dashboard (Phase 7-D.C)`

### D — Docs + Release
- ADR-0042
- `docs/sophos-bridge-guide.md`
- CHANGELOG v1.9.1
- 4 Manifest-Bumps
- **Commit:** `feat(sophos): v1.9.1 — Sophos Read-Bridge` + PR

## Out-of-Scope für 7-D

- Sophos Central (Cloud-Mgmt) — separate API, OAuth2, kommt vielleicht als 7-D.2
- HA-State (Active/Passive)
- Performance-Counters
- Firewall-Rules listing
- Write-Operations (per ADR-0027 verboten)

## Risiken

| Risiko | Mitigation |
|--------|------------|
| XML-Schema-Drift zwischen SFOS-Versionen | Defensive Parser, unknown-Felder → leer-Defaults |
| Subscription-Element kann Array ODER Object sein | xml-parser normalisiert beides zu Array |
| Self-signed Cert blockiert | `CLAUDE_OS_SOPHOS_INSECURE_TLS=1` opt-in mit klarem `unreachable`-Hint |
| API-ACL blockt unsere Server-IP | Status-Code 534 → klarer `auth-failed`-Message ("IP not in API ACL") mit ACL-Hint im Guide |
| Password mit XML-Sonderzeichen (`<>&'"`) | xml-builder escapt korrekt + Test |

## Verification

- [ ] alle Unit-Tests grün
- [ ] tsc/biome clean
- [ ] doctor-check zeigt config-state korrekt
- [ ] CLI-smoke-test gegen echten XG
- [ ] Frontend rendert SophosCell sauber
- [ ] Audit-Event `bridge.read` / `bridge.sophos.probe` ohne creds in details
- [ ] ADR + Guide + CHANGELOG
