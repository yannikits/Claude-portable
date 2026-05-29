/**
 * Export query results as JSONL or CSV.
 *
 * - JSONL: round-trip-safe — one entry per line, schema preserved exactly.
 *   For developer / programmatic re-import.
 * - CSV: spreadsheet-friendly — flat columns, `details` JSON-stringified
 *   into a single cell. RFC-4180-style escaping (CRLF in cells, double
 *   quotes doubled). For DSGVO-Auskunfts-Übergabe in tabular form.
 *
 * Export uses the SAME filter as `queryAudit` but bypasses pagination —
 * the operator gets the complete matching set, capped by a configurable
 * safety-ceiling to avoid memory blow-ups on broad queries.
 *
 * @module @domains/audit-query/export
 */

import type { AuditEntry } from '../../core/audit/types.js';
import { queryAudit } from './query.js';
import type { AuditExportFormat, AuditExportResult, AuditQuery } from './types.js';

/** Hard cap — if a filter matches more than this, the export refuses with an error message. */
export const MAX_EXPORT_ROWS = 50_000;

export interface ExportOpts {
  readonly dir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class AuditExportTooLargeError extends Error {
  constructor(public readonly matched: number) {
    super(
      `Export refused: ${matched} matching entries exceed cap (${MAX_EXPORT_ROWS}). ` +
        'Narrow the filter (e.g. shorter time range or specific kind).',
    );
    this.name = 'AuditExportTooLargeError';
  }
}

export function exportAudit(
  query: AuditQuery,
  format: AuditExportFormat,
  opts: ExportOpts = {},
): AuditExportResult {
  // Bypass pagination by asking for the cap as page-size and 0 offset.
  const page = queryAudit({ ...query, offset: 0, limit: MAX_EXPORT_ROWS }, opts);
  if (page.total > MAX_EXPORT_ROWS) {
    throw new AuditExportTooLargeError(page.total);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suggestedFilename = `audit-export-${ts}.${format === 'csv' ? 'csv' : 'jsonl'}`;

  const content = format === 'csv' ? renderCsv(page.entries) : renderJsonl(page.entries);
  return { content, suggestedFilename };
}

function renderJsonl(entries: readonly AuditEntry[]): string {
  return `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
}

function renderCsv(entries: readonly AuditEntry[]): string {
  const header = [
    'at',
    'kind',
    'action',
    'workspace',
    'tenant',
    'outcome',
    'pid',
    'hostname',
    'schema_version',
    'details_json',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const e of entries) {
    lines.push(
      [
        e.at,
        e.kind,
        e.action,
        e.workspace,
        e.tenant ?? '',
        e.outcome,
        String(e.pid),
        e.hostname,
        String(e.schema_version),
        e.details === undefined ? '' : JSON.stringify(e.details),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * RFC-4180 cell escaping: if the value contains a comma, double-quote,
 * CR or LF, wrap it in double-quotes and double up any embedded
 * double-quotes.
 */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
