# ADR-0027 — MSP-Bridge Permission-Modell

**Status:** Akzeptiert
**Datum:** 2026-05-24
**Bedingt durch:** Spec-Split (PR #123) — MSP-Phase braucht Trust-Model vor jeder Bridge-Implementation

## Kontext

MSP-Bridges (TANSS, NinjaOne, Veeam, M365, Securepoint) berühren Customer-Infrastruktur. Falsche Calls können:

- Customer-Tickets falsch updaten oder schließen
- Backup-Jobs unbeabsichtigt triggern/stoppen
- Mails versenden
- Firewall-Regeln ändern

Das ist haftungsrelevant und Reputationsrisiko. Die existierenden ADRs decken Anthropic-Auth (ADR-0011) und MCP-Trust (ADR-0024), aber keine MSP-spezifischen Operations.

## Entscheidung

**Zwei-Phasen-Modell mit hartem Gate dazwischen.**

### Phase 6 — Read-Only

- Pro Bridge: dedizierter Read-Only-Service-Account beim Anbieter angelegt
- API-Calls per `TypeBox`-validierte Schemas (ADR-0012) — kein freies String-Konkat in URLs
- Audit-Log-Eintrag pro Call (Bridge, Endpoint, HTTP-Status, Customer-ID)
- Rate-Limiting pro Bridge: 60 Calls/Minute default, konfigurierbar
- Bridge-Results niemals im Vault gecached — ephemeral, nur in laufender Session
- Schema-Failure (unbekannte Felder, fehlende Pflichtfelder) → Call abbrechen, kein silent ignore

### Phase 7 — Write (separat freigegeben pro Bridge)

Vor jedem Write:

1. Dry-Run gegen API (wenn unterstützt) oder Schema-Validation
2. Tauri-GUI-Approval-Prompt mit Diff-Anzeige (analog ADR-0024 MCP-Trust-Modal)
3. Approval-Token + Yannik-Signatur (Ed25519 aus Keyring, ADR-0004) ins Audit-Log
4. Tatsächlicher Write
5. Rollback-Token zurückgeben, falls API unterstützt (TANSS: ja, NinjaOne: teilweise, Veeam: oft nein → zusätzliche Confirm-Stufe)

**Niemals:**

- Auto-Approve ohne menschliches OK
- Batch-Writes ohne pro-Item-Confirm
- Schreiben in Tenants, deren Workspace nicht aktiv ist (ADR-0031)
- Write-Operation aus Sandbox-Context (ADR-0026 quarantined-Skills)

### Tenant-Isolation

Verzahnt mit ADR-0031 (Multi-Workspace):

- Vault-Workspace `msp-customers/<customer-id>/` aktiv → Bridge-Call darf Customer berühren
- `personal/` aktiv → Bridge-Call mit customer-id ist Fehler, wird abgewiesen
- FTS-Query in den Bridges immer `WHERE workspace = ? AND tenant = ?`

### Repo-Lokalisierung

Bridge-Code liegt **NICHT** im Public-Repo `Claude-portable`, sondern im privaten `claude-os-msp` (siehe ADR-0030). Bridges registrieren sich beim Core via MCP-Tool-Registry (ADR-0007 / ADR-0016) — Plugin-Pattern, keine Build-Time-Abhängigkeit.

## Konsequenzen

**Positiv**

- Phase 6 lieferbar binnen 1-2 Wochen pro Bridge (Read-Only ist mechanisch)
- Klare Trust-Boundary: Core-Repo enthält nichts MSP-Spezifisches
- Customer-Daten sind doppelt geschützt (Workspace-Filter + Tenant-Header)
- DSGVO-Behandlung wird einheitlich in `claude-os-msp` umgesetzt

**Negativ**

- Phase 7 pro Bridge braucht eigene GUI-Approval-Flows
- Approval-Friction für Yannik (kein „Lights-out"-Automation für MSP-Writes)
- Dual-Repo-Setup erhöht Setup-Komplexität für etwaige zukünftige Team-Mitarbeiter

## Alternativen verworfen

- **Sofort Write-fähig mit „vorsichtigem" Prompt:** Prompt-Sicherheit reicht nicht
- **MSP-Code im Public-Repo:** Customer-Konfigurationen niemals public
- **Manuelle CLI-Confirms statt GUI:** als Übergangslösung OK; finale Lösung ist GUI mit Diff-Render

## Quellen

- ADR-0004 (Keyring für Signaturen)
- ADR-0011 (Anthropic-Auth — Pattern für Service-Account-Trennung)
- ADR-0012 (TypeBox-Validation)
- ADR-0024 (MCP-Trust-Prompt — Approval-UX-Vorbild)
- ADR-0030 (Repo-Strategie — Private MSP-Repo)
- ADR-0031 (Multi-Workspace)
- SECURITY.md §6 (MSP-Bridges)
