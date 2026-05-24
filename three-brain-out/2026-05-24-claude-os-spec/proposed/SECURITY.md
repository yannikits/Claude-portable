# Claude OS — Security & Trust

**Status:** Pflicht-Read vor jeder Arbeit an MSP-Bridges, Self-Improving-Skills oder Secrets-Handling. Verbindlich bei Konflikt mit `CLAUDE.md` / `ARCHITECTURE.md`, soweit Sicherheit betroffen ist.

## 1. Threat-Model (kurz)

| Threat | Wer | Wo | Mitigation |
|---|---|---|---|
| Prompt-Injection über Vault-Notes | externer Inhalt im Vault | Memory-Retrieval | Frontmatter-`classification` respektieren, untrusted Inhalte markieren, niemals direkt als Instruction interpretieren |
| Prompt-Injection über MSP-API-Responses | Customer-System-Daten | MCP-Tool-Returns | API-Response als Daten, nie als Instruction; Schema-Validation Pflicht |
| Datenleck aus Customer-Daten in LLM-Provider | TANSS-Tickets, M365-Mails | Provider-Call | Klassifikation `customer-confidential` → Provider-Allowlist, Redaction-Hook vor Send |
| Self-improving Skill exfiltriert Daten | LLM-generierter Skill | Skill-Auto-Promotion | Sandbox vor Aktivierung, Yannik-Review-Gate, Code-Diff anzeigen |
| Compromised npm-Dependency | Supply-Chain | `npm install` | Lockfile-Pinning, `npm audit` in CI, Renovate für kontrollierte Updates |
| Vault-Datei korrumpiert | filesystem-Fehler / OneDrive-Sync-Konflikt | `vault-sync` | Frontmatter-Validation, Konflikt-Notes als `*.conflict.md` separieren, nicht überschreiben |
| MSP-Bridge zerstört Customer-Daten | versehentlicher Write | Phase 7 Write-Pfad | Approval-Gate, Rollback-Tokens, Dry-Run-Modus Default |

## 2. Data-Classification (Pflicht-Frontmatter `classification:`)

| Klasse | Beispiele | Erlaubt im Provider-Call? | Logging |
|---|---|---|---|
| `public` | Open-Source-Snippets, Doku-Auszüge | ja | normal |
| `personal` | Yanniks Notizen, House-Watch | ja (Anthropic, nicht beliebige Free-Tier-Provider) | normal |
| `operational` | Repo-interne Configs, ADRs | ja | normal |
| `customer-confidential` | TANSS-Tickets, Kunden-Doku, NinjaOne-Inventar | **nein** ohne Redaction; bei Bedarf nur über Provider-Allowlist + Redaction-Hook | mit Audit-Eintrag |
| `secret` | API-Keys, Passwords, Tokens | **nie** im Prompt | nur Hash im Log |
| `ephemeral` | Session-Transkripte, in-flight Daten | nein für Long-Term-Storage | rotierender Log |

Bei fehlender Klassifizierung im Frontmatter: **als `customer-confidential` behandeln**, bis explizit anders klassifiziert (fail-safe Default).

## 3. Secrets-Handling

### 3.1 Storage
- **Primary:** NAPI-RS Keyring (OS-Keychain — Windows Credential Manager, macOS Keychain)
- **Secondary (Dev only):** `.env`-Files, **niemals** committed (`.gitignore` enforce)
- **Niemals:** Plain-Text-Configs im Vault, im Code, in Logs

### 3.2 Scopes
- Anthropic-API-Key: 1 Key, full scope (kein Sub-Scope verfügbar)
- TANSS/NinjaOne/Veeam/M365: **separater Read-Only-User pro Service** bei der Erstanlage, Write-User nur bei Phase 7 freigeschaltet
- M365: Application-Permissions minimal-scoped (z. B. `Mail.Read` statt `Mail.ReadWrite`)

### 3.3 Rotation
- Jeder Provider/Bridge muss Token-Rotation unterstützen ohne Service-Restart
- Bei Verdacht auf Compromise: sofort revoken, neuen Token via Keyring setzen
- Audit-Log enthält Token-Hash (erste 8 Zeichen), nie den Token selbst

### 3.4 Redaction
Vor jedem Provider-Call läuft Redaction-Hook:
- Strings, die wie API-Keys aussehen (Patterns für AWS, Anthropic, Stripe, JWT) → ersetzt durch `[REDACTED:type]`
- E-Mail-Adressen in `customer-confidential` → ersetzt durch `[REDACTED:email]`
- Logging: redacted-Form, nie Original

## 4. Audit-Log

### 4.1 Was wird geloggt
Jeder dieser Events erzeugt einen Audit-Log-Eintrag:
- Provider-Call (Modell, Token-Counts, Tool-Calls, Approval-Status)
- MSP-Tool-Aufruf (Bridge, Endpoint, HTTP-Status, Customer-ID falls vorhanden)
- Skill-Loading (Skill-Name, Version, Source)
- Self-improving-Skill-Approval (vorher/nachher Diff-Hash, Yannik-Signatur)
- Secrets-Access (Service, Operation: read/write/delete, NIE der Token selbst)
- Vault-Mutation (path, classification, operation)

### 4.2 Format (Vorschlag)
```jsonl
{"ts":"2026-05-24T03:25:00Z","event":"provider_call","model":"<from-config>","tokens_in":1234,"tokens_out":567,"tool_calls":["vault_search"],"approval":"auto","correlation_id":"uuid"}
```

### 4.3 Aufbewahrung
- Audit-Log unter `<config>/audit/YYYY-MM/audit.jsonl`
- Append-only — kein Edit, kein Delete (außer Retention-Cleanup)
- Retention: 90 Tage default, konfigurierbar bis 7 Jahre (DSGVO MSP-Kontext)
- Rotation: monatlich, gzip-Archive

## 5. Self-Improving Skills (kritischer Pfad)

Erlaubt erst nach ADR-003. Bis dahin: nicht aktivieren.

### 5.1 Lifecycle (geplant)
```
draft → quarantined → reviewed → active → deprecated → disabled
```

- **draft:** Auto-generiert aus Lessons. Nicht ladbar.
- **quarantined:** Im Sandbox-Workspace. Read-only-Test ausführbar.
- **reviewed:** Yannik hat den Diff gesehen und freigegeben.
- **active:** Im normalen Skill-Loader.
- **deprecated:** Hinweis bei Nutzung, aber noch ladbar.
- **disabled:** Nicht ladbar, bleibt im Repo zur Forensik.

### 5.2 Review-Gate
- Diff vorher/nachher als Side-by-Side in der GUI
- Yannik-Signatur (lokaler Ed25519-Key, in Keyring) → Audit-Log
- Bei `customer-confidential`-Touchpoint: zusätzlicher Confirm

### 5.3 Sandbox
- Quarantined-Skills laufen in eigenem Process mit:
  - kein Filesystem-Schreibzugriff außer `<sandbox>/`
  - keine Netzwerk-Calls außer explicit-allowlist
  - kein Zugriff auf `customer-confidential`-Notes
  - Timeout 30s pro Tool-Call

## 6. MSP-Bridges (Phase 6 + 7)

### 6.1 Read-Only-Phase (Phase 6)
- Pro Bridge: dedizierter Read-Only-Service-Account
- Schema-Validation jeder API-Response (TypeBox)
- Audit-Log-Eintrag pro Call
- Rate-Limiting pro Bridge (Default: 60 Calls/min)
- **Kein Cache von Customer-Daten im Vault** — Bridge-Results sind ephemeral, nur in der laufenden Session

### 6.2 Write-Phase (Phase 7) — Approval-Gate
Vor jeder Write-Operation:
1. Dry-Run gegen API (wenn unterstützt) oder Schema-Validation
2. User-Approval-Prompt in der GUI mit Diff-Anzeige (vorher/nachher)
3. Approval-Token in Audit-Log + Yannik-Signatur
4. Erst dann tatsächlicher Write
5. Rollback-Token zurückgeben, falls API unterstützt (TANSS: ja, NinjaOne: teilweise)

### 6.3 Tenant-Isolation
- Jeder Customer hat eigenen Workspace-Context (`workspace/msp-<customer-id>/`)
- Vault-Notes mit `tenant: <customer-id>`-Frontmatter
- Bridge-Calls signen mit Tenant-Header
- Memory-Injection filtert per Tenant — niemals Cross-Tenant-Recall

### 6.4 DSGVO
- Recht auf Löschung: API-Endpoint, der alle Notes mit `tenant: <customer-id>` löscht
- Datenschutz-Folgenabschätzung (DSFA) als Doku-Pflicht vor Phase 6-Go-Live
- Auftragsverarbeitungs-Vertrag (AVV) mit Anthropic prüfen (US-Provider, EU-DPF)

## 7. Workspace-Skills-Schutz

User-Skills in `workspace/skills/` sind **heilig**:
- Kein Auto-Update ohne explizite User-Approval
- Kein Auto-Delete
- Bei Konflikt-Update: zweite Variante anlegen (`<name>-v2/`), nicht überschreiben
- Backup-Pfad in `<vault>/.claude-os/skills-backup/` (geplant)

## 8. Verify-Bei-Bedrohung-Checkliste

Bei jedem PR, der einen dieser Pfade berührt, läuft der Check:
- [ ] `src/domains/*-bridge/` → Audit-Log-Eintrag erzeugt?
- [ ] `src/sidecar/`, `src/mcp/` → Tool-Call-Schema validiert?
- [ ] `vault-sync/` → Classification respektiert? Redaction-Hook getriggert?
- [ ] `skills/` → Sandbox-Lifecycle korrekt?
- [ ] Provider-Calls → Modell-ID config-driven (nicht hardcoded)?

## 9. Incident-Response

- **Suspected secret leak:** Token im OS-Keyring revoken, neuer Token, Audit-Log auf Zugriff prüfen, Yannik-Notify
- **Suspected prompt injection:** Quelle (Note/API-Response) klassifizieren, Skill quarantänisieren, Lessons-Eintrag
- **Suspected MSP-write fail:** Rollback-Token verwenden, Customer notify (bei tatsächlichem Daten-Impact)

Jeder Incident: Eintrag in `tasks/incidents/YYYY-MM-DD-<slug>.md`.

## 10. Was hier nicht steht (aber wichtig)

- Penetration-Testing-Plan
- Backup-Recovery-Drills
- Onboarding/Offboarding-Checkliste (wenn Claude OS jemals jenseits von Yannik genutzt wird — aktuell nicht)

Diese werden bei Bedarf in `tasks/adr/` als ADR ergänzt.
