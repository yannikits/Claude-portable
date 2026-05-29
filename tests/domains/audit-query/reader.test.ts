/**
 * Reader unit-tests — robust gegen partial-lines, malformed-json,
 * missing-file. Kein Filtering hier; das wird in query.test.ts geprueft.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAuditFile } from '../../../src/domains/audit-query/reader.js';

const FIXTURE = {
  schema_version: 1,
  at: '2026-05-29T10:00:00.000Z',
  kind: 'auth.login.success',
  action: 'login',
  workspace: 'system',
  outcome: 'ok',
  pid: 42,
  hostname: 'unit-test',
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'audit-reader-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('readAuditFile', () => {
  it('returns [] when file does not exist', () => {
    expect(readAuditFile(join(tmp, 'missing.jsonl'))).toEqual([]);
  });

  it('returns [] for empty file', () => {
    const f = join(tmp, 'empty.jsonl');
    writeFileSync(f, '');
    expect(readAuditFile(f)).toEqual([]);
  });

  it('parses a single valid line', () => {
    const f = join(tmp, 'one.jsonl');
    writeFileSync(f, `${JSON.stringify(FIXTURE)}\n`);
    expect(readAuditFile(f)).toEqual([FIXTURE]);
  });

  it('parses multiple lines in file-order (oldest first)', () => {
    const f = join(tmp, 'many.jsonl');
    const a = { ...FIXTURE, at: '2026-05-29T09:00:00.000Z' };
    const b = { ...FIXTURE, at: '2026-05-29T11:00:00.000Z' };
    writeFileSync(f, `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
    const out = readAuditFile(f);
    expect(out.map((e) => e.at)).toEqual([a.at, b.at]);
  });

  it('skips malformed lines silently', () => {
    const f = join(tmp, 'mixed.jsonl');
    writeFileSync(
      f,
      [JSON.stringify(FIXTURE), '{not valid json', '', JSON.stringify(FIXTURE)].join('\n'),
    );
    expect(readAuditFile(f)).toHaveLength(2);
  });

  it('skips JSON that does not match AuditEntry shape', () => {
    const f = join(tmp, 'wrong-shape.jsonl');
    writeFileSync(
      f,
      [
        JSON.stringify({ random: 'object', without: 'required fields' }),
        JSON.stringify(FIXTURE),
      ].join('\n'),
    );
    const out = readAuditFile(f);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(FIXTURE);
  });

  it('tolerates a partial tail-line during concurrent write', () => {
    const f = join(tmp, 'partial.jsonl');
    // First line complete, second half-written (no newline + truncated JSON).
    writeFileSync(f, `${JSON.stringify(FIXTURE)}\n{"at":"2026-05-29T12`);
    const out = readAuditFile(f);
    expect(out).toHaveLength(1);
  });
});
