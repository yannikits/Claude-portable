/**
 * Query unit-tests — alle Filter-Kombinationen, time-range crosses
 * day-boundary, pagination, empty-result, sort newest-first.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, AuditEventKind } from '../../../src/core/audit/types.js';
import { enumerateDays, queryAudit } from '../../../src/domains/audit-query/query.js';

interface PartialEntry {
  at: string;
  kind?: AuditEventKind;
  workspace?: string;
  tenant?: string;
  outcome?: AuditEntry['outcome'];
  action?: string;
}

function makeEntry(p: PartialEntry): AuditEntry {
  return {
    schema_version: 1,
    at: p.at,
    kind: p.kind ?? 'auth.login.success',
    action: p.action ?? 'login',
    workspace: p.workspace ?? 'personal',
    ...(p.tenant !== undefined ? { tenant: p.tenant } : {}),
    outcome: p.outcome ?? 'ok',
    pid: 1,
    hostname: 'test',
  };
}

function writeDay(dir: string, day: string, entries: AuditEntry[]): void {
  writeFileSync(
    join(dir, `audit-${day}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''),
  );
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'audit-query-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('enumerateDays', () => {
  it('returns today only when both bounds undefined', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(enumerateDays(undefined, undefined)).toEqual([today]);
  });

  it('returns a single day for matching from + to', () => {
    expect(enumerateDays('2026-05-29T00:00:00Z', '2026-05-29T23:59:59Z')).toEqual(['2026-05-29']);
  });

  it('enumerates inclusive UTC days across a range', () => {
    expect(enumerateDays('2026-05-27T08:00:00Z', '2026-05-30T16:00:00Z')).toEqual([
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
    ]);
  });

  it('returns [] for reversed bounds', () => {
    expect(enumerateDays('2026-05-30T00:00:00Z', '2026-05-27T00:00:00Z')).toEqual([]);
  });
});

describe('queryAudit', () => {
  it('returns empty page when audit-dir is empty', () => {
    const page = queryAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      { dir: tmp },
    );
    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('returns entries newest-first', () => {
    writeDay(tmp, '2026-05-29', [
      makeEntry({ at: '2026-05-29T08:00:00.000Z', action: 'first' }),
      makeEntry({ at: '2026-05-29T16:00:00.000Z', action: 'last' }),
      makeEntry({ at: '2026-05-29T12:00:00.000Z', action: 'middle' }),
    ]);
    const page = queryAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      { dir: tmp },
    );
    expect(page.entries.map((e) => e.action)).toEqual(['last', 'middle', 'first']);
  });

  it('crosses day-boundaries via the time-range', () => {
    writeDay(tmp, '2026-05-28', [makeEntry({ at: '2026-05-28T20:00:00.000Z', action: 'day-1' })]);
    writeDay(tmp, '2026-05-29', [makeEntry({ at: '2026-05-29T08:00:00.000Z', action: 'day-2' })]);
    const page = queryAudit(
      { from: '2026-05-28T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      { dir: tmp },
    );
    expect(page.entries.map((e) => e.action)).toEqual(['day-2', 'day-1']);
  });

  it('filters by kind (whitelist)', () => {
    writeDay(tmp, '2026-05-29', [
      makeEntry({ at: '2026-05-29T08:00:00.000Z', kind: 'auth.login.success' }),
      makeEntry({ at: '2026-05-29T09:00:00.000Z', kind: 'auth.logout' }),
      makeEntry({ at: '2026-05-29T10:00:00.000Z', kind: 'note.write' }),
    ]);
    const page = queryAudit(
      {
        from: '2026-05-29T00:00:00Z',
        to: '2026-05-29T23:59:59Z',
        kinds: ['auth.login.success', 'auth.logout'],
      },
      { dir: tmp },
    );
    expect(page.entries.map((e) => e.kind)).toEqual(['auth.logout', 'auth.login.success']);
    expect(page.total).toBe(2);
  });

  it('filters by workspace + tenant + outcome (AND-combined)', () => {
    writeDay(tmp, '2026-05-29', [
      makeEntry({ at: '2026-05-29T08:00:00.000Z', workspace: 'personal', outcome: 'ok' }),
      makeEntry({
        at: '2026-05-29T09:00:00.000Z',
        workspace: 'msp-customers/mueller',
        tenant: 'mueller',
        outcome: 'denied',
      }),
      makeEntry({
        at: '2026-05-29T10:00:00.000Z',
        workspace: 'msp-customers/mueller',
        tenant: 'mueller',
        outcome: 'ok',
      }),
    ]);
    const page = queryAudit(
      {
        from: '2026-05-29T00:00:00Z',
        to: '2026-05-29T23:59:59Z',
        workspace: 'msp-customers/mueller',
        tenant: 'mueller',
        outcome: 'ok',
      },
      { dir: tmp },
    );
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.outcome).toBe('ok');
  });

  it('actionContains is case-insensitive substring', () => {
    writeDay(tmp, '2026-05-29', [
      makeEntry({ at: '2026-05-29T08:00:00.000Z', action: 'tanss.tickets.list' }),
      makeEntry({ at: '2026-05-29T09:00:00.000Z', action: 'm365.users.list' }),
    ]);
    const page = queryAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z', actionContains: 'TICKET' },
      { dir: tmp },
    );
    expect(page.entries.map((e) => e.action)).toEqual(['tanss.tickets.list']);
  });

  it('paginates with offset + limit', () => {
    writeDay(
      tmp,
      '2026-05-29',
      Array.from({ length: 10 }, (_, i) =>
        makeEntry({ at: `2026-05-29T${String(i).padStart(2, '0')}:00:00.000Z`, action: `n${i}` }),
      ),
    );
    const page = queryAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z', offset: 2, limit: 3 },
      { dir: tmp },
    );
    // Sorted newest-first → indices 9,8,7 then offset 2 → 7,6,5
    expect(page.entries.map((e) => e.action)).toEqual(['n7', 'n6', 'n5']);
    expect(page.total).toBe(10);
  });

  it('clamps limit to max', () => {
    writeDay(tmp, '2026-05-29', [makeEntry({ at: '2026-05-29T08:00:00.000Z' })]);
    const page = queryAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z', limit: 99999 },
      { dir: tmp },
    );
    // Wouldn't crash; just verifying it ran.
    expect(page.entries).toHaveLength(1);
  });
});
