# Phase 7-A — MSP-Health-Foundation

Branch: `feature/phase-7a-msp-health-foundation`
Plan-Datum: 2026-05-29 (nach v1.8.0)
Vorbedingung: v1.8.0 deployed mit Multi-User Stage 2 + Admin-Routes + Audit.

---

## Was wir bauen

**Foundation** für die Bridges (7-B TANSS / 7-C Veeam / 7-D Sophos+Securepoint / 7-E Aggregat-Dashboard). KEIN Frontend, KEIN konkrete-Bridge-Implementation. Nur:
1. Customer-Identitäts-Schema (`customer.yaml` pro Customer-Workspace)
2. Customer-Repository (lesen, listen, validation)
3. Gemeinsames Bridge-Interface in TypeScript
4. Bridge-Registry (Map: bridgeKind → Instance)
5. Audit-Wrapper (jeder `probe()` schreibt `bridge.read` Event)
6. ADR-0038 + Tests

---

## Customer-Identität — `customer.yaml`

Liegt pro Customer-Workspace: `<vault>/workspaces/msp-customers/<slug>/customer.yaml`. **YAML** statt JSON weil Yannik die Datei auch manuell editiert (Kommentare, Mehrzeiler).

```yaml
# Pflicht
slug: mueller-gmbh                    # Pfad-Komponente (a-z, 0-9, -)
displayName: "Steuerkanzlei Müller GmbH"

# Empfohlen — Customer-Stammdaten
contact:
  primaryEmail: kontakt@mueller-stb.de
  primaryPhone: "+49 30 12345678"
  street: "Musterstraße 1"
  zip: "10115"
  city: "Berlin"

# Bridge-IDs — werden von den Bridges (7-B/C/D) gelesen
bridges:
  tanss:
    customerId: 12345               # Numeric ID in TANSS
  veeam:
    serverHostname: backup.iteen.local
    jobNames:                       # mehrere Jobs pro Customer möglich
      - mueller-pc-backup
      - mueller-server-backup
  sophos:
    centralCustomerId: "abc-def-…"  # in Sophos Central
    firewallHostname: fw.mueller-stb.local
  securepoint:
    deviceId: "sp-12345"
  m365:
    tenantId: "12345678-…"          # Azure-Tenant-Id

# Optional — Metadata
tags:
  - stb                              # branche
  - kmu                              # größe
notes: |
  Mehrzeiliger Freitext für Yannik-Notizen.
```

**Validation:**
- `slug` regex `^[a-z0-9][a-z0-9-]*$`, max 64
- `displayName` non-empty
- Alle `bridges.*` sind optional — Customer ohne bestimmte Bridge wird in Aggregat als "n/a" gezeigt
- Unknown top-level fields werden behalten (forward-compat) aber nicht validiert

---

## Phase A — Customer-Repository

- [ ] **A.1** Neue Domain `src/domains/msp-customers/`
  - [ ] `types.ts` — `CustomerRecord`, `BridgeIds`-Subtypes
  - [ ] `paths.ts` — `customerYamlFor(slug)` + `msrpCustomersDir()`
  - [ ] `schema.ts` — Validation + Default-Application
  - [ ] `reader.ts` — `readCustomerYaml(slug)` mit YAML-parse (verwende existierende js-yaml ODER node:fs + handgeschriebenes Mini-Yaml-Subset wenn keine YAML-dep)
  - [ ] `repository.ts` — `CustomerRepository.list()` / `get(slug)` / `findByBridgeId(kind, id)` mit mtime-Cache (analog zu schedules-cache)
  - [ ] `index.ts` — Barrel-Export
- [ ] **A.2** Tests in `tests/domains/msp-customers/`
  - [ ] `schema.test.ts` — alle Validation-Regeln, partial yaml, missing-required, unknown-fields-preserved
  - [ ] `reader.test.ts` — happy-path, malformed-yaml, missing-file, encoding
  - [ ] `repository.test.ts` — list, get, findByBridgeId, mtime-cache invalidation

## Phase B — Bridge-Interface

- [ ] **B.1** Neue Domain `src/domains/msp-bridges/`
  - [ ] `types.ts`:
    ```ts
    export type BridgeKind = 'tanss' | 'veeam' | 'sophos' | 'securepoint' | 'm365';
    export type BridgeResult<T> =
      | { kind: 'ok'; data: T }
      | { kind: 'unreachable'; message: string }
      | { kind: 'auth-failed'; message: string }
      | { kind: 'rate-limited'; retryAfterSec: number }
      | { kind: 'misconfigured'; message: string }   // missing customer.yaml bridge-ids
      | { kind: 'error'; message: string };
    export interface BridgeProbe<T> {
      readonly bridgeKind: BridgeKind;
      readonly customerSlug: string;
      readonly probedAt: string;
      readonly durationMs: number;
      readonly result: BridgeResult<T>;
    }
    export interface ReadBridge<TStatus> {
      readonly kind: BridgeKind;
      probe(customer: CustomerRecord): Promise<BridgeProbe<TStatus>>;
    }
    ```
  - [ ] `registry.ts` — Map+Register-Mechanismus für Bridges
  - [ ] `audit-wrapper.ts` — wraps any ReadBridge so jeder probe() Audit-Event schreibt
  - [ ] `index.ts` — Barrel
- [ ] **B.2** Reference-Implementation: `null-bridge.ts` als Test-Double (returnt immer ok mit empty payload)
- [ ] **B.3** Tests in `tests/domains/msp-bridges/`
  - [ ] `registry.test.ts` — register, get, list, double-register-error
  - [ ] `audit-wrapper.test.ts` — verifiziert dass jeder probe() ein bridge.read schreibt mit korrekten Details (customerSlug, bridgeKind, durationMs, result.kind, hashed-PII)

## Phase C — Sample-Customer + Doc

- [ ] **C.1** Sample-Customer-File für Tests + Demo: `docs/examples/customer-mueller-gmbh.yaml`
- [ ] **C.2** ADR-0038 — `docs/architecture/adr/0038-msp-bridges-foundation.md`
  - [ ] Context: Mike's KMU-Pattern + Health-Score-Vision
  - [ ] Decision: customer.yaml-Schema + Bridge-Interface + Audit-Wrapper-Pattern
  - [ ] Consequences: jede konkrete Bridge muss Schema-Felder dokumentieren, neue Bridges via Registry; YAML statt JSON für Human-Edit
  - [ ] Out-of-Scope: Write-Bridges (Phase 7-Z), Aggregat-Dashboard (7-E), Front-End (7-F)
- [ ] **C.3** User-Doku: `docs/customer-yaml-guide.md` (DE) — wie ein Customer-Workspace anlegen
- [ ] **C.4** README im neuen `src/domains/msp-bridges/`-Folder, der Schritt-für-Schritt erklärt wie eine neue Bridge implementiert wird (TANSS-Doku-URL pinning bereits in `roadmap-post-v1.7.md`)

## Phase D — Release

- [ ] **D.1** Version-Bump 1.8.0 → 1.8.1 (Patch — Foundation ohne neues User-Feature)
- [ ] **D.2** CHANGELOG [1.8.1]
- [ ] **D.3** PR mit allen 3 Phasen + Review-Sektion
- [ ] **D.4** Nach Merge: Tag v1.8.1 + Release-Note

---

## Was NICHT in 7-A

- Konkrete TANSS/Veeam/Sophos/Securepoint-Implementation (kommt in 7-B/C/D)
- Frontend-Page für Customer-Liste (kommt in 7-E)
- Customer-Health-Score-Berechnung (kommt in 7-E)
- Write-Endpoints (Phase 7-Z, mit Approval-Token-Flow)
- M365-Bridge (kommt zusammen mit 7-D oder als 7-D-zusatz)
- Veeam/Sophos-API-Auth-Token-Storage — wird in 7-B/C/D entschieden (vermutlich existierende secrets-Domain)

---

## Review-Sektion (nach Abschluss füllen)

- [ ] tsc clean
- [ ] biome clean
- [ ] Phase A tests grün (Customer-Repository)
- [ ] Phase B tests grün (Bridge-Interface + Registry + Audit-Wrapper)
- [ ] ADR-0038 + Customer-YAML-Guide gepushed
- [ ] Beispiel-customer.yaml lokal validiert
