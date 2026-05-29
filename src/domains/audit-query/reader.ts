/**
 * JSONL file reader — robust against partial lines / malformed JSON.
 *
 * Audit files are append-only with one JSON object per line. Reads happen
 * in the same process that writes (rare) or via the Web-UI (common). The
 * reader **never throws on malformed lines** — it skips them and continues
 * — because a half-written tail line during concurrent write must not
 * brick the query for the rest of the day.
 *
 * @module @domains/audit-query/reader
 */

import { existsSync, readFileSync } from 'node:fs';
import type { AuditEntry } from '../../core/audit/types.js';

/**
 * Read a single audit-jsonl file. Returns the entries in file order (oldest
 * first — the writer always appends), with malformed lines silently
 * dropped. Missing files return an empty array (operator may query a day
 * that had no events).
 */
export function readAuditFile(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  if (raw.length === 0) return [];

  const out: AuditEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isAuditEntry(parsed)) {
        out.push(parsed);
      }
    } catch {
      // Malformed line — could be a partial tail during concurrent write,
      // or schema drift from a future version. Skip silently; the rest of
      // the file is still useful forensic data.
    }
  }
  return out;
}

/**
 * Structural type-guard for AuditEntry. Cheap (no exhaustive Kind-check)
 * so partial reads still go through — the UI tolerates unknown kinds.
 */
function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.at === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.action === 'string' &&
    typeof v.workspace === 'string' &&
    typeof v.outcome === 'string' &&
    typeof v.pid === 'number' &&
    typeof v.hostname === 'string'
  );
}
