# ADR-0038 — MSP-Health-Foundation (Customer-Repo + Bridge-Interface)

**Status:** shipped (2026-05-29, v1.8.1)
**Bedingt durch:** ADR-0027 (MSP-Bridge Permission-Modell), ADR-0031 (Vault-Multi-Workspace), ADR-0037 (Audit-Trail-Dashboard)

## Kontext

ADR-0027 hat das Permission-Modell für MSP-Bridges festgelegt (Read-Only erst, Write hart gegated). Was bisher **fehlte**:

1. **Wer ist „der Customer"?** ADR-0031 hat den Vault-Workspace `msp-customers/<slug>/` etabliert — aber kein Schema für die Customer-Metadaten selbst. Bisher implizit aus dem Slug abgeleitet.
2. **Wie sieht eine Bridge aus?** ADR-0027 spricht von „TANSS-Bridge", „Veeam-Bridge" — aber kein typisierter Contract, keine Registry, kein einheitlicher Audit-Anschluss.

Konsequenz: jede neue Bridge (TANSS in Phase 7-B, Veeam in 7-C, Sophos+Securepoint in 7-D) müsste das Rad neu erfinden. Das ist die typische „pro-Vendor-Module-eigene-Welten"-Falle.

Phase 7-A ist die **Foundation**, kein User-Feature. Sie liefert die zwei Verträge, die alle 7-B/C/D-Bridges nutzen.

## Entscheidung

Zwei neue Domains unter `src/domains/`:

### `msp-customers/` — Customer-Repository

**Was:** Read-Through-Repository über die `customer.yaml`-Files in `<vaultRoot>/workspaces/msp-customers/<slug>/customer.yaml`.

**Schema (`CustomerRecord`):**
- `slug` — `[a-z0-9][a-z0-9-]*`, max 64 Zeichen. Identität, immutable, matched den Workspace-Pfad
- `displayName` — Pflicht, beliebiger UTF-8-String
- `contact?` — `{ email?, phone?, primaryUser? }` — alle optional
- `bridges?` — pro Bridge-Kind ein **Identifier-Bag** (NICHT Token!):
  - `tanss: { customerId: number }`
  - `veeam: { serverHostname?, jobNames: string[] }`
  - `sophos: { centralCustomerId?, firewallHostname? }`
  - `securepoint: { deviceId: string }`
  - `m365: { tenantId: string }`
- `tags?` — `string[]`, freie MSP-Klassifikation („SLA-Gold", „Backup-Heavy")
- `notes?` — string, kurzer Freitext
- `extras?` — `Record<string, unknown>` — Forward-Compat-Slot für unbekannte Top-Level-Keys

**Wichtig:**
- Tokens / Secrets gehen **niemals** in die `customer.yaml`. Sie kommen aus dem Secrets-Backend (Keyring per ADR-0004 lokal, env in Compose-Mode). Die `customer.yaml` enthält nur **Identifier**, mit denen die Bridge im Secrets-Backend nach dem passenden Token sucht. → Datei-Mode `0o644`, nicht secret.
- Unbekannte Bridge-Kinds (Tippfehler wie `tansss`) werden **früh abgelehnt** — `CustomerSchemaError`. Das verhindert stille Konfig-Fehler.
- Unbekannte Top-Level-Keys landen in `extras` (Forward-Compat) und gehen beim Round-Trip nicht verloren.

**API:**
```ts
class CustomerRepository {
  list(): Promise<readonly string[]>;
  get(slug: string): Promise<CustomerRecord | null>;
  findByBridgeId(kind: 'tanss', id: number): Promise<CustomerRecord | null>;
  findByBridgeId(kind: 'm365' | 'securepoint', id: string): Promise<CustomerRecord | null>;
  invalidate(slug?: string): void;
}
```

`findByBridgeId` ist der „reverse-lookup", der die TANSS-/Veeam-Bridges in Phase 7-B+ brauchen: Webhook kommt mit `customerId=42`, → welcher unserer Customers ist das?

mtime-Cache pro Datei: ein erneutes `get()` macht nur dann YAML-Parsing, wenn `mtime` sich geändert hat.

### `msp-bridges/` — Bridge-Interface + Registry + Audit-Wrapper

**`ReadBridge<TStatus>` (Hard-Contract):**

```ts
interface ReadBridge<TStatus> {
  readonly kind: BridgeKind; // 'tanss' | 'veeam' | 'sophos' | 'securepoint' | 'm365'
  probe(customer: CustomerRecord): Promise<BridgeProbe<TStatus>>;
}
```

Vier Regeln, die jede konkrete Bridge einhält:

1. **Nie werfen** — Fehler immer als `BridgeResult.kind` (`unreachable | auth-failed | rate-limited | misconfigured | error`).
2. **`bridges`-Subobject ist Pflicht** — fehlt es → `result.kind: 'misconfigured'`, kein API-Call.
3. **Token wird pro Call frisch geholt** — kein Caching von Secrets im Bridge-Singleton.
4. **`durationMs` reporten** — für SLA-Dashboards in Phase 7-E.

**`BridgeRegistry`:** `Map<BridgeKind, ReadBridge<unknown>>`. Doppel-Register wirft (`BridgeRegistryError`). Bewusst keine globale Singleton — Test-Suiten und Worker-Prozesse bekommen ihre eigene.

**`withAuditTrail(inner, audit)`:** Decorator, der jeden `probe()` ins Audit-Log mirror-schreibt:
- `kind: 'bridge.read'`
- `action: 'bridge.<kind>.probe'`
- `outcome`: `ok → 'ok'`, `auth-failed → 'denied'`, alles andere → `'error'`
- `details: { bridgeKind, customerSlug, resultKind, durationMs, message? }`

Keine PII im Audit (per SECURITY.md §4): nur `customerSlug`, kein Email, kein API-Body.

**`NullBridge`:** Referenz-Implementation. Liefert `'ok'/noop` wenn `bridges.<kind>` gesetzt, sonst `'misconfigured'`. Dient als Test-Double und als Aggregat-Fallback in Phase 7-E falls eine konkrete Bridge (noch) nicht registriert ist.

## Konsequenzen

**Positiv:**
- Phase 7-B (TANSS) ist jetzt nur noch: Klasse `TanssBridge implements ReadBridge<TanssStatus>` schreiben, im `serve`-Bootstrap `registry.register(withAuditTrail(new TanssBridge(deps), audit))`. Kein neuer Audit-Code, kein neues Schema.
- Aggregat-Dashboard (Phase 7-E) iteriert über `registry.kinds()` × `customerRepo.list()` — Bridges sind austauschbar/mockbar.
- Forward-Compat für neue Bridge-Kinds via `extras`-Slot (`m365`, später `ninjaone`, etc.).

**Negativ / Trade-offs:**
- `customer.yaml` ist Single-Source-of-Truth für Identifier — wer einen Customer von TANSS-`42` auf `43` migriert, muss die YAML pflegen. Wir akzeptieren das gegen die Komplexität einer DB-Tabelle (sql.js ist da, aber Yaml ist diff-friendly + git-friendly).
- Audit-Wrapper ist optional (`withAuditTrail` ist ein Decorator) — in Tests kann die Bridge nackt benutzt werden. Wir verlassen uns darauf, dass die Server-Bootstrap-Sequenz wrappt. → Dokumentiert in `docs/msp-bridges-readme.md` + Bootstrap-Code-Review-Pflicht.
- `findByBridgeId` macht aktuell linearen Scan über alle YAMLs. OK für ≤ 500 Customers; ab dann Index-Map (TODO Phase 7-E).

**Folge-ADRs:**
- ADR-0039 wird Phase 7-B (TANSS Read-Bridge) konkret beschreiben.
- ADR-0040 Veeam-Bridge.
- ADR-0041 Sophos+Securepoint-Bridge.
- ADR-0042 Aggregat-Health-Dashboard.

## Referenzen
- ADR-0027 MSP-Bridge Permission-Modell (Read-Only-Phase ist diese Foundation)
- ADR-0031 Vault-Multi-Workspace (definiert `msp-customers/<slug>/`)
- ADR-0037 Audit-Trail-Dashboard (Konsument der `bridge.read`-Events)
- `docs/customer-yaml-guide.md` (User-facing schema)
- `src/domains/msp-bridges/README.md` (Implementierer-Leitfaden für Phase 7-B/C/D)
