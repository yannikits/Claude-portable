# Veeam Read-Bridge — Setup-Leitfaden

Stand: v1.8.3 (Phase 7-C, ADR-0040).

Die Veeam Read-Bridge fragt pro Customer einen kompakten Backup-Health-Snapshot
vom Veeam Backup & Replication-Server **vor Ort** ab: wie viele Jobs sind ok,
warning, failed, running, neuester erfolgreicher Backup-Zeitpunkt, ältester
problematischer, und welche im `customer.yaml` konfigurierten Jobs **nicht
mehr existieren** (Job-Rename-Detection).

Sie macht **nichts** schreibendes — startet keine Jobs, ändert keine Settings.

## Voraussetzungen

- Veeam Backup & Replication v12+ (REST API enabled, Default-Port 9419)
- claude-os erreicht den VBR per VPN/MPLS
- Service-User in Veeam mit Read-Berechtigung auf Backup-Sessions
- claude-os v1.8.3 oder neuer

## Setup in drei Schritten

### 1. Customer-Workspace mit Veeam-IDs anlegen

`vault/workspaces/msp-customers/mueller-gmbh/customer.yaml`:

```yaml
slug: mueller-gmbh
displayName: Müller GmbH

bridges:
  veeam:
    serverHostname: vbr.mueller.local      # Pflicht — der VBR-Host
    serverPort: 9419                       # optional — Default 9419
    jobNames:                              # optional — wenn leer: alle Jobs
      - daily-fileserver
      - weekly-dc
      - hourly-exchange
```

Wenn dieser VBR **nur** Müller-Jobs hat: `jobNames` weglassen, dann probt
claude-os einfach alle Jobs auf dem Server.

Wenn der VBR **mehrere** Kunden mischt: `jobNames` setzen, dann werden nur
die hier genannten Jobs in den Status gerechnet, und Rename-Detection
warnt wenn einer davon im VBR verschwindet.

### 2. Credentials im Secrets-Backend ablegen

Pro VBR-Hostname (Schlüssel-Pattern `veeam/<hostname>/...`):

```bash
claude-os secrets set veeam/vbr.mueller.local/username svc-claude
claude-os secrets set veeam/vbr.mueller.local/password <password>
```

Mehrere Customer-Workspaces können denselben VBR teilen — die Creds
gelten pro Hostname, nicht pro Customer-Slug.

### 3. Optional: TLS-Verhalten + API-Version

Veeam liefert per Default ein **self-signed Cert** aus. Wenn du das so
beibehältst (üblich für on-prem VBR):

```env
CLAUDE_OS_VEEAM_INSECURE_TLS=1
```

oder pro CLI-Invocation: `--insecure-tls`.

Falls dein VBR auf einer anderen API-Version läuft als `1.1-rev1`
(Default seit v1.8.3):

```env
CLAUDE_OS_VEEAM_API_VERSION=1.2-rev0
```

oder pro CLI-Invocation: `--api-version 1.2-rev0`.

## Verification

```bash
claude-os doctor
```

Erwartete Zeile (wenn 1 Veeam-Customer konfiguriert + Creds da):

```
[OK]   veeam-config — Veeam configured for 1 host(s)
```

Wenn die Creds noch fehlen:

```
[WARN] veeam-config — Veeam credentials missing for 1 of 1 host(s)
       vbr.mueller.local
       Hint: Run: claude-os secrets set veeam/<host>/username <user> AND
             veeam/<host>/password <pwd> for each
```

Dann der Smoke-Test:

```bash
claude-os msp probe veeam mueller-gmbh --insecure-tls
```

Erwartete Ausgabe:

```
[OK] veeam.probe mueller-gmbh
  bridgeKind=veeam  durationMs=347
  result.kind=ok
  knownJobs=3  ok=2  warn=0  failed=0  running=1
  newestSuccessAt=2026-05-29T03:12:44.000Z
  oldestUnsuccessfulAt=(none)
    [running] hourly-exchange  endTimeUtc=(none)
    [ok] daily-fileserver  endTimeUtc=2026-05-29T03:12:44.000Z
    [ok] weekly-dc  endTimeUtc=2026-05-28T04:01:18.000Z
```

Mit `--json` bekommst du das volle `BridgeProbe`-Objekt für Machine-Konsumenten.

## Was kann schiefgehen?

| Symptom | Bedeutung | Fix |
|---------|-----------|-----|
| `result.kind=misconfigured` + „has no bridges.veeam section" | `customer.yaml` fehlt der `bridges.veeam`-Block | `serverHostname` + Jobs ergänzen |
| `result.kind=auth-failed` + „no credentials in secrets-backend" | Keine `veeam/<host>/{username,password}` im Store | `claude-os secrets set` für beide |
| `result.kind=auth-failed` + „HTTP 401" | Credentials falsch in Veeam | Passwort im Veeam-UI prüfen, neu setten |
| `result.kind=unreachable` + „UNABLE_TO_VERIFY_LEAF_SIGNATURE" | Self-signed Cert ohne `--insecure-tls` | `CLAUDE_OS_VEEAM_INSECURE_TLS=1` setzen oder `--insecure-tls` |
| `result.kind=unreachable` + „ECONNREFUSED" | VBR nicht erreichbar (Firewall/VPN/Port) | VBR-Erreichbarkeit auf Port 9419 prüfen |
| `result.kind=misconfigured` + „api-version not supported" | claude-os schickt eine Version die dein VBR nicht spricht | `CLAUDE_OS_VEEAM_API_VERSION` auf die VBR-Version setzen |
| `result.data.missingJobs` ist nicht-leer | Job-Names in customer.yaml existieren nicht (mehr) im VBR | Im Veeam-UI prüfen ob Job umbenannt/gelöscht, `customer.yaml` aktualisieren |
| `result.data.failedCount > 0` | Backup-Job ist tatsächlich kaputt | Im Veeam-UI debuggen (claude-os ist nur read-only) |

## Audit-Trail

Pro Probe ein `bridge.read`-Event:

```json
{
  "kind": "bridge.read",
  "action": "bridge.veeam.probe",
  "tenant": "mueller-gmbh",
  "outcome": "ok",
  "details": {
    "bridgeKind": "veeam",
    "customerSlug": "mueller-gmbh",
    "resultKind": "ok",
    "durationMs": 347
  }
}
```

**Kein** Username, **kein** Password, **kein** Token, **kein** Job-Name.
Counts/Slug/Kind only — same Privacy-Profile wie TANSS (siehe ADR-0038).

## Per-Customer VBR — warum?

Anders als TANSS (ein zentraler Server pro MSP) gehen wir bei Veeam von
**per-Customer-VBR** aus. Die Begründung:

- Veeam-Backup-Daten verlassen den Kundenstandort oft nicht (Datenschutz, SLA)
- Restore-Performance ist on-premise besser
- Mehrere Customer auf einem VBR wären für die Restore-Berechtigungen aufwendig

Wenn dein Setup einen **zentralen** VBR fährt: das geht auch — du setzt
`serverHostname` einfach für alle Customer auf denselben Hostname (z.B.
`backup.die-its.digital`). Die Bridge erkennt das automatisch und teilt sich
einen einzigen OAuth-Login über alle Customer-Probes.

## Was als Nächstes kommt

- **Phase 7-D** — Sophos Central + Securepoint (gleiches Bridge-Pattern)
- **Phase 7-E** — Aggregat-Dashboard: alle Bridges parallel über alle Customer
  geprobt, ein Gesamtbild pro Customer + MSP-weiter Drill-Down

Bis dahin kannst du die Veeam-Bridge per CLI-Smoke-Test ausprobieren —
und das Audit-Trail-Dashboard (v1.8.0) zeigt dir die Probe-Events bereits
strukturiert.
