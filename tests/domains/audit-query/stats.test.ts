/**
 * Stats unit-tests — Count-Aggregation pro Kind, honours only time-range.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, AuditEventKind } from '../../../src/core/audit/types.js';
import { auditStats } from '../../../src/domains/audit-query/stats.js';

function entry(at: string, kind: AuditEventKind, workspace = 'personal'): AuditEntry {
  return {
    schema_version: 1,
    at,
    kind,
    action: 'x',
    workspace,
    outcome: 'ok',
    pid: 1,
    hostname: 'test',
  };
}

function writeDay(dir: string, day: string, entries: AuditEntry[]): void {
  writeFileSync(
    join(dir, `audit-${day}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'audit-stats-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('auditStats', () => {
  it('returns zeros for an empty audit-dir', () => {
    const s = auditStats(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      { dir: tmp },
    );
    expect(s.counts).toEqual({});
    expect(s.totalEvents).toBe(0);
  });

  it('aggregates counts per kind across the range', () => {
    writeDay(tmp, '2026-05-29', [
      entry('2026-05-29T08:00:00.000Z', 'auth.login.success'),
      entry('2026-05-29T09:00:00.000Z', 'auth.login.success'),
      entry('2026-05-29T10:00:00.000Z', 'note.write'),
    ]);
    const s = auditStats(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      { dir: tmp },
    );
    expect(s.counts['auth.login.success']).toBe(2);
    expect(s.counts['note.write']).toBe(1);
    expect(s.totalEvents).toBe(3);
  });

  it('ignores workspace/tenant/outcome filters (range-only scope)', () => {
    writeDay(tmp, '2026-05-29', [
      entry('2026-05-29T08:00:00.000Z', 'note.write', 'personal'),
      entry('2026-05-29T09:00:00.000Z', 'note.write', 'msp-customers/x'),
    ]);
    const s = auditStats(
      {
        from: '2026-05-29T00:00:00Z',
        to: '2026-05-29T23:59:59Z',
        workspace: 'personal',
        // workspace filter should be IGNORED by stats — both entries count
      },
      { dir: tmp },
    );
    expect(s.counts['note.write']).toBe(2);
  });
});
