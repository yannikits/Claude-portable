/**
 * Audit-Query — Read-only query layer over the JSONL audit log.
 *
 * The write path (`src/core/audit/`) is the source of truth: one append-only
 * file per UTC day at `<dataDir>/audit/audit-YYYY-MM-DD.jsonl`, fixed-key
 * schema (`AuditEntry`). This module is the **reader** that powers the
 * `/audit` Web-UI (Phase Audit-Trail-Dashboard, ADR-0037).
 *
 * Design goals:
 *   - Stream the JSONL files line-by-line — never load whole days into RAM.
 *   - Cross day-file boundaries when the time-range straddles them.
 *   - Filters compose with logical AND; an empty filter set returns
 *     everything within the time-range (still respecting pagination).
 *   - Newest-first sort by default — operators look at *what happened last*
 *     more than historical drift.
 *
 * @module @domains/audit-query/types
 */

import type { AuditEntry, AuditEventKind } from '../../core/audit/types.js';

/** Filter expression applied to entries. All non-undefined fields AND together. */
export interface AuditQuery {
  /** Lower bound (inclusive), ISO-8601. */
  readonly from?: string;
  /** Upper bound (inclusive), ISO-8601. */
  readonly to?: string;
  /**
   * Restrict to these event kinds. Empty array / undefined = no kind filter.
   * Pass a non-empty array to whitelist exactly those kinds.
   */
  readonly kinds?: readonly AuditEventKind[];
  /** Exact-match workspace filter. */
  readonly workspace?: string;
  /** Exact-match tenant id. */
  readonly tenant?: string;
  /** Outcome filter. */
  readonly outcome?: AuditEntry['outcome'];
  /** Case-insensitive substring match against the `action` field. */
  readonly actionContains?: string;
  /** Page offset (0-based). Default 0. */
  readonly offset?: number;
  /** Page size. Default 50, max 500. */
  readonly limit?: number;
}

/**
 * Result envelope. `total` is the total post-filter count across all
 * matching days (so the UI can show "1234 events match · showing 1–50"),
 * `entries` is the page slice already sorted newest-first.
 */
export interface AuditPage {
  readonly entries: readonly AuditEntry[];
  /** Total post-filter count (NOT including pagination). */
  readonly total: number;
  /** Echoed back so caller can persist last-used filter state. */
  readonly query: AuditQuery;
}

/**
 * Aggregated counts per event kind within the filter's time-range
 * (other filters are ignored — the user wants to *see* what kinds
 * exist before deciding what to filter further).
 */
export interface AuditStats {
  readonly counts: Partial<Record<AuditEventKind, number>>;
  readonly totalEvents: number;
  /** Range echoed for UI rendering. */
  readonly from?: string;
  readonly to?: string;
}

export type AuditExportFormat = 'jsonl' | 'csv';

export interface AuditExportResult {
  readonly content: string;
  /** Suggested filename including timestamp + format extension. */
  readonly suggestedFilename: string;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
