/**
 * MSP-Health HTTP routes (Phase 7-E, ADR-0041).
 *
 * Three admin-gated endpoints over the aggregator:
 *
 *   GET  /api/msp-health/rows     → AggregateSnapshot (cache-hit-friendly)
 *   GET  /api/msp-health/config   → { registeredBridges, customerCount, cacheAgeMs }
 *   POST /api/msp-health/refresh  → invalidates cache, runs fresh probe
 *
 * Admin-gating follows the existing routes-audit.ts pattern:
 * env-driven `CLAUDE_OS_ADMIN_EMAILS` allowlist. Empty list → routes are
 * not registered (safe-by-default).
 *
 * Why GET for /rows + /config (not POST): same cache + DSGVO-investigation
 * rationale as ADR-0037 audit — filter-state should be URL-shareable
 * and access-log-greppable. Only the explicit cache-bust uses POST.
 *
 * @module @server/routes-msp-health
 */
import type { FastifyInstance } from 'fastify';
import type { MspHealthAggregator } from '../domains/msp-aggregate/index.js';

export interface MspHealthRoutesDeps {
  /** Lowercased + trimmed admin email allowlist. Empty → routes NOT registered. */
  readonly adminEmails: readonly string[];
  /** Aggregator singleton owned by the serve()-bootstrap. */
  readonly aggregator: MspHealthAggregator;
}

export function registerMspHealthRoutes(app: FastifyInstance, deps: MspHealthRoutesDeps): void {
  if (deps.adminEmails.length === 0) return;
  const allowlist = new Set(deps.adminEmails);
  const aggregator = deps.aggregator;

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

  app.get('/api/msp-health/rows', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const snap = await aggregator.getSnapshot();
    reply.send(snap);
  });

  app.get('/api/msp-health/config', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const peek = aggregator.peek();
    reply.send({
      registeredBridges: peek?.registeredBridges ?? [],
      customerCount: peek?.rows.length ?? null,
      cacheAgeMs: aggregator.cachedSnapshotAgeMs(),
    });
  });

  app.post('/api/msp-health/refresh', async (req, reply) => {
    if (requireAdmin(req, reply) === null) return;
    const snap = await aggregator.forceRefresh();
    reply.send(snap);
  });
}
