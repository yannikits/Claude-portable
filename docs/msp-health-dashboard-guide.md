# MSP-Health Dashboard — Setup-Leitfaden

Stand: v1.9.0 (Phase 7-E, ADR-0041).

Aggregat-Dashboard über alle konfigurierten Read-Bridges × alle Customer.
Eine Tabelle, eine Zeile pro Customer, eine Spalte pro Bridge. Admin-only.

## Voraussetzungen

- claude-os v1.9.0 oder neuer
- Multi-User Stage 2 aktiviert (ADR-0036) — sonst kein Admin-Gate möglich
- `CLAUDE_OS_ADMIN_EMAILS` gesetzt (= dein Admin-Account)
- Mindestens eine Bridge konfiguriert:
  - **TANSS** (Phase 7-B): `CLAUDE_OS_TANSS_SERVER_URL` + `tanss/apiToken` secret
  - **Veeam** (Phase 7-C): mindestens ein Customer mit `bridges.veeam` +
    `veeam/<host>/{username,password}` secrets

Siehe `docs/tanss-bridge-guide.md` und `docs/veeam-bridge-guide.md` für die
Bridge-Setups.

## Aktivierung

Nichts zu klicken — wenn die Voraussetzungen erfüllt sind, registriert der
Server beim Boot automatisch alle konfigurierten Bridges und exponiert das
Dashboard. Konsolen-Output beim Start:

```
claude-os serve: Multi-User Stage 2 enabled (3 users)
claude-os serve: MSP-Health enabled (bridges=2, customers=14, cache-ttl=60s)
```

## Nutzung

1. Login als Admin
2. Sidebar → `MSP Health` (nur sichtbar für Admins)
3. Erste Seitenansicht triggert den ersten Probe-Pass — Loading-State
   ~5-15s je nach Bridge-Count und Customer-Count
4. Snapshot wird 60s gecached. Innerhalb dieser Zeit alle weiteren Aufrufe
   instant.
5. `↻ Refresh` invalidiert den Cache und triggert einen fresh Probe-Pass.

## Was bedeutet jede Zelle?

### TANSS-Zellen

| Zustand | Anzeige |
|---------|---------|
| `ok` | `N open / M total · last <date>` |
| `auth-failed` | rot · `auth-failed · HTTP 401` |
| `unreachable` | rot · `unreachable · ...` |
| `misconfigured` | gelb · `misconfigured · ...` |
| `—` (grau, dim) | Customer hat kein `bridges.tanss` in `customer.yaml` |

### Veeam-Zellen

| Zustand | Anzeige |
|---------|---------|
| `ok` | `X ok · Y warn · Z failed · W running` |
| `ok` + jobs renamed | wie oben `· N missing` (gelb!) |
| Fehler-Zustände | analog TANSS |

`missingJobs` ist der **wichtigste Indikator** in einer Veeam-Zelle:
ein Job aus `customer.yaml` der nicht (mehr) im VBR-Response auftaucht.
Häufigste Ursache: jemand hat den Job im Veeam-UI umbenannt — und
ohne diesen Indikator würdest du `ok` sehen obwohl ein konfigurierter
Backup-Job nicht mehr läuft.

## Drill-Down

Klick auf eine Zeile → expandiert inline mit dem rohen `BridgeProbe`-JSON
pro Bridge-Kind. Hilft beim Debug von kanten-Fällen (welcher exact-fehler,
was war der `durationMs`, welches sample-ticket, etc.).

Erneuter Klick → collapse.

## Performance + Cache

- Default-TTL: 60s. Override per `CLAUDE_OS_MSP_HEALTH_TTL_SEC=120` etc.
- Per-Bridge-Probe-Timeout: 10s (hart capped). Bridges die länger brauchen
  → cell wird `timeout`.
- Whole-Aggregate-Hard-Cap: 30s. Wenn das geknackt wird, restliche cells
  werden auch `timeout`.
- **Stampede-Protection:** 10 Admins drücken gleichzeitig Refresh →
  intern läuft genau EIN Probe-Pass. Alle bekommen dasselbe Resultat.

## Was wird ge-auditet?

Pro probed-Cell ein `bridge.read`-Event:

```json
{
  "kind": "bridge.read",
  "action": "bridge.<vendor>.probe",
  "tenant": "<customer-slug>",
  "outcome": "ok|denied|error",
  "details": {
    "bridgeKind": "tanss|veeam",
    "customerSlug": "...",
    "resultKind": "ok|...",
    "durationMs": 247
  }
}
```

**Niemals** im Audit: API-Bodies, Sample-Tickets, Job-Namen, Tokens,
Credentials. Nur Counts + Kind + Slug + Duration.

Du kannst die Probe-Aktivität live im `Audit-Log`-Dashboard verfolgen —
filter auf `kind=bridge.read`.

## Was kann schiefgehen?

| Symptom | Bedeutung | Fix |
|---------|-----------|-----|
| Nav-Entry "MSP Health" fehlt | Nicht-Admin | Email zur `CLAUDE_OS_ADMIN_EMAILS`-Liste hinzufügen |
| 401 auf `/api/msp-health/rows` | Cookie-Auth abgelaufen | Logout + Login |
| 403 auf `/api/msp-health/rows` | Nicht-Admin (siehe oben) | Adminliste prüfen |
| Tabelle leer „Keine Customer-Workspaces gefunden" | Vault hat keinen `msp-customers/<slug>/`-Folder | Customer-Workspace anlegen (`docs/customer-yaml-guide.md`) |
| Alle Zellen `—` | Bridge nicht registered (env / customer.yaml fehlt) | `claude-os doctor` checken |
| Erstes Laden dauert > 20s | Bridge hängt | Per-Bridge Doctor-Check + CLI-Smoke-Test |
| Cache Age stuck auf > 5min | TTL hoch, Browser cached vermutlich | Hard-Refresh (Cmd-Shift-R) |
| `↻ Refresh` zeigt 500 | Bridge-Bootstrap-Fehler | Server-Logs `claude-os serve:` Zeile prüfen |

## Was als Nächstes kommt

- Phase 7-D (Sophos, Securepoint) — zusätzliche Spalten in der Tabelle
- Phase 7-E.1 — Auto-Refresh-Polling, Pagination, Audit-Drill-Down-Link

Bis dahin: ein Klick, alle Customer in einem Blick.
