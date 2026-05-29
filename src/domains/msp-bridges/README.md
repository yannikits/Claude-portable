# `@domains/msp-bridges`

Foundation für die per-MSP-System Read-Bridges (TANSS, Veeam, Sophos,
Securepoint, M365). Geshipped in Phase 7-A (v1.8.1, ADR-0038).

## Was hier liegt

| Datei | Zweck |
|-------|-------|
| `types.ts` | `ReadBridge<T>`, `BridgeProbe`, `BridgeResult`, `BridgeKind` |
| `registry.ts` | `BridgeRegistry` — Map `kind → instance` |
| `audit-wrapper.ts` | `withAuditTrail()` — schreibt `bridge.read`-Event pro probe |
| `null-bridge.ts` | Referenz-Implementation + Test-Double |
| `index.ts` | Barrel-Re-Export |

Konkrete Bridges (`TanssBridge`, `VeeamBridge`, …) liegen **nicht** hier —
sie kommen in eigenen Phase-7-B/C/D-Modulen und implementieren nur das
`ReadBridge<TStatus>`-Interface.

## Quickstart — eine neue Bridge implementieren

1. **Status-Shape definieren** (eigener Datei, z.B. `tanss/types.ts`):
   ```ts
   export interface TanssStatus {
     readonly openTickets: number;
     readonly lastTicketAt: string | null;
     readonly slaBreaches: number;
   }
   ```

2. **Bridge-Klasse schreiben:**
   ```ts
   import type { CustomerRecord } from '@domains/msp-customers';
   import type { BridgeProbe, ReadBridge } from '@domains/msp-bridges';

   export class TanssBridge implements ReadBridge<TanssStatus> {
     readonly kind = 'tanss' as const;

     constructor(private readonly deps: { secrets: SecretsBackend; http: HttpClient }) {}

     async probe(customer: CustomerRecord): Promise<BridgeProbe<TanssStatus>> {
       const probedAt = new Date().toISOString();
       const start = Date.now();
       const ids = customer.bridges?.tanss;
       if (!ids) {
         return mkResult(this.kind, customer.slug, probedAt, start, {
           kind: 'misconfigured',
           message: 'customer.yaml has no bridges.tanss section',
         });
       }
       // hole Token frisch — nicht cachen
       const token = await this.deps.secrets.get(`tanss/${customer.slug}/token`);
       if (!token) {
         return mkResult(this.kind, customer.slug, probedAt, start, {
           kind: 'auth-failed',
           message: 'no token in secrets-backend',
         });
       }
       try {
         const status = await this.deps.http.get(`/customers/${ids.customerId}/status`, { token });
         return mkResult(this.kind, customer.slug, probedAt, start, { kind: 'ok', data: status });
       } catch (err) {
         return mkResult(this.kind, customer.slug, probedAt, start, {
           kind: classifyError(err),
           message: shortMessage(err),
         });
       }
     }
   }
   ```

3. **Im `serve`-Bootstrap registrieren** (immer mit Audit-Wrapper):
   ```ts
   const tanss = new TanssBridge({ secrets, http });
   registry.register(withAuditTrail(tanss, auditLogger));
   ```

## Die vier Regeln (HARD-CONTRACT)

1. **`probe()` wirft nie.** Alle Fehler über `BridgeResult.kind`.
2. **`customer.bridges?.<kind>` ist die Konfig-Probe** — fehlt es,
   sofort `misconfigured`, **kein** HTTP-Call.
3. **Tokens werden pro Call frisch geholt** — der Bridge-Singleton hält
   keine Secrets. Andernfalls schlagen Token-Rotation und User-Logout fehl.
4. **`durationMs` ist real** — gemessen von `start` bis return. SLA-
   Dashboard in Phase 7-E liest das.

## Audit-Wrapper-Konvention

Wenn du im Bootstrap-Code `withAuditTrail` **vergisst**, gibt's
**keine** Audit-Events für die Bridge. Code-Review-Regel: jede
`registry.register(…)`-Stelle hat ein `withAuditTrail(…)` außenrum.

Der Wrapper schreibt:
- `kind: 'bridge.read'`
- `action: 'bridge.<kind>.probe'`
- `outcome`: `ok` / `denied` (auth-failed) / `error` (alles andere)
- `details: { bridgeKind, customerSlug, resultKind, durationMs, message? }`

Keine PII (kein Email, kein API-Body). Nur `customerSlug` (per Definition
nicht-secret, ADR-0038).

## NullBridge

`NullBridge('tanss')` ist die Test-Default. Sie liefert `ok/noop` wenn
`bridges.tanss` gesetzt ist, sonst `misconfigured`. Zwei Use-Cases:

- **Tests** — keine Mock-Library, kein Network-Stub nötig.
- **Aggregat-Dashboard-Fallback** (Phase 7-E) — wenn eine konkrete Bridge
  bei einem Customer (noch) nicht registriert ist, kann das Dashboard
  trotzdem die Liste rendern statt zu crashen.

## Verwandte Dokumente

- ADR-0038 — MSP-Health-Foundation
- ADR-0027 — MSP-Bridge Permission-Modell
- `docs/customer-yaml-guide.md` — User-Schema für `customer.yaml`
- `src/domains/msp-customers/` — Customer-Repository (liefert `CustomerRecord` an `probe()`)
