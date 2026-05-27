# Phase Web-7 — Multi-User Login + User-Registration (Stage 2)

**Ziel:** Server-Variante bekommt echten Multi-User-Flow mit Email/Passwort-Login, optionaler Self-Registration und persistenter User-Tabelle. Stage 1 (`CLAUDE_OS_AUTH_TOKEN`-Liste per ADR-0033) bleibt für Power-User-/Service-Token-Mode parallel verfügbar.

**Status (2026-05-27):** Geplant. Stage 1 (token-list) shipped. Diese Phase ist Stage 2 aus ADR-0033 + die explizit offene "Login-UI + User-Registrierung"-Phase aus `tasks/phase-server-web.md`.

**Plan-Datum:** 2026-05-27
**Branch-Vorschlag:** `feature/phase-web-7-multi-user`
**Vorgänger:** Phase Web 1-6 shipped, ADR-0033 (Stage 1 multi-token), ADR-0032 (HTTP-Headless-Deployment)
**Neuer ADR-Bedarf:** ADR-0036 (User-Model + Password-Hashing-Strategy) oder ADR-0033 erweitern

---

## Architektur in 60 Sekunden

```
Browser → /api/auth/login (email + password)
       → Bcrypt verify gegen users.sqlite
       → Session-Cookie (HTTP-only, SameSite=Strict, Secure)
       OR
       → Bearer-Token (für API-Clients)
            ↓
       → Server-Hook: cookie OR token → tenantId resolve
            ↓
       → existing RPC + SSE + WS pipeline (unverändert)

Backend new:
  src/server/users.ts        — UserRepository (sql.js), passwordHash via bcrypt
  src/server/sessions.ts     — opaque session-cookies, persistent oder in-memory-LRU
  src/server/auth.ts         — extend: cookie-first / token-fallback Auth-Hook
  src/cli/commands/users.ts  — admin CLI (create/list/disable/reset-password)
```

**Reuse (kein Neuschreiben):**
- `src/server/auth.ts` Token-Hook bleibt als Fallback (Service-Tokens für CLI/CI weiterhin)
- `tenant`-Domain: User-ID wird neue Tenant-ID-Source (User-tied statt Token-tied); existing `ServerTenantContext` erweitert
- sql.js aus Phase 3a (memory-index) — gleicher Backend für User-Tabelle
- `EncryptedFileStore` aus `@domains/secrets` — sessions-secret-Key gespeichert hier

**Neu zu bauen:**
- `users.sqlite` schema (`users` + `sessions` Tabellen)
- bcrypt-Hashing (Node-built-in `crypto.scrypt` oder `bcrypt` npm-Dep — Klärungspunkt)
- Login/Registration-Page-Components
- CLI für Admin-Ops (`claude-os users create alice --email alice@example.com`)
- Self-Registration-Toggle (env-flag, default OFF — Multi-User-Web ist Trusted-Network-default)
- Rate-Limiting für Login-Versuche (in-memory token-bucket, persisted-rate-store ist Phase Web-8)
- Audit-Log-Entries für jeden Login/Logout/Failed-Login

---

## Phasen

### Phase Web-7-1 — User-Repository + Password-Hashing

- [ ] `src/server/users-repo.ts` mit sql.js-backed UserRepository:
  - Schema: `users(id PK, email UNIQUE, passwordHash, createdAt, lastLoginAt, disabled BOOL, tenantIdOverride?)`
  - API: `createUser(email, password)`, `findByEmail`, `verifyPassword(email, password)`, `disable(id)`, `setPassword(id, newPassword)`, `list({includeDisabled?})`
  - Migration: schema versioned mit `schema_version`-Pragma; v1 jetzt, future-bumps machbar
- [ ] Password-Hashing via **`node:crypto.scrypt`** (Built-in, kein extra Dep) ODER **`bcrypt`** (gewohntes Pattern, native-build). Klärungspunkt — Empfehlung: scrypt für kein-native-dep
  - Salt: 32 random bytes, per-user
  - Output: `scrypt$N=16384$r=8$p=1$<salt-b64>$<hash-b64>` (algorithm-tagged für Future-Migration)
  - `MIN_PASSWORD_LEN=12` (zwölf — modern OWASP-Empfehlung)
  - `verifyPassword` mit `timingSafeEqual`
- [ ] Tests: 15+ Unit-Tests inkl. password-rotation, disable-then-login-rejection, schema-migration-no-data-loss

**DoD Web-7-1:** `tests/server/users-repo.test.ts` grün; UserRepository hat keine FS-Effekte außer der `.sqlite`-Datei in `<dataDir>/users.sqlite`.

### Phase Web-7-2 — Session-Cookies + Login-RPC

- [ ] `src/server/sessions.ts`:
  - In-memory LRU der active sessions (Default 1000 entries, configurable)
  - Optional persistent: `sessions`-Tabelle in derselben users.sqlite (cookies survive Container-Restart wenn `$CLAUDE_OS_SESSION_PERSIST=1`)
  - Session-ID: 256-bit CSPRNG, base64-url
  - TTL: 30 Tage default, refreshed on each Authenticated-Request (sliding-window)
- [ ] `src/server/auth.ts` erweitern:
  - Auth-Hook prüft in Reihenfolge: (1) Session-Cookie, (2) `Authorization: Bearer <token>` aus token-Liste (ADR-0033 fallback), (3) reject 401
  - Cookie-name: `claude_os_session`; HTTP-only, SameSite=Strict, Secure (nur über HTTPS gesetzt — Dev-Mode `$CLAUDE_OS_INSECURE_COOKIES=1` erlaubt http für localhost)
  - **CSRF-Schutz**: SameSite=Strict + Double-Submit-Cookie-Token für state-changing RPCs (`POST /api/rpc`). Tokens-only-Requests (Bearer) skippen CSRF (caller ist nicht Browser)
- [ ] Neue HTTP-Endpunkte:
  - `POST /api/auth/login` (email + password) → Set-Cookie + `{user: {id, email, tenantId}}`
  - `POST /api/auth/logout` → Cookie-Invalidate + 200
  - `POST /api/auth/refresh` (optional, für Token-clients die Session-Cookies wollen) → Set-Cookie wenn Bearer-Token valid
  - `GET /api/auth/me` → current user (für GUI-Header-Display)
- [ ] Rate-Limit: pro-IP-Token-Bucket, 5 failed-logins / 15min → 429 mit Retry-After. In-Memory, durch Restart resettet — Phase-Web-8 macht persistent
- [ ] Audit-Log: `kind: 'auth.login.success' | 'auth.login.failed' | 'auth.logout'` mit `{email-hash, ip-hash, userAgent}`
- [ ] Tests: 12+ Server-Roundtrip-Tests (login-flow, cookie-set, refresh, expire, csrf-reject)

**DoD Web-7-2:** `curl` Login-Roundtrip funktioniert; Browser-Session überlebt Page-Reload; CSRF-Failed-Request gibt 403.

### Phase Web-7-3 — Tenant-ID-Resolution-Update

- [ ] `src/domains/tenant/resolve-token.ts` erweitern um `resolveTenantFromUser(userId): ServerTenantContext`:
  - User hat optional `tenantIdOverride` (Power-Feature: shared-tenant für Familien-Account)
  - Default: tenantId = `'user-' + first-12-hex-of-sha256(userId)` (deterministisch)
- [ ] `auth-hook` setzt `req.user` (User-Object) UND `req.tenant` (ServerTenantContext); existing Code der nur `req.tenant` nutzt bleibt unverändert
- [ ] Migration-Path: für existing Token-User (ADR-0033): tenantId bleibt token-derived; coexistence garantiert
- [ ] `doctor`-Check `checkUserStore`: prüft users.sqlite öffnen-fähig, schema-version aktuell

**DoD Web-7-3:** Server kann gleichzeitig Token-User UND Email-User authentifizieren; beide kriegen stable tenantIds.

### Phase Web-7-4 — Login + Registration GUI

- [ ] `gui/src/pages/login.tsx` aus Phase Web-2 (war Token-only) erweitern:
  - Tabs/Toggle "Email + Passwort" vs "API-Token" (default Email)
  - Email + Password Form mit Client-Side-Validation (length, format)
  - Bei erfolgreichem Login: redirect zur ursprünglichen Route via `?from=`-Query
- [ ] `gui/src/pages/register.tsx` (NEU, conditional auf `$CLAUDE_OS_ALLOW_REGISTRATION=1`):
  - Email + Password + Confirm-Password
  - Server-side rate-limit (3 registrations / IP / hour)
  - Audit-Log-Entry `kind: 'auth.register'`
- [ ] `gui/src/components/AuthGate.tsx`: erkennt `/login` und `/register` als public; passt Redirect-Logic an
- [ ] User-Profile-Drawer (im Sidebar-Header) zeigt current email + Logout-Button + Change-Password-Modal (analog `SecretAddModal`-Pattern)
- [ ] Tests: +8 GUI tests (login-flow, register-flow, registration-disabled-banner, profile-drawer, change-password)

**DoD Web-7-4:** End-to-End Browser-Flow: register → login → use app → logout → re-login funktional.

### Phase Web-7-5 — Admin-CLI

- [ ] `src/cli/commands/users.ts`:
  - `claude-os users create --email <e> --password <p> [--tenant-override <id>]`
  - `claude-os users list [--include-disabled] [--json]`
  - `claude-os users disable <id-or-email>`
  - `claude-os users enable <id-or-email>`
  - `claude-os users reset-password <id-or-email> [--password <p> | --random]`
  - `claude-os users sessions list [--user <id>]`
  - `claude-os users sessions revoke <session-id>`
- [ ] Wire-up in `src/cli/index.ts` SUBCOMMAND_LOADERS
- [ ] `docs/server-deployment.md` erweitern: User-Management-Sektion + Migrations-Path von Token-Liste auf User-Login

**DoD Web-7-5:** Admin kann ohne Browser-Zugriff alle User-Ops durchführen; CI/CD-Skripte können User initial-seeden.

### Phase Web-7-6 — Doku + ADR + Migrations-Path

- [ ] ADR-0036 (oder ADR-0033 §"Stage 2" Erweiterung): User-Model + Password-Hashing + Session-Strategy + CSRF-Approach
- [ ] `docs/server-deployment.md`:
  - Neue Sektion "Multi-User mit Email-Login" (Stage 2)
  - Migrations-Guide: Stage-1 → Stage-2 (Token bleibt parallel; User können on-demand erstellt werden)
  - Self-Registration Trade-offs (Trusted-Network only; öffentliches Internet braucht zusätzlich Cloudflare-Access oder Captcha)
- [ ] `README.md`: Server-Deployment-Sektion verlinkt Multi-User-Setup
- [ ] CHANGELOG: `feat(server): Phase Web-7 — Multi-User Login + Registration (Stage 2 per ADR-0033)`

**DoD Web-7-6:** Outside-Tester kann von leerem Container zu Multi-User-Setup in 20 Minuten.

---

## Reihenfolge-Regeln

- Web-7-1 (Repo) **vor** Web-7-2 (Sessions+RPC) — Login braucht User-Lookup
- Web-7-2 **vor** Web-7-3 (Tenant) — Tenant-Resolve braucht User-Context
- Web-7-3 **vor** Web-7-4 (GUI) — GUI braucht stable Tenant-Behavior
- Web-7-5 (Admin-CLI) **parallel** zu Web-7-4 möglich (independent surface)
- Web-7-6 (Doku) **immer letzte**

## Geschwindigkeits-Schätzung

| Phase | Aufwand | Komplexität |
|---|---|---|
| Web-7-1 Repo + Hashing | 3-4 h | M |
| Web-7-2 Sessions + Login | 4-6 h | M |
| Web-7-3 Tenant-Update | 2-3 h | S |
| Web-7-4 GUI Login/Register | 4-6 h | M |
| Web-7-5 Admin-CLI | 2-3 h | S |
| Web-7-6 Doku + ADR | 2-3 h | S |
| **Gesamt** | **17-25 h** | |

## Klärungspunkte

1. **Password-Hashing**: `node:crypto.scrypt` (built-in, kein Dep, gut genug) ODER `bcrypt` (etablierter, native-build pkg-pain)? Empfehlung: **scrypt** — passt zur sql.js-Wahl (no-native-deps-Pattern), Performance ok für homelab-scale
2. **Session-Storage**: in-memory LRU only ODER hybrid mit sql.js-persist? Empfehlung: **default in-memory** + opt-in persistent via env-var — Container-Restart-Logout ist akzeptables Default-Verhalten
3. **Self-Registration**: per default ON oder OFF? Empfehlung: **OFF** — Multi-User-Web läuft typischerweise hinter Cloudflare-Access oder VPN; Admin-CLI ist der Standard-Provisioning-Weg. Self-Registration-Toggle für offene Cases
4. **2FA / TOTP**: in dieser Phase oder v2? Empfehlung: **v2** — adds significant complexity, Yannik braucht es vermutlich nicht (Token + Cloudflare-Access deckt Hardening)
5. **OAuth-Provider (GitHub/Google)**: in Web-7 inkludieren oder Folge-Phase Web-8? Empfehlung: **Web-8** — OAuth-Implementation ist 4-6h eigenständig, lieber sauber separat als wackliges Bundle
6. **Schema-Migration-Strategy**: in-place ALTER ODER versioned-tables (v1, v2, ...)? Empfehlung: **versioned-pragma** mit `users_v1`-Pattern und expliziten migration-Skripten in `src/server/migrations/`

## Out-of-Scope (Phase Web-7)

- **OAuth-Provider** (GitHub, Google, Apple): Phase Web-8
- **2FA / TOTP / WebAuthn**: v2
- **Password-Reset via Email**: braucht SMTP-Integration — Phase Web-8 oder eigene ADR
- **Per-User-Quotas / Rate-Limits**: Phase Web-8 (persistent Rate-Store)
- **User-Roles / RBAC**: Single-Role "user" reicht für v1; Admin-Identifier ist initial-Bootstrapping-Flag (`CLAUDE_OS_ADMIN_EMAIL` for special perms wenn nötig)
- **Per-User-Workspace-Isolation in Vault**: Tenant-Domain isoliert logisch, aber FS-Layout-Anpassung (`vault/users/<id>/`) ist Phase Web-9
- **Mobile-Native-App** mit OAuth/OIDC: v2

## Sicherheits-Stellungnahme

Diese Phase legt User-Credentials in einer lokalen SQLite-Datei ab. Pflicht-Hardening:
- `users.sqlite` mit `chmod 0o600` (per ADR-0004-Pattern)
- Volume-Mount-Empfehlung: explicit ownership in docker-compose (`user: 1000:1000`)
- Backup-Strategy: users.sqlite gehört in die Proxmox-VM-Snapshot-Backup-Liste (siehe `docs/server-deployment.md` §6)
- KEIN Plain-Text-Password-Logging — Pflicht-Code-Review-Gate analog ADR-0013 §3 Redaction-List

Mit Self-Registration ON ist der Server eine potentielle Attack-Surface — Pflicht-Doku-Hinweis: betreibe NICHT mit `ALLOW_REGISTRATION=1` ohne Cloudflare-Access oder VPN davor.
