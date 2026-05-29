/**
 * Wrap a `ReadBridge` so every `probe()` call writes a `bridge.read`
 * audit event.
 *
 * Event-payload keeps PII out of the log:
 *   - `details.bridgeKind` (string)
 *   - `details.customerSlug` (the slug — NOT the customer's email/etc.)
 *   - `details.resultKind` (the discriminator: ok/error/…)
 *   - `details.durationMs`
 *   - On `error` / `auth-failed` / `unreachable`: short `details.message`
 *
 * The audit outcome maps as:
 *   - `ok`           → `outcome: 'ok'`
 *   - `auth-failed`  → `outcome: 'denied'`
 *   - all other      → `outcome: 'error'`
 *
 * @module @domains/msp-bridges/audit-wrapper
 */
import type { AuditLogger } from '../../core/audit/index.js';
import type { CustomerRecord } from '../msp-customers/index.js';
import { userToTenantId } from '../tenant/index.js';
import type { BridgeProbe, ReadBridge } from './types.js';

export interface AuditWrapOpts {
  /** Workspace name to record on the audit event. Default: `'system'`. */
  readonly workspace?: string;
}

/**
 * Returns a new `ReadBridge` that delegates to `inner.probe` and
 * mirror-writes the result to the audit log. The wrapper itself is
 * still read-only — it doesn't change the `inner` bridge's behaviour.
 */
export function withAuditTrail<T>(
  inner: ReadBridge<T>,
  audit: AuditLogger,
  opts: AuditWrapOpts = {},
): ReadBridge<T> {
  const workspace = opts.workspace ?? 'system';
  return {
    kind: inner.kind,
    async probe(customer: CustomerRecord): Promise<BridgeProbe<T>> {
      const probe = await inner.probe(customer);
      const resultKind = probe.result.kind;
      const outcome: 'ok' | 'denied' | 'error' =
        resultKind === 'ok' ? 'ok' : resultKind === 'auth-failed' ? 'denied' : 'error';
      const message =
        'message' in probe.result && typeof probe.result.message === 'string'
          ? probe.result.message
          : undefined;
      // Synthesize a tenant id that mirrors how customer-workspaces map
      // into the tenant resolver — see ADR-0033/0036. For now we just
      // pass the slug; the resolver will namespace it under
      // msp-customers/<slug>.
      audit.append({
        kind: 'bridge.read',
        action: `bridge.${inner.kind}.probe`,
        workspace,
        tenant: customer.slug,
        outcome,
        details: {
          bridgeKind: probe.bridgeKind,
          customerSlug: probe.customerSlug,
          resultKind,
          durationMs: probe.durationMs,
          ...(message !== undefined ? { message } : {}),
        },
      });
      return probe;
    },
  };
}

// Re-export so audit-wrapper consumers don't need to know the userToTenantId
// re-export rules — kept here for potential future use when the tenant-resolution
// gets richer than slug-as-tenant.
export { userToTenantId };
