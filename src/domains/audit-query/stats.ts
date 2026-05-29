/**
 * Aggregate counts per AuditEventKind across the filter's time-range.
 *
 * Used by the dashboard's stats-strip — operator wants to see "what
 * kinds even exist" before drilling down. Intentionally honours only
 * the time-range from the query, NOT the kind/workspace/tenant/outcome
 * filters — because the whole point is to discover those.
 *
 * @module @domains/audit-query/stats
 */

import { join } from 'node:path';
import { auditDir } from '../../core/audit/paths.js';
import type { AuditEventKind } from '../../core/audit/types.js';
import { enumerateDays } from './query.js';
import { readAuditFile } from './reader.js';
import type { AuditQuery, AuditStats } from './types.js';

export interface StatsOpts {
  readonly dir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function auditStats(query: AuditQuery, opts: StatsOpts = {}): AuditStats {
  const dir = opts.dir ?? auditDir(opts.env === undefined ? {} : { env: opts.env });
  const days = enumerateDays(query.from, query.to);

  const fromTs = query.from !== undefined ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
  const toTs = query.to !== undefined ? Date.parse(query.to) : Number.POSITIVE_INFINITY;

  const counts: Partial<Record<AuditEventKind, number>> = {};
  let total = 0;
  for (const day of days) {
    const file = join(dir, `audit-${day}.jsonl`);
    const fileEntries = readAuditFile(file);
    for (const entry of fileEntries) {
      // Only the time-range filter applies — see module comment.
      // Parse ms to avoid ISO-string-lexicographic gotcha (see query.ts).
      const entryTs = Date.parse(entry.at);
      if (entryTs < fromTs) continue;
      if (entryTs > toTs) continue;
      const k = entry.kind as AuditEventKind;
      counts[k] = (counts[k] ?? 0) + 1;
      total += 1;
    }
  }

  return {
    counts,
    totalEvents: total,
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
  };
}
