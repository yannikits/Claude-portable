/**
 * Audit-query HTTP routes (Phase Audit-Trail-Dashboard, ADR-0037).
 *
 * Read-only endpoints over the audit JSONL log. Powers the `/audit` Web-UI.
 * Same admin-gating pattern as `routes-admin.ts` (env-driven
 * `CLAUDE_OS_ADMIN_EMAILS` allowlist). Empty allowlist → routes are
 * not registered at all (safe-by-default).
 *
 * Endpoints (all GET to make caching/audit-trail simple):
 *   GET /api/audit/list      → { entries, total, query }
 *   GET /api/audit/stats     → { counts, totalEvents, from?, to? }
 *   GET /api/audit/export    → { content, suggestedFilename }
 *
 * All query parameters come from the URL query-string so they show up in
 * access logs (good — meta-audit-trail). The JSON-RPC dispatcher is
 * intentionally NOT used here because audit-RPCs need the authenticated
 * caller's email (from `req.user`), which only the HTTP transport layer
 * provides.
 *
 * @module @server/routes-audit
 */
import type { FastifyInstance } from 'fastify';
import type { AuditEventKind } from '../core/audit/types.js';
import {
  type AuditExportFormat,
  AuditExportTooLargeError,
  type AuditQuery,
  auditStats,
  exportAudit,
  queryAudit,
} from '../domains/audit-query/index.js';

export interface AuditRoutesDeps {
  /**
   * Lowercased + trimmed admin email allowlist. Empty array means the
   * audit routes are not registered at all (see module header).
   */
  readonly adminEmails: readonly string[];
  /**
   * Override audit-dir (for tests). Default: resolved from
   * `resolveMachinePaths().dataDir/audit` at request time.
   */
  readonly auditDir?: string;
}

export function registerAuditRoutes(app: FastifyInstance, deps: AuditRoutesDeps): void {
  if (deps.adminEmails.length === 0) {
    return;
  }
  const allowlist = new Set(deps.adminEmails);

  // Same inline-guard pattern as routes-admin.ts (M1 review): runs AFTER
  // the cookie-auth hook so req.user is already populated.
  const requireAdmin = (
    req: { user?: { email: string } },
    reply: { code: (n: number) => { send: (b: unknown) => void } },
  ): string | null => {
    if (req.user === undefined) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'cookie-auth required' } });
      return null;
    }
    const email = req.user.email.toLowerCase();
    if (!allowlist.has(email)) {
      reply.code(403).send({ error: { code: 'forbidden', message: 'admin role required' } });
      return null;
    }
    return req.user.email;
  };

  const queryOpts = deps.auditDir !== undefined ? { dir: deps.auditDir } : {};

  app.get('/api/audit/list', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const query = parseQuery(req.query as Record<string, unknown>);
    const page = queryAudit(query, queryOpts);
    reply.send(page);
  });

  app.get('/api/audit/stats', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const query = parseQuery(req.query as Record<string, unknown>);
    const stats = auditStats(query, queryOpts);
    reply.send(stats);
  });

  app.get('/api/audit/export', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const params = req.query as Record<string, unknown>;
    const query = parseQuery(params);
    const format = parseFormat(params.format);
    try {
      const result = exportAudit(query, format, queryOpts);
      reply.send(result);
    } catch (err) {
      if (err instanceof AuditExportTooLargeError) {
        reply.code(413).send({
          error: { code: 'export-too-large', message: err.message, matched: err.matched },
        });
        return;
      }
      throw err;
    }
  });
}

/**
 * Parse query-string params into an AuditQuery. Tolerant — invalid /
 * missing params just yield `undefined` so the caller defaults to a
 * sensible empty filter.
 */
function parseQuery(params: Record<string, unknown>): AuditQuery {
  const q: Record<string, unknown> = {};
  const str = (k: string): string | undefined => {
    const v = params[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const num = (k: string): number | undefined => {
    const v = params[k];
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number.parseInt(v, 10);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return undefined;
  };
  if (str('from') !== undefined) q.from = str('from');
  if (str('to') !== undefined) q.to = str('to');
  if (str('workspace') !== undefined) q.workspace = str('workspace');
  if (str('tenant') !== undefined) q.tenant = str('tenant');
  if (str('actionContains') !== undefined) q.actionContains = str('actionContains');
  const outcome = str('outcome');
  if (outcome === 'ok' || outcome === 'denied' || outcome === 'error') q.outcome = outcome;
  // kinds can be repeated (?kinds=a&kinds=b) or comma-separated.
  const kindsRaw = params.kinds;
  if (Array.isArray(kindsRaw)) {
    q.kinds = kindsRaw.filter((k): k is string => typeof k === 'string') as AuditEventKind[];
  } else if (typeof kindsRaw === 'string' && kindsRaw.length > 0) {
    q.kinds = kindsRaw.split(',').filter((k) => k.length > 0) as AuditEventKind[];
  }
  if (num('offset') !== undefined) q.offset = num('offset');
  if (num('limit') !== undefined) q.limit = num('limit');
  return q as AuditQuery;
}

function parseFormat(raw: unknown): AuditExportFormat {
  return raw === 'csv' ? 'csv' : 'jsonl';
}
