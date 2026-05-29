/**
 * Audit-Query domain — read-only query layer over the audit-log JSONL.
 * Powers the `/audit` Web-UI (Phase Audit-Trail-Dashboard, ADR-0037).
 *
 * @module @domains/audit-query
 */

export { AuditExportTooLargeError, exportAudit, MAX_EXPORT_ROWS } from './export.js';
export { enumerateDays, queryAudit } from './query.js';
export { readAuditFile } from './reader.js';
export { auditStats } from './stats.js';
export type {
  AuditExportFormat,
  AuditExportResult,
  AuditPage,
  AuditQuery,
  AuditStats,
} from './types.js';
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './types.js';
