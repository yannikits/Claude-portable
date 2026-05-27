# Phase MSP-E — Note-to-Skill Fast-Track

**Ziel:** Aus einer Note (z.B. eine Lösung eines Customer-Tickets) wird mit zwei Klicks ein Skill-Draft. Schließt den Loop "Lösung gefunden → Lösung wiederverwendbar". Adressiert MSP-Pain-Points "Repetitive Tickets" + "Inconsistent Processes".

**Status (2026-05-27):** Geplant. **Hard-Dependency auf Phase 5c** (`tasks/phase-5c-skill-promotion-gui.md`) — die Skill-Promotion-Pipeline + GUI muss zuerst stehen, damit ein erzeugter Draft auch real aktivierbar ist.

**Quelle:** `three-brain-out/2026-05-27-msp-productivity/plan.md` Feature 4. MSP-A bis MSP-D sind shipped (#169, #170, #174, #175); MSP-E ist die letzte offene Feature-Iteration aus der Gemini/Codex-Synthese, ge-gated bis Phase-5c-Foundation steht.

**Plan-Datum:** 2026-05-27
**Branch-Vorschlag:** `feature/msp-e-note-to-skill`
**Vorgänger:** Phase 5c (skill-promotion-pipeline), MSP-A (notes.write + active-resolver), Phase 4 (skill-engine + matcher)

---

## Architektur in 60 Sekunden

```
Note in Vault (z.B. /msp-customers/kunde-a/2026-05-27-m365-license-reset.md)
    ↓ User klickt in GUI auf "Als Skill speichern"
NoteToSkillProposal (kein FS-Effekt yet)
    ├── extracted Title (aus Frontmatter title oder H1)
    ├── extracted Body (Markdown, optional preserve-context vs strip-customer-data)
    ├── proposedSkillName (kebab-case, slugified vom title)
    ├── classification (default: 'personal' — customer-confidential nur explicit)
    ↓ User editiert in einem Modal (Name, Beschreibung, "use-when"-Trigger)
    ↓ User klickt "Draft erzeugen"
src/domains/skill-lifecycle/draft-generator.ts::noteToDraftSkill()  [new]
    ↓ schreibt nach <vault>/skills/_drafts/<name>/SKILL.md
    ↓ User wird auf SkillReviewPage (aus Phase 5c) redirected
    ↓ Reguläre Phase-5c-Pipeline (quarantine → sandbox-run → review → sign → active)
```

**Schlüssel-Insight:** Note-to-Skill ist nur ein zweiter Einstiegspunkt in die existing draft-generator. Lessons-Loop (`tasks/lessons.md` → draft) bleibt unverändert; Notes-Loop ist additiv.

**Reuse (kein Neuschreiben):**
- `@domains/skill-lifecycle/draft-generator` — wird um `noteToDraftSkill(noteContent, opts)` erweitert (analog zu `lessonToDraftSkill`)
- `@domains/notes/reader` — bereits da für note-load
- Phase 5c Promotion-Pipeline — bekommt den Draft anschließend ohne special-case
- GUI `SkillReviewPage` aus Phase 5c

**Neu zu bauen:**
- `noteToDraftSkill(note, opts): DraftSkill` pure-function
- Sidecar-RPC `notes.proposeAsSkill({notePath, overrides?})` + `notes.createSkillDraftFromNote({notePath, draftSpec})`
- GUI: "Als Skill speichern"-Button im Note-Detail + `NoteToSkillModal` (Name + Beschreibung + Trigger-Bedingung editierbar)
- Heuristik für Trigger-Extraction (was triggert "use-when"?) — z.B. aus Note-Tags oder Frontmatter `applies-to`
- Customer-Confidential-Redaction-Helfer (auto-strip Customer-IDs aus Body wenn `classification !== 'customer-confidential'`)
- Tests: Unit für `noteToDraftSkill`, Integration für RPC-Flow

---

## Phasen

### Phase MSP-E-1 — `noteToDraftSkill` Pure-Function

- [ ] `src/domains/skill-lifecycle/draft-generator.ts` erweitern um Sibling `noteToDraftSkill(note: NoteEntry, opts: NoteDraftOpts): DraftSkill`
  - `opts.name` (User-input, default: slugify(note.title))
  - `opts.useWhen` (User-input, "Wann soll der Skill triggern?" — wird in SKILL.md description-frontmatter)
  - `opts.preserveCustomerData: boolean` (default false — strippt detected IDs/Email/Phone via regex, dokumentiert als best-effort)
  - `opts.workspace` (default note's workspace)
- [ ] Generierte `SKILL.md`-Struktur:
  ```yaml
  ---
  name: <name>
  description: <useWhen> (z.B. "Wenn ein M365-User-Reset benötigt wird")
  source: note
  source_path: msp-customers/kunde-a/2026-05-27-m365-license-reset.md
  classification: personal | customer-confidential
  state: draft
  generated_at: 2026-05-27T...
  ---

  # <Title>

  <Body> (potentially redacted)

  ## Source

  Generiert aus Note `<source_path>` am <generated_at>.
  ```
- [ ] Redaction-Helper `redactCustomerIdentifiers(body)`:
  - Email-Regex → `<email-redacted>`
  - Phone-Regex (DE-Formats, +49, 0xx) → `<phone-redacted>`
  - Bekannte Customer-IDs aus `msp-customers/<id>/` Pfaden? → out-of-scope für MVP, dokumentieren
- [ ] +8 Tests (happy path, customer-confidential preserves body, slugify edge-cases, redaction)

**DoD MSP-E-1:** `noteToDraftSkill` mit realer Note-Datei retourniert valide `DraftSkill` mit korrektem Frontmatter.

### Phase MSP-E-2 — Sidecar-RPCs

- [ ] `src/sidecar/methods/notes.ts` erweitern:
  - `notes.proposeAsSkill({notePath, overrides?})` → `{proposedName, proposedDescription, redactedBody, classification, customerConfidentialTouched: boolean}`
  - `notes.createSkillDraftFromNote({notePath, name, useWhen, preserveCustomerData?})` → `{draftPath}` mit transactional write (note-read + draft-generate + write atomic-rename)
- [ ] **Audit-Log-Entry** bei jedem `createSkillDraftFromNote`: `kind: 'skill.draft', action: 'created-from-note', details: {sourceNotePath, draftPath, classification, redactionApplied}`
- [ ] **Tenant-Guard**: wenn Note in `msp-customers/<id>/` liegt UND `preserveCustomerData=true`, dann typed Error `customer-data-export-denied` außer Caller hat explicit `confirm-customer-data: true` im Payload (zwei-Faktor)
- [ ] +5 method tests

**DoD MSP-E-2:** `curl notes.proposeAsSkill` mit real Note retourniert Vorschlag; `curl notes.createSkillDraftFromNote` schreibt Draft + audit-entry.

### Phase MSP-E-3 — GUI Note-Detail-Page + Modal

- [ ] `gui/src/pages/index.tsx` Note-Detail-View bekommt "**Als Skill speichern**"-Button (next to existing actions)
- [ ] `gui/src/components/NoteToSkillModal.tsx`:
  - Lädt initial `notes.proposeAsSkill(notePath)` → zeigt Vorschau (Name, Beschreibung, redacted-vs-original-Body via Toggle)
  - Editable Felder: `name`, `useWhen`, Toggle `preserveCustomerData` (default off, mit Warn-Banner wenn an)
  - **`customer-confidential`-Doppel-Confirm** (analog Phase 5c §customer-confidential): wenn Klassifikation customer-confidential UND preserveCustomerData=true → modaler Re-Confirm
  - "Draft erzeugen"-Button → `notes.createSkillDraftFromNote` → bei Erfolg: Toast "Draft erzeugt — bitte über Skill-Review-Page aktivieren" + Link zur SkillReviewPage
- [ ] +6 GUI tests (RTL + happy-dom)

**DoD MSP-E-3:** Yannik kann von einer beliebigen Note in 2 Klicks einen Draft erzeugen; Modal zeigt Warn-Banner bei customer-confidential.

### Phase MSP-E-4 — CLI + Doku

- [ ] `claude-os notes propose-as-skill <note-path>` (read-only, druckt Vorschlag) + `claude-os notes create-skill-draft <note-path> --name <n> --use-when "<text>"` (Write-Variante mit gleichem Two-Factor für customer-data)
- [ ] `docs/skill-promotion-workflow.md` (aus Phase 5c) bekommt eine Sektion **"Aus Note einen Skill machen"** mit Beispiel-Workflow
- [ ] README "Self-Improvement" Sektion verweist zusätzlich auf den Note-to-Skill-Pfad

**DoD MSP-E-4:** Beide CLI-Pfade funktional; Doku-Externe können Workflow nachvollziehen.

---

## Reihenfolge-Regeln

- **Phase 5c muss komplett shipped sein** bevor MSP-E startet — sonst gibt es zwar Drafts aber keinen Weg sie zu aktivieren
- MSP-E-1 vor MSP-E-2 vor MSP-E-3 (klassisch domain → RPC → GUI)
- MSP-E-4 (CLI + Doku) **parallel** zu MSP-E-3 möglich

## Geschwindigkeits-Schätzung

| Phase | Aufwand | Komplexität |
|---|---|---|
| MSP-E-1 noteToDraftSkill | 2-3 h | S |
| MSP-E-2 RPCs + Audit | 2-3 h | S |
| MSP-E-3 GUI Modal | 3-4 h | M |
| MSP-E-4 CLI + Doku | 1-2 h | S |
| **Gesamt** | **8-12 h** | |

## Klärungspunkte

1. **Redaction-Aggressivität**: Soll der Redaction-Helper auch Customer-Namen ersetzen wenn sie im Body stehen? Empfehlung: **nein** — Customer-Names sind oft generic ("M365 license") und auto-strippen würde Skill nutzlos machen. Ersetzung nur für PII (Email, Phone). Customer-Name-Redaction ist explicit User-Edit-Step im Modal.
2. **Auto-Suggest "use-when"-Text**: Soll claude.exe via `ask`-Domain den `useWhen`-Vorschlag generieren? Empfehlung: **v2** — MVP lässt User selbst tippen. claude.exe-Call-Pfad ist gated auf Phase-1-Bridge-Stability (✓) aber lokale Heuristik via Note-Tags ist genug für MVP.
3. **Tracker-Ziehung zum Customer**: Note hat `customer-id` im Frontmatter, der erzeugte Skill bekommt das NICHT (Skill soll customer-agnostic sein). Backreference im SKILL.md via `source.note_path` aber kein `customer_id`-Tag. OK?

## Out-of-Scope (Phase MSP-E)

- **Auto-Refresh des Skills bei Note-Update**: Note ändert sich → Skill auto-re-generate. Sound nice, aber: gated on Phase 5c approval-flow (jeder regen wäre neue Promotion). Phase v1.x falls Reibung
- **Bulk Note-to-Skill**: "Generiere Skills aus allen Notes in customer-onboarding/". Premature optimization. CLI-Skript ist Workaround
- **Skill-Author-Attribution**: wenn Multi-User-Web (Phase Web-7) shipped, Audit-Log enthält Yanniks subject-token-hash. Persisting "created_by" in SKILL.md frontmatter ist v1.x
