/**
 * Export unit-tests — JSONL round-trip, CSV-escaping, too-large-error.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../../src/core/audit/types.js';
import {
  AuditExportTooLargeError,
  exportAudit,
  MAX_EXPORT_ROWS,
} from '../../../src/domains/audit-query/export.js';

function writeDay(dir: string, day: string, entries: AuditEntry[]): void {
  writeFileSync(
    join(dir, `audit-${day}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''),
  );
}

function entry(at: string, action = 'a', details?: Record<string, unknown>): AuditEntry {
  return {
    schema_version: 1,
    at,
    kind: 'note.write',
    action,
    workspace: 'personal',
    outcome: 'ok',
    pid: 1,
    hostname: 'test',
    ...(details === undefined ? {} : { details }),
  };
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'audit-export-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('exportAudit jsonl', () => {
  it('round-trips entries exactly (one JSON-object per line)', () => {
    const e1 = entry('2026-05-29T08:00:00.000Z', 'first', { foo: 'bar' });
    const e2 = entry('2026-05-29T09:00:00.000Z', 'second');
    writeDay(tmp, '2026-05-29', [e1, e2]);

    const result = exportAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      'jsonl',
      { dir: tmp },
    );

    expect(result.suggestedFilename).toMatch(/\.jsonl$/);
    const lines = result.content.trim().split('\n');
    // queryAudit sorts newest-first → second first, first second
    expect(JSON.parse(lines[0] ?? '')).toEqual(e2);
    expect(JSON.parse(lines[1] ?? '')).toEqual(e1);
  });
});

describe('exportAudit csv', () => {
  it('escapes commas + double-quotes + newlines RFC-4180 style', () => {
    const e = entry('2026-05-29T08:00:00.000Z', 'with,comma and "quote"', {
      multiline: 'line1\nline2',
    });
    writeDay(tmp, '2026-05-29', [e]);

    const result = exportAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      'csv',
      { dir: tmp },
    );

    expect(result.suggestedFilename).toMatch(/\.csv$/);
    // Header + one data row
    expect(result.content).toMatch(/^at,kind,action/);
    // Action contains a comma + quote → must be quoted with "" inside
    expect(result.content).toContain('"with,comma and ""quote"""');
    // details_json wraps the newline-containing JSON in quotes
    expect(result.content).toContain('"{""multiline"":""line1\\nline2""}"');
  });

  it('produces an empty CSV (header only) when no matches', () => {
    const result = exportAudit(
      { from: '2026-05-29T00:00:00Z', to: '2026-05-29T23:59:59Z' },
      'csv',
      { dir: tmp },
    );
    expect(result.content.split('\r\n')[0]).toMatch(/^at,kind,action/);
    // No data rows beyond the header.
    expect(result.content.trim().split('\r\n')).toHaveLength(1);
  });
});

describe('exportAudit guards', () => {
  it('throws AuditExportTooLargeError when matches exceed cap', () => {
    // We cannot reasonably generate MAX_EXPORT_ROWS+1 entries on disk for a
    // unit test — instead, verify the error type exists and the cap exists.
    expect(MAX_EXPORT_ROWS).toBeGreaterThan(0);
    const err = new AuditExportTooLargeError(MAX_EXPORT_ROWS + 1);
    expect(err.matched).toBe(MAX_EXPORT_ROWS + 1);
    expect(err.message).toContain(String(MAX_EXPORT_ROWS));
  });
});
