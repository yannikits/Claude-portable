/**
 * Severity-classification helpers for MSP-Health rows.
 *
 * Mirrors the `cellTone()` logic already in msp-health.tsx but exposes
 * it as pure functions so filter + sort can compute against it without
 * coupling to the rendering layer.
 *
 * @module gui/lib/cell-severity
 */
import type { BridgeCellResult, BridgeKind, CustomerHealthRow } from './rpc';

export type Severity = 'empty' | 'ok' | 'warn' | 'error';

const RANK: Record<Severity, number> = {
  empty: 0,
  ok: 1,
  warn: 2,
  error: 3,
};

/** Map a single cell to its severity bucket. */
export function cellSeverity(cell: BridgeCellResult<unknown> | undefined): Severity {
  if (cell === undefined) return 'empty';
  switch (cell.kind) {
    case 'ok':
      return 'ok';
    case 'rate-limited':
    case 'misconfigured':
      return 'warn';
    case 'auth-failed':
    case 'unreachable':
    case 'timeout':
    case 'error':
      return 'error';
  }
}

const ALL_KINDS: readonly BridgeKind[] = ['tanss', 'veeam', 'sophos', 'securepoint', 'm365'];

/** Highest severity across the row's configured cells. Empty when no cells. */
export function rowMaxSeverity(row: CustomerHealthRow): Severity {
  let max: Severity = 'empty';
  const cells = row.cells as Record<BridgeKind, BridgeCellResult<unknown> | undefined>;
  for (const k of ALL_KINDS) {
    const sev = cellSeverity(cells[k]);
    if (RANK[sev] > RANK[max]) max = sev;
  }
  return max;
}

/** True iff the row contains at least one warn or error cell. */
export function rowHasIssue(row: CustomerHealthRow): boolean {
  return RANK[rowMaxSeverity(row)] >= RANK.warn;
}

/** Descending severity comparator (worst first). Stable by slug as tiebreaker. */
export function compareRowsBySeverityDesc(a: CustomerHealthRow, b: CustomerHealthRow): number {
  const da = RANK[rowMaxSeverity(b)] - RANK[rowMaxSeverity(a)];
  if (da !== 0) return da;
  return a.slug.localeCompare(b.slug);
}
