/**
 * Query the audit-log across one or more UTC-day files.
 *
 * Time-range strategy: derive the set of day-files from `from`/`to`,
 * read each, concatenate, then apply the remaining filters in memory.
 * For multi-week ranges this loads N days × ~MB into RAM — fine for the
 * forensic Web-UI use-case (operator filters down quickly). If we ever
 * have years of dense audit-data we'll add a streaming variant.
 *
 * Sort: newest-first by `at` (lexicographic ISO-8601 compare works).
 *
 * @module @domains/audit-query/query
 */

import { join } from 'node:path';
import { auditDir } from '../../core/audit/paths.js';
import type { AuditEntry } from '../../core/audit/types.js';
import { readAuditFile } from './reader.js';
import { type AuditPage, type AuditQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './types.js';

export interface QueryOpts {
  /** Override audit-dir (for tests). Default: resolveMachinePaths().dataDir/audit. */
  readonly dir?: string;
  /** Override env (for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Execute a query. Returns the matching page + total count of matches
 * across the queried day-range.
 */
export function queryAudit(query: AuditQuery, opts: QueryOpts = {}): AuditPage {
  const dir = opts.dir ?? auditDir(opts.env === undefined ? {} : { env: opts.env });
  const days = enumerateDays(query.from, query.to);

  const all: AuditEntry[] = [];
  for (const day of days) {
    const file = join(dir, `audit-${day}.jsonl`);
    const fileEntries = readAuditFile(file);
    for (const entry of fileEntries) {
      if (matches(entry, query)) all.push(entry);
    }
  }

  // Newest-first sort — ISO-8601 strings compare correctly lexicographically.
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const limit = clamp(query.limit ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = Math.max(0, query.offset ?? 0);
  const entries = all.slice(offset, offset + limit);

  return { entries, total: all.length, query };
}

/**
 * Enumerate UTC day strings (YYYY-MM-DD) covered by `[from, to]`.
 * If both bounds are undefined, return only today (the operator's
 * default landing view).
 */
export function enumerateDays(from?: string, to?: string): string[] {
  const fromDate = parseDateOrUndefined(from);
  const toDate = parseDateOrUndefined(to);

  // No range at all → today only.
  if (fromDate === undefined && toDate === undefined) {
    return [toUtcDay(new Date())];
  }

  // Single bound → just that day.
  if (fromDate === undefined) return [toUtcDay(toDate as Date)];
  if (toDate === undefined) return [toUtcDay(fromDate)];

  // Both bounds — enumerate inclusive.
  // Guard against reversed bounds — return empty.
  if (fromDate > toDate) return [];

  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()),
  );
  const stop = new Date(
    Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()),
  );
  while (cursor.getTime() <= stop.getTime()) {
    days.push(toUtcDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function parseDateOrUndefined(s: string | undefined): Date | undefined {
  if (s === undefined || s.length === 0) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function matches(entry: AuditEntry, q: AuditQuery): boolean {
  // Time-range: parse to ms to avoid ISO-string-lexicographic gotcha
  // (e.g. '2026-05-29T00:00:00.000Z' < '2026-05-29T00:00:00Z' as strings,
  // but both represent the same instant).
  if (q.from !== undefined || q.to !== undefined) {
    const entryTs = Date.parse(entry.at);
    if (q.from !== undefined) {
      const fromTs = Date.parse(q.from);
      if (Number.isFinite(fromTs) && entryTs < fromTs) return false;
    }
    if (q.to !== undefined) {
      const toTs = Date.parse(q.to);
      if (Number.isFinite(toTs) && entryTs > toTs) return false;
    }
  }
  if (q.kinds !== undefined && q.kinds.length > 0 && !q.kinds.includes(entry.kind)) return false;
  if (q.workspace !== undefined && entry.workspace !== q.workspace) return false;
  if (q.tenant !== undefined && entry.tenant !== q.tenant) return false;
  if (q.outcome !== undefined && entry.outcome !== q.outcome) return false;
  if (q.actionContains !== undefined && q.actionContains.length > 0) {
    if (!entry.action.toLowerCase().includes(q.actionContains.toLowerCase())) return false;
  }
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
