# Phase 5c — Skill-Promotion-Pipeline + GUI Approval-Modal (Gate 3)

**Ziel:** Self-Improvement-Loop end-to-end schließen. Lessons werden zu Draft-Skills → durchlaufen Sandbox-Quarantäne → Yannik reviewed im GUI mit Side-by-Side-Diff + nativem Password-Approval → Ed25519-Signatur landet im Audit-Log → Skill wird aktiv im Phase-4-Loader sichtbar.

**Status (2026-05-27):** Geplant. Foundation komplett — Sandbox (ADR-0034 + Phase-5b net-guard) und Signing-Public-Core (ADR-0035) sind shipped, Audit-Log v1 ist shipped.

**Quelle:** ADR-0026 §"Implementation Gated" — Gate 3 ist die letzte offene Anforderung.
**Plan-Datum:** 2026-05-27
**Branch-Vorschlag:** `feature/phase-5c-skill-promotion`
**Vorgänger-ADRs:** 0026 (Lifecycle), 0034 (Sandbox), 0035 (Signing), 0023 (Native-Password-Pattern)

---

## Architektur in 60 Sekunden

```
tasks/lessons.md
    ↓ readLessonsFile()
LessonEntry[]
    ↓ lessonToDraftSkill()
DraftSkill          ──→  <vault>/skills/_drafts/<name>/SKILL.md     [state: draft]
    ↓ promote --to-quarantined
                    ──→  <vault>/skills/_quarantined/<name>/SKILL.md [state: quarantined]
    ↓ runSkillInSandbox() (child_process.fork + path/net-guard + 30s-timeout)
SandboxRunResult    ──→  attach to promotion-record
    ↓ promote --to-reviewed     (GUI-only flow)
GUI: Side-by-Side-Diff + Native-Password-Approval
    ↓ signPayload({skillId, diffHash, classification, reviewedAt}, privKey, pubKey)
SignedEnvelope      ──→  AuditLogger.append(kind: 'skill.promote', envelope)
                    ──→  <vault>/skills/<name>/SKILL.md             [state: active]
```

**Reuse (kein Neuschreiben):**
- `@domains/skill-lifecycle/lessons-reader` — Parser für lessons.md
- `@domains/skill-lifecycle/draft-generator` — Lesson → DraftSkill
- `@domains/skill-lifecycle/sandbox/runner` — `runSkillInSandbox()` 30s-fork
- `@domains/skill-lifecycle/signing/signer` — `signPayload()` + `verifyEnvelope()`
- `@domains/skill-lifecycle/signing/key-store` — `loadOrCreateSigningKeypair()`
- `@core/audit/logger` — `AuditLogger.append()`
- `gui/src-tauri/src/lib.rs::set_secret_native` — Native-Password-Pattern (ADR-0023) wird auf `signing-key-passphrase`-Unlock erweitert

**Neu zu bauen:**
- State-Transition-Layer (`promote.ts`): pure Funktionen `promoteDraftToQuarantined`, `runQuarantinedSandbox`, `promoteQuarantinedToReviewed`, `promoteReviewedToActive` mit FS-Effekten + Audit-Hook
- CLI `claude-os skill promote <name>` mit `--to-quarantined | --run-sandbox | --to-reviewed | --to-active | --deprecated | --disabled`
- Sidecar-RPCs (`methods/skill-lifecycle.ts`): `skill.listDrafts`, `skill.listQuarantined`, `skill.runQuarantined(name)`, `skill.proposeReview(name)`, `skill.approveReview(name, signedEnvelope)`, `skill.computeDiff(name, fromState, toState)`
- Side-by-Side-Diff-Renderer (Frontend, `diff@9` ist bereits Dep aus Phase-4d)
- GUI `SkillReviewPage` mit Liste Pending-Reviews + Diff-Surface + Approve-Modal
- GUI `SignApprovalModal` (analog `SecretAddModal` aus ADR-0023) — ruft Tauri-Command `sign_skill_promotion_native(name, diffHash)` → spawn-blocking → password-prompt → signPayload
- `docs/skill-promotion-workflow.md` (deutsch) — Self-Improvement-Workflow für Yannik

---

## Phasen

### Phase 5c-1 — State-Transition-Layer (Backend, pure)

**Ziel:** FS-Effekte + Audit-Hooks zentralisiert; Caller-agnostisch (CLI + RPC + GUI nutzen denselben Core).

- [ ] `src/domains/skill-lifecycle/promote.ts` mit:
  - `promoteDraftToQuarantined(name, opts): Promise<PromoteResult>` — verschiebt `_drafts/<name>/` → `_quarantined/<name>/`, kein Sandbox-Run
  - `runQuarantinedSandbox(name, opts): Promise<SandboxRunResult & {snapshot}>` — kapselt `runSkillInSandbox` + persistiert Resultat als `<quarantinedDir>/<name>/.sandbox-run.json` für GUI-Anzeige
  - `proposeReview(name, opts): Promise<ReviewProposal>` — produziert `{name, diffHash, beforeContent, afterContent, classification, sandboxRunId?}` — KEIN Move; nur Read + Prep
  - `approveReview(name, envelope, opts): Promise<void>` — verifiziert envelope, schreibt audit-entry `kind: 'skill.promote' action: 'review-approved'`, moved `_quarantined/<name>/` → `skills/<name>/`
  - `deprecate(name, opts)` / `disable(name, opts)` / `reactivate(name, opts)` — späteres State-Mutations
- [ ] Typed Errors: `PromoteError` mit codes `not-found`, `wrong-state`, `signature-invalid`, `signature-mismatch-diff-hash`, `audit-write-failed`
- [ ] `diffHash`-Berechnung: SHA-256 über kanonisches `{beforeContent, afterContent, classification}` damit der GUI-Diff genau dem Audit-Trail entspricht
- [ ] Tests: 15+ Unit-Tests gegen tmpdir-Fixtures inkl. wrong-state-rejection, audit-rollback bei FS-Failure
- [ ] **Deliberate non-feature:** kein Auto-promote-Loop. Jede Transition ist explicit-API.

**DoD 5c-1:** `vitest run tests/domains/skill-lifecycle/promote.test.ts` grün, alle 6 Transitions getestet.

### Phase 5c-2 — CLI `skill promote`

**Ziel:** Power-User-Workflow (Yannik im Terminal) und Test-Surface für 5c-1.

- [ ] `src/cli/commands/skill-promote.ts` mit subcommand `claude-os skill promote <name>`:
  - `--to-quarantined` → `promoteDraftToQuarantined`
  - `--run-sandbox` → `runQuarantinedSandbox`
  - `--to-reviewed --signed-envelope <path>` → `approveReview` (Envelope aus File für Skript-Use, default-Pfad GUI-Modal)
  - `--to-active` → no-op-alias für `--to-reviewed --signed-envelope ...` (reviewed = active in der File-Repräsentation; nur audit-state-marker)
  - `--deprecate` / `--disable` / `--reactivate`
  - `--json` für skriptbare Outputs
- [ ] Wire in `src/cli/index.ts` lazy SUBCOMMAND_LOADERS
- [ ] `claude-os skill list-drafts` + `claude-os skill list-quarantined` + `claude-os skill list-pending-review`
- [ ] Smoke: `claude-os skill list-drafts` retourniert leere Liste (kein draft vorhanden) → exit 0

**DoD 5c-2:** Manual smoke gegen real `_drafts/<test-skill>/SKILL.md` durchläuft alle Transitions inkl. sandbox-run, audit-log enthält gültige `skill.promote`-Einträge.

### Phase 5c-3 — Sidecar-RPCs

**Ziel:** GUI hat einen kompletten typed Read+Write-Layer.

- [ ] `src/sidecar/methods/skill-lifecycle.ts` (analog `methods/catalog.ts`):
  - `skill.listDrafts({workspace?})` → `DraftSkill[]`
  - `skill.listQuarantined({workspace?})` → `QuarantinedSkill[]` mit optional letzter `.sandbox-run.json`
  - `skill.runQuarantined({name, input?})` → `SandboxRunResult` + persist
  - `skill.proposeReview({name})` → `ReviewProposal` (für GUI-Diff-Render)
  - `skill.approveReview({name, signedEnvelope})` → `{ok: true}` oder typed Error
  - `skill.deprecate/disable/reactivate({name})` — write-ops gated auf sidecar-ok
- [ ] Method-Manifest in `src/mcp/tools.ts` für Phase 5c-MCP-Exposure (read-only `listDrafts/listQuarantined`; mutating Methoden NICHT in MCP — Approval gehört nicht über Tool-Calls)
- [ ] Tests: 10+ method-tests, parity-Check `methods.test.ts > "methodName-sidecar parity"`

**DoD 5c-3:** `curl` gegen `/api/rpc` mit `skill.listDrafts` retourniert Liste; `skill.approveReview` ohne envelope retourniert typed Error `signature-missing`.

### Phase 5c-4 — GUI Side-by-Side-Diff + Skill-Review-Page

**Ziel:** Yannik sieht Pending-Reviews im GUI, kann pro Skill den Diff inspizieren bevor er signiert.

- [ ] `gui/src/pages/index.tsx` — neue `SkillReviewPage` route + sidebar-link "Skills" (oder Sub-Tab in Settings)
- [ ] `gui/src/components/SkillDiffView.tsx` — wrapper über `diff@9` `createTwoFilesPatch()` mit:
  - line-by-line side-by-side Layout (max-width responsive, dark-theme matched zu styles.css)
  - Frontmatter-Section getrennt vom Body
  - **`customer-confidential`-Pfad-Highlight** — wenn `classification: 'customer-confidential'` im Frontmatter, prominent rote Warn-Banner mit "Sensitive Pfade berührt"
  - Sandbox-Run-Snippet-Anzeige (stdout/stderr-tail, exit-code, duration) als Begleit-Card
- [ ] Empty-State: "Keine Pending-Reviews. Erzeuge Drafts via `claude-os skill list-drafts`."
- [ ] +5 Tests gegen happy-dom + RTL (gui/tests/skill-review.test.tsx)

**DoD 5c-4:** Mit einem manuell-präparierten Quarantined-Skill im Vault rendert die Page Diff korrekt + Approval-Button steht parat (5c-5 wired ihn).

### Phase 5c-5 — Tauri-Native-Password-Approval + Sign-Flow

**Ziel:** Approval ohne Renderer-RAM-Touch des privaten Signing-Keys.

- [ ] Tauri-Command `sign_skill_promotion_native(name, diff_hash, classification, reviewed_at)` in `gui/src-tauri/src/lib.rs`:
  - Lädt Signing-Key via `loadOrCreateSigningKeypair()` aus SecretStore (Sidecar-side, RPC `skill.unlockSigningKey` mit native-password-dialog-trigger UND/ODER direkt im Rust-Layer via `tinyfiledialogs::password_box` analog ADR-0023 `set_secret_native`)
  - **Empfehlung:** Analog ADR-0023 — Wert (in diesem Fall die SecretStore-Passphrase ODER direkt der gesignte Envelope) verlässt nie den Renderer. Realisierung: Rust ruft `tinyfiledialogs::message_box_yes_no("Skill <name> signieren?")` als Confirmation; eigentlicher Sign-Call läuft via Sidecar-RPC `skill.signAndApprove(name)` der intern ohne Renderer-Interaktion `loadOrCreateSigningKeypair` + `signPayload` + `approveReview` chained
  - **Alternative** (wenn Passphrase-Prompt nötig): tinyfiledialogs `password_box("Signatur-Key entsperren")` → an Sidecar-RPC weitergeben — Wert geht Tauri→Sidecar (IPC), nicht zu JS
- [ ] Frontend `SignApprovalModal.tsx`:
  - Lädt `skill.proposeReview(name)` → zeigt `diffHash` + Last-4 von `publicKeyB64` (für Plausibility-Check)
  - "Signieren & Aktivieren"-Button ruft Tauri-Command (Native-Mode default) oder fallback `skill.signAndApprove({name})` RPC (Inline-Mode)
  - Bei Erfolg: Modal schließt, `SkillReviewPage` re-fetched die Liste
- [ ] Audit-Log-Entry-Format: `{kind: 'skill.promote', action: 'review-approved', actor: 'yannik' (default), details: {skillId, diffHash, signatureB64, publicKeyB64, classification, sandboxRunId?}}`
- [ ] Doctor-Check `checkSigningKey`: prüft `loadOrCreateSigningKeypair` succeeds, Half-State-Detection
- [ ] +6 Tests (3 backend RPC, 3 GUI modal)

**DoD 5c-5:** End-to-end happy path: pending-review → click "Signieren" → password-prompt OS-native → audit-log enthält gültigen envelope → SkillReviewPage zeigt Skill nicht mehr → `claude-os skills list` zeigt Skill als aktiv.

### Phase 5c-6 — Audit-Log-Integration + Doku

**Ziel:** Self-Improvement-Loop ist auditierbar; Yannik kann nachverfolgen welcher Skill wann mit welcher Signatur aktiviert wurde.

- [ ] `src/core/audit/types.ts` — `kind: 'skill.promote'` als erlaubter `AuditEntry.kind` literal-Union (bereits unterstützt da freie String? — verifizieren)
- [ ] CLI `claude-os audit list --kind skill.promote --since 7d` für Forensik
- [ ] Sidecar-RPC `audit.list({kind, since, until, limit})` für GUI-Audit-Drawer (separate v1.x Sub-Phase, hier vorbereiten)
- [ ] `docs/skill-promotion-workflow.md` (deutsch):
  - Was ist ein Draft, wie entsteht er
  - Quarantäne-Lauf-Pflicht (sandbox-output muss vorliegen)
  - Diff-Inspection — worauf achten (customer-confidential, externe Calls, fs-Writes)
  - Signatur-Vorgang — Bedeutung des Yannik-Approvals
  - Rollback: `claude-os skill promote <name> --disable` lässt Skill im Repo, blockt Load
- [ ] README "Self-Improvement" Sektion verlinkt das Doku

**DoD 5c-6:** Externer Reviewer (oder Yannik in 3 Monaten) kann anhand der Doku einen Skill von Draft bis Active treiben ohne Rückfragen.

### Phase 5c-7 — E2E + ADR-Update

- [ ] `tests/e2e/skill-promotion.e2e.test.ts` gated hinter `RUN_SLOW_TESTS=1`: synthetic lesson → generate-draft → promote-to-quarantined → run-sandbox (echte fork, ~300ms) → propose-review → sign-with-test-keypair → approve → assert-active
- [ ] ADR-0026 §"Implementation Gated" als ✅ done auflisten (alle drei Gates erfüllt)
- [ ] Nightly E2E: skill-promotion-flow in `.github/workflows/nightly.yml` einreihen (matrix x 3 OS)
- [ ] CHANGELOG.md: `feat(skill-lifecycle): Phase 5c — promotion pipeline + GUI approval-modal (Gates 1-3 complete)`

**DoD 5c-7:** Drei Nightly-Runs grün auf allen OS bevor Phase 5c als shipped markiert wird.

---

## Reihenfolge-Regeln

- 5c-1 (State-Transition-Core) **vor** 5c-2 (CLI), **vor** 5c-3 (RPC) — CLI + RPC sind dünne Wrapper über die pure-functions
- 5c-3 **vor** 5c-4 (GUI Diff) — GUI braucht `proposeReview` RPC für Daten
- 5c-4 **vor** 5c-5 (Sign-Modal) — Modal lebt in der ReviewPage
- 5c-5 **vor** 5c-6 (Audit-Doku) — Doku referenziert konkrete Buttons
- 5c-6 **kann parallel** zu 5c-7 (E2E)

## Geschwindigkeits-Schätzung

| Phase | Aufwand | Komplexität |
|---|---|---|
| 5c-1 State-Transitions | 4-6 h | M |
| 5c-2 CLI | 2-3 h | S |
| 5c-3 Sidecar-RPCs | 2-3 h | S |
| 5c-4 GUI Diff-View | 4-6 h | M |
| 5c-5 Sign-Approval-Modal | 4-6 h | M (Tauri + sec-sensitive) |
| 5c-6 Audit + Doku | 2-3 h | S |
| 5c-7 E2E | 2-3 h | S |
| **Gesamt** | **20-30 h** | |

## Klärungspunkte (vor Implementation)

1. **Sign-Approval-Pattern**: Variante A (tinyfiledialogs `message_box_yes_no` als Confirmation; Sidecar tut alles via SecretStore) ODER Variante B (Passphrase-Prompt native, Wert über IPC zum Sidecar)? Empfehlung: **A** — Yannik hat ein einziges OS-User-Account-Login; SecretStore ist bereits auf Keyring (NAPI-RS) gesichert. Doppelte Passphrase wäre redundant.
2. **Reviewer-Identität im Audit-Log**: hardcoded `actor: 'yannik'` ODER aus `$USER`/`os.userInfo()` lesen? Empfehlung: aus `os.userInfo().username` damit Multi-User-Web (Phase Web-7) später nichts ändern muss.
3. **`customer-confidential`-Sonderfall**: zusätzlicher zweiter Confirm-Step (ADR-0026 fordert das) — als modaler Re-Confirm im GUI ODER als CLI-Flag `--confirm-customer-confidential`? Empfehlung: GUI-Re-Confirm, CLI flag spiegelt das nur.
4. **Branch-Strategie**: ein großer PR ODER 7 stacked PRs analog ADR-0034/0035-Pattern? Empfehlung: 3 PRs — (5c-1+5c-2+5c-3), (5c-4+5c-5), (5c-6+5c-7) — reduziert Review-Load + erlaubt Mid-Way-Course-Correct.
5. **MCP-Exposure für `skill.approveReview`**: gar nicht exposen (read-only `listDrafts/listQuarantined` reichen für AI-Agent-Use) — Approval bleibt Human-Only. OK?

## Out-of-Scope (Phase 5c)

- **Auto-Promote-Bot**: Loop der periodisch Drafts in Quarantäne schickt. Phase 5d falls überhaupt gewünscht
- **Multi-Reviewer-Quorum**: Single-User-Approval reicht für v1; Multi-Reviewer ist v2
- **Skill-Versioning**: jede Promotion ist eine Edition; Side-by-side-Vergleich mit historischen Versionen ist v1.x-Material
- **Skill-Trust-Score / Reputation**: aus past-approvals abgeleiteter Vertrauens-Indikator — kommt mit Hermes-/GEPA-Pattern-Implementation v2
