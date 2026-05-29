import { describe, expect, it } from 'vitest';
import {
  cellSeverity,
  compareRowsBySeverityDesc,
  rowHasIssue,
  rowMaxSeverity,
} from '../src/lib/cell-severity';
import type { BridgeCellResult, CustomerHealthRow } from '../src/lib/rpc';

function row(slug: string, cells: Record<string, BridgeCellResult<unknown>>): CustomerHealthRow {
  return { slug, displayName: slug, cells: cells as CustomerHealthRow['cells'] };
}

const okCell: BridgeCellResult<unknown> = {
  kind: 'ok',
  data: {},
  durationMs: 1,
  probedAt: '2026-05-30T00:00:00.000Z',
};
const warnCell: BridgeCellResult<unknown> = { kind: 'misconfigured', message: 'x' };
const errorCell: BridgeCellResult<unknown> = { kind: 'unreachable', message: 'x' };

describe('cellSeverity', () => {
  it('undefined → empty', () => {
    expect(cellSeverity(undefined)).toBe('empty');
  });
  it('ok → ok', () => {
    expect(cellSeverity(okCell)).toBe('ok');
  });
  it('rate-limited and misconfigured → warn', () => {
    expect(cellSeverity({ kind: 'rate-limited', retryAfterSec: 30 })).toBe('warn');
    expect(cellSeverity(warnCell)).toBe('warn');
  });
  it('auth-failed/unreachable/timeout/error → error', () => {
    expect(cellSeverity({ kind: 'auth-failed', message: 'x' })).toBe('error');
    expect(cellSeverity({ kind: 'unreachable', message: 'x' })).toBe('error');
    expect(cellSeverity({ kind: 'timeout', message: 'x' })).toBe('error');
    expect(cellSeverity({ kind: 'error', message: 'x' })).toBe('error');
  });
});

describe('rowMaxSeverity', () => {
  it('empty cells → empty', () => {
    expect(rowMaxSeverity(row('a', {}))).toBe('empty');
  });
  it('all ok → ok', () => {
    expect(rowMaxSeverity(row('a', { tanss: okCell, veeam: okCell }))).toBe('ok');
  });
  it('mix ok+warn → warn', () => {
    expect(rowMaxSeverity(row('a', { tanss: okCell, veeam: warnCell }))).toBe('warn');
  });
  it('mix ok+warn+error → error', () => {
    expect(rowMaxSeverity(row('a', { tanss: okCell, veeam: warnCell, sophos: errorCell }))).toBe(
      'error',
    );
  });
});

describe('rowHasIssue', () => {
  it('false for empty + ok rows', () => {
    expect(rowHasIssue(row('a', {}))).toBe(false);
    expect(rowHasIssue(row('a', { tanss: okCell }))).toBe(false);
  });
  it('true for warn or error rows', () => {
    expect(rowHasIssue(row('a', { tanss: warnCell }))).toBe(true);
    expect(rowHasIssue(row('a', { tanss: errorCell }))).toBe(true);
  });
});

describe('compareRowsBySeverityDesc', () => {
  it('error before warn before ok before empty', () => {
    const rows: CustomerHealthRow[] = [
      row('a-ok', { tanss: okCell }),
      row('b-error', { tanss: errorCell }),
      row('c-empty', {}),
      row('d-warn', { tanss: warnCell }),
    ];
    rows.sort(compareRowsBySeverityDesc);
    expect(rows.map((r) => r.slug)).toEqual(['b-error', 'd-warn', 'a-ok', 'c-empty']);
  });

  it('stable: same severity → sorts by slug alphabetically', () => {
    const rows: CustomerHealthRow[] = [
      row('b-warn', { tanss: warnCell }),
      row('a-warn', { tanss: warnCell }),
      row('c-warn', { tanss: warnCell }),
    ];
    rows.sort(compareRowsBySeverityDesc);
    expect(rows.map((r) => r.slug)).toEqual(['a-warn', 'b-warn', 'c-warn']);
  });
});
