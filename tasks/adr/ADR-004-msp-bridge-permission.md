# ADR-004: MSP-Bridge Permission-Modell

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

MSP-Bridges (TANSS, NinjaOne, Veeam, M365, Securepoint) berühren Customer-Infrastruktur. Falsche Calls können:
- Customer-Tickets falsch updaten
- Backup-Jobs unbeabsichtigt triggern/stoppen
- Mails versenden
- Firewall-Regeln ändern

Das ist haftungsrelevant und Reputationsrisiko.

## Entscheidung

**Zwei-Phasen-Modell mit hartem Gate dazwischen.**

### Phase 6 — Read-Only

- Pro Bridge: dedizierter Read-Only-Service-Account beim Anbieter angelegt
- API-Calls per `TypeBox`-validierte Schemas — kein freies String-Konkat in URLs
- Audit-Log-Eintrag pro Call (Bridge, Endpoint, HTTP-Status, Customer-ID)
- Rate-Limiting pro Bridge: 60 Calls/Minute default
- Bridge-Results niemals im Vault gecached — ephemeral, nur in laufender Session
- Schema-Failure (unbekannte Felder, fehlende Pflichtfelder) → Call abbrechen, kein silent ignore

### Phase 7 — Write (separat freigegeben pro Bridge)

Vor jedem Write:
1. Dry-Run gegen API (wenn unterstützt) oder Schema-Validation
2. GUI-Approval-Prompt mit Diff-Anzeige (vorher/nachher)
3. Approval-Token + Yannik-Signatur (Ed25519 aus Keyring) ins Audit-Log
4. Tatsächlicher Write
5. Rollback-Token zurückgeben, falls API unterstützt (TANSS: ja, NinjaOne: teilweise, Veeam: oft nein → dann zusätzliche Confirm-Stufe)

**Niemals:**
- Auto-Approve ohne menschliches OK
- Batch-Writes ohne pro-Item-Confirm
- Schreiben in Tenants, deren Workspace nicht aktiv ist
- Write-Operation aus Sandbox-Context

### Tenant-Isolation

Verzahnt mit ADR-008 (Multi-Workspace):
- Vault-Workspace `msp-customers/<customer-id>/` ist aktiv → Bridge-Call darf Customer berühren
- `personal/` aktiv → Bridge-Call MIT customer-id ist Fehler, wird abgewiesen
- FTS-Query immer `WHERE workspace = ? AND tenant = ?`

## Konsequenzen

- Phase 6 lieferbar binnen 1-2 Wochen pro Bridge (Read-Only ist mechanisch)
- Phase 7 pro Bridge: 1-2 Wochen, plus 1 Woche Live-Beobachtung Dry-Run vor First-Write
- GUI-Approval-Flow ist nicht trivial — eigenes Sub-Projekt
- MSP-Bridge-Code liegt in **separates Private-Repo** (`yannikits/claude-os-msp`), siehe ADR-007

## Alternativen erwogen

- **Sofort Write-fähig mit "vorsichtigem" Prompt:** verworfen — Prompt-Sicherheit reicht nicht
- **Manuelle CLI-Confirms statt GUI:** als Übergangslösung OK; finale Lösung ist GUI mit Diff-Render
