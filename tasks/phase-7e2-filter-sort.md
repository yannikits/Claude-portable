# Phase 7-E.2 — MSP-Health Filter + Sort

**Status:** Plan (Stand 2026-05-30)
**Ziel-Release:** v1.9.4
**Bedingt durch:** ADR-0044 (Phase 7-E.1 Dashboard-Polish)

## Was 7-E.2 liefert

Zwei Header-Toggles für das MSP-Health-Dashboard, frontend-only:

1. **„show issues only"** — filtert Rows raus wo alle (configured) cells `ok` sind
2. **„sort by severity"** — sortiert Rows nach max-severity-cell (error > warn > ok > empty)

Beide unabhängig kombinierbar. Default beide `off`.

## Was 7-E.2 NICHT liefert (Karpathy-bewusst out-of-scope)

- Env-getriebene SLA-Threshold-Knobs (Vendor-spezifisch) — Speculation, kein
  konkreter Use-Case der das braucht. License-Schwellen sind bereits im
  per-Vendor-Mapper (Sophos/Securepoint = 30d hard-coded). Wenn das mal
  knackt, machen wir's konfigurierbar.
- Saved-Views / URL-State — können später als 1-Commit nachgereicht werden.
- Backend-Computation neuer Felder — die `BridgeCellResult.kind` reicht
  schon.

## Module

### `gui/src/lib/cell-severity.ts` (neu, klein)

Pure helper:
```ts
export type Severity = 'ok' | 'warn' | 'error' | 'empty';
export function cellSeverity(cell: BridgeCellResult<unknown> | undefined): Severity;
export function rowMaxSeverity(row: CustomerHealthRow): Severity;
export function rowHasIssue(row: CustomerHealthRow): boolean;
```

Mapping (matches existing `cellTone()`-Logic in `msp-health.tsx`):
- `undefined` → empty
- `ok` → ok
- `rate-limited`, `misconfigured` → warn
- `auth-failed`, `unreachable`, `timeout`, `error` → error

`rowMaxSeverity`: max-over-cells.
`rowHasIssue`: maxSeverity ∈ {warn, error}.

### `gui/src/pages/msp-health.tsx` (delta)

- 2 useState toggles
- useMemo: apply filter + sort to `rows` before slice for pagination
- Header-Controls: 2 weitere segment-button-pairs

## Tests

`gui/tests/cell-severity.test.ts`:
- cellSeverity für alle kinds + undefined
- rowMaxSeverity: empty row, all-ok, mixed warn, mixed error
- rowHasIssue: only true wenn warn or error

## Verification

- [ ] tsc -p gui clean
- [ ] biome clean
- [ ] new GUI-tests grün
- [ ] backend suite unchanged
- [ ] manual: toggle "show issues only" hides ok rows; toggle "sort severity" puts red/yellow first
- [ ] CHANGELOG + Manifest-bump
