# Audit-Trail-Dashboard — User-Guide

Stand: 2026-05-29 (v1.8.0) · Zielgruppe: Admin-User (Email in `CLAUDE_OS_ADMIN_EMAILS`).

Die `/audit`-Page zeigt **alle Events** die Claude-OS in seinen JSONL-Files unter `<dataDir>/audit/` aufzeichnet. Read-Only — kein Eingriff in die Files möglich.

---

## Wer sieht die Page

Sichtbar nur für Admins (Email exakt in der env-var `CLAUDE_OS_ADMIN_EMAILS` der Docker-Compose). Nicht-Admins sehen weder den Nav-Entry noch die Route — Direktaufruf von `/audit` ergibt 404 in der Sidebar-Navigation und 403 auf API-Ebene.

---

## Layout

```
─────────────────────────────────────────────────────────
  AUDIT-LOG                                  [Workspace ▾]
─────────────────────────────────────────────────────────
  [42 auth.login.success] [12 note.write] … Total · 54
─────────────────────────────────────────────────────────
  Range: [Heute ▾]  Workspace: […]  Tenant: […]  Outcome: [alle ▾]
  Action ⊆ […]                              [Refresh] [CSV] [JSONL]

  ▸ Kinds (alle)

  ┌─Time (UTC)─────────┬─Kind──────────┬─Action───┬─...──┐
  │ 2026-05-29T18:14:… │ auth.login.s. │ login    │ …    │
  │ 2026-05-29T17:55:… │ note.write    │ save     │ …    │
  │ …                                                    │
  └──────────────────────────────────────────────────────┘

  1–50 von 54   [← Prev] [Next →]   Pro Seite [50 ▾]
```

---

## Filter

| Filter | Wirkung |
|--------|---------|
| **Range** | Heute / 7 Tage / 30 Tage / Custom (mit datetime-Pickern) |
| **Workspace** | Exakter Match — z. B. `personal`, `msp-customers/mueller` |
| **Tenant** | Exakter Tenant-ID-Match — bei Customer-Workspaces der Customer-Slug |
| **Outcome** | `ok` (success), `denied` (policy-block), `error` (unexpected) |
| **Action ⊆** | Substring (case-insensitive) im `action`-Feld (z. B. "tanss" findet alle TANSS-Aktionen) |
| **Kinds** | Expandable Liste der 17 Event-Kinds — Multi-Select |

Filter kombinieren sich mit AND. Empty = "keine Einschränkung in diesem Feld".

### Range-Verhalten

Range-Default ist **heute (UTC)** — der Operator landet auf "was passierte gerade". Für Custom-Range datetime-local Pickers; die UI hängt automatisch `:00Z` ans Ende für UTC-Behandlung.

---

## Stats-Strip

Zeigt **Counts pro Event-Kind** im gewählten Zeitfenster — sortiert nach Häufigkeit absteigend. Bewusst **ignoriert** alle Non-Range-Filter, damit der Operator zuerst sieht was es überhaupt gibt, bevor er drilldown'd.

---

## Pagination

- Default **50 Events pro Seite**
- Max 500 (Backend-Cap)
- "1–50 von 234" — Operator sieht sofort wie viele Treffer der Filter hat

---

## Export

Zwei Buttons rechts neben Refresh:

### CSV
RFC-4180-konform. Felder: `at, kind, action, workspace, tenant, outcome, pid, hostname, schema_version, details_json`. `details` wird als JSON-String in einer Zelle eingebettet — Excel/LibreOffice können das öffnen.

**Hard-Cap:** Wenn der Filter mehr als 50.000 Events matcht, refused der Backend mit HTTP 413 + Fehlermeldung "narrow your filter". Lösung: kürzere Time-Range oder konkretes Kind.

**Use-Case:** DSGVO-Auskunfts-Übergabe. Customer fragt "welche Events betreffen meinen User?" → Filter auf `actionContains` mit dem User-Email-Hash + Range `30d` → CSV → archivieren.

### JSONL
Original-Schema, eine Zeile pro Event, JSON-Object. Für programmatisches Re-Import oder Backup.

---

## Häufige Workflows

### DSGVO-Auskunft eines Users
1. Range: 30 Tage
2. Action ⊆: leer (alle Aktionen)
3. (Optional) Workspace: `personal` wenn nur die persönliche Aktivität
4. Refresh → Counts ansehen
5. CSV-Export → an Customer übergeben

> **Hinweis:** Email-Adressen werden im Audit-Log als SHA-256-Hash-Präfix gespeichert (per SECURITY.md §4). Du musst den Hash aus dem `details.emailHash`-Feld korrelieren — nicht den Klartext. Für eine offizielle Auskunft ist das ausreichend (es zeigt: "dieser User hat zu diesen Zeitpunkten interagiert").

### Investigation: Wer hat den Workspace gewechselt?
1. Range: gewünschtes Fenster (z. B. gestern + heute)
2. Kinds: nur `workspace.switch`
3. Refresh → User + Zeitpunkt + Workspace-Pfad in den Details

### Coverage-Sanity: Was wird überhaupt geloggt?
1. Range: 7 Tage
2. Alle Filter leer
3. Refresh → Stats-Strip zeigt Verteilung pro Kind
4. Wenn ein Kind das du erwartest (z. B. `bridge.write`) fehlt → Coverage-Gap, Issue aufmachen

---

## Sicherheits-Notes

- **Audit-Files sind die single source of truth** für Compliance. Die Web-UI ist Read-Only — Operator kann die Files nicht über die Page ändern.
- **Backend hat keinen Write-Pfad zu den Files außer dem AuditLogger.** Selbst ein bösartiges Frontend könnte nichts schreiben.
- **Backup-Strategie:** rsync vom Volume-Mount auf NAS reicht. Audit-Files überleben Container-Restart per Standard-Volume.
- **Retention:** läuft per `src/core/audit/retention.ts` — default 90 Tage. Älter wird beim Daemon-Start gepruned. Customize via `CLAUDE_OS_AUDIT_RETENTION_DAYS` env.

---

## Hard-Limits

- **Backend-Pagination-Cap:** 500 Events/Page
- **Backend-Export-Cap:** 50.000 Events pro Export — größer ⇒ 413 + "narrow filter"
- **Time-Range:** unbegrenzt — Operator's Verantwortung bei Multi-Monat-Queries (RAM-Footprint linear)
- **Concurrent-Write-Verhalten:** Reader ist tolerant gegen partial tail-line wenn AuditLogger gerade schreibt — überspringt malformed lines silently

---

## Troubleshooting

### "no entries" obwohl heute Events passieren
- Time-Range prüfen — Default ist UTC, deine lokale Zeit könnte schon ein Tag weiter sein
- Outcome-Filter prüfen — manche Events sind nur `denied` oder `error`

### "403 forbidden" beim Admin-User
- `CLAUDE_OS_ADMIN_EMAILS` muss die Email **exakt** + lowercased enthalten
- Container-Restart nötig nach env-var-Änderung
- Browser hart neu laden — `/me`-Cache könnte alten isAdmin-Wert haben

### Export liefert leeres File
- Filter matcht 0 Events → CSV hat nur Header-Zeile (richtig). Range erweitern.
