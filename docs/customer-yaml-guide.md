# `customer.yaml` — Leitfaden

Diese Datei beschreibt einen MSP-Customer im Vault. Sie liegt unter
`<vaultRoot>/workspaces/msp-customers/<slug>/customer.yaml` und wird vom
Customer-Repository (Phase 7-A, ADR-0038) gelesen.

## Wofür

- Stabile Identität pro Customer (`slug`) — matched den Workspace-Pfad
- Bridge-Identifier (TANSS-Customer-ID, Veeam-Job-Namen, …) für Phase-7-B+-Bridges
- Lightweight-Metadaten für Such-/Filter-Workflows (`tags`, `notes`)

**Was NICHT reingehört:** API-Tokens, Passwörter, Secrets. Diese gehen in
den Secrets-Backend (Keyring lokal, env in Compose-Mode). Die `customer.yaml`
enthält nur **Identifier**, mit denen die Bridge sich den Token holt.

## Minimal-Beispiel

```yaml
slug: mueller-gmbh
displayName: Müller GmbH
```

Das reicht. Alle anderen Felder sind optional und werden hinzugefügt, sobald
eine Bridge sie braucht.

## Vollständiges Beispiel

```yaml
slug: mueller-gmbh
displayName: Müller GmbH

contact:
  email: it@mueller-gmbh.de
  phone: "+49 30 1234 5678"
  primaryUser: Frau Schmitt

bridges:
  tanss:
    customerId: 42

  veeam:
    serverHostname: backup.mueller.local
    jobNames:
      - daily-fileserver
      - weekly-domaincontroller
      - hourly-exchange

  sophos:
    centralCustomerId: 8a7b6c5d-1234-5678-90ab-cdef12345678
    firewallHostname: fw01.mueller.local

  securepoint:
    deviceId: SP-MUELLER-01

  m365:
    tenantId: contoso-mueller.onmicrosoft.com

tags:
  - sla-gold
  - backup-heavy
  - office-berlin

notes: |
  Backup-Fenster: 22:00–04:00.
  Firewall-Update-Termine immer mit Frau Schmitt absprechen.
```

## Feld-Referenz

### `slug` (Pflicht)
- Regex: `[a-z0-9][a-z0-9-]*`, max 64 Zeichen
- Muss exakt dem Verzeichnisnamen unter `msp-customers/` entsprechen
- Immutable — Slug-Änderung = Workspace-Migration

### `displayName` (Pflicht)
- Beliebiger UTF-8-String
- Wird in CLI-Output und Dashboard angezeigt

### `contact` (optional)
- `email` — Customer-Hauptkontakt (für DSGVO-Auskünfte relevant)
- `phone` — frei formatiert
- `primaryUser` — Name der Ansprechperson

### `bridges` (optional)
Pro Bridge-Kind ein Identifier-Bag. **Nur** Identifier, **nie** Tokens:

| Kind | Felder | Quelle |
|------|--------|--------|
| `tanss` | `customerId: number` | TANSS-UI → Customer-Detail |
| `veeam` | `serverHostname?`, `jobNames: string[]` | Backup-Server + Job-Console |
| `sophos` | `centralCustomerId?`, `firewallHostname?` | Sophos Central oder XG/XGS |
| `securepoint` | `deviceId: string` | Securepoint-UTM-Console |
| `m365` | `tenantId: string` | Azure Portal → Tenant-Properties |

Tippfehler (z.B. `tansss` statt `tanss`) werden früh abgelehnt — die
ganze Datei lädt dann nicht. Das ist Absicht: stille Konfig-Drift ist
in MSP-Setups das größte Risiko.

### `tags` (optional)
- `string[]`, frei wählbar
- Konventionen (informell): `sla-gold`, `sla-silver`, `backup-heavy`, `office-<stadt>`

### `notes` (optional)
- Multiline-String
- Operative Hinweise — Backup-Fenster, Ansprechpartner-Verfügbarkeit, etc.
- **Keine** Tokens, **keine** Passwörter, **keine** sensitiven Customer-Daten

### `extras` (Forward-Compat)
Unbekannte Top-Level-Keys werden automatisch in `extras` abgelegt und
bleiben beim Round-Trip erhalten. Wenn eine neuere claude-os-Version ein
Feld hinzufügt (z.B. `slaTier`), funktioniert die alte Version weiter —
das Feld erscheint dort als `extras.slaTier`.

## Datei-Modus

`0o644` — explizit nicht-secret. Wird im Vault eingecheckt (per Workspace-Policy),
geht durch Git-Diffs. Wer Tokens in eine `customer.yaml` schreibt, hat die
Architektur missverstanden.

## Auto-Create

Wer per CLI oder Dashboard einen neuen Workspace anlegt
(`msp-customers/<slug>/`), bekommt automatisch eine minimale `customer.yaml`
mit nur `slug` + `displayName: <slug>`. Felder werden inkrementell ergänzt,
sobald Bridges hinzukommen.

## Verwandte Dokumente

- ADR-0027 — MSP-Bridge Permission-Modell
- ADR-0031 — Vault-Multi-Workspace
- ADR-0038 — MSP-Health-Foundation
- `src/domains/msp-bridges/README.md` — Implementierer-Leitfaden für neue Bridges
