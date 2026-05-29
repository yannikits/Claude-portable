/**
 * NullBridge — reference implementation used by tests + as the
 * fallback `ReadBridge` when a concrete one (TANSS/Veeam/Sophos) is
 * not yet registered.
 *
 * Returns `{ kind: 'ok', data: { status: 'noop' } }` after a fixed
 * (zero-cost) delay. Honors the customer-misconfigured contract by
 * checking that at least one bridge-id is configured — otherwise
 * returns `misconfigured`. That makes it useful as a smoke-test
 * placeholder in the aggregat-layer.
 *
 * @module @domains/msp-bridges/null-bridge
 */
import type { CustomerRecord } from '../msp-customers/index.js';
import type { BridgeKind, BridgeProbe, ReadBridge } from './types.js';

export interface NullStatus {
  readonly status: 'noop';
}

export class NullBridge implements ReadBridge<NullStatus> {
  constructor(public readonly kind: BridgeKind) {}

  async probe(customer: CustomerRecord): Promise<BridgeProbe<NullStatus>> {
    const probedAt = new Date().toISOString();
    const start = Date.now();
    const subObject = (customer.bridges ?? {})[this.kind];
    if (subObject === undefined) {
      return {
        bridgeKind: this.kind,
        customerSlug: customer.slug,
        probedAt,
        durationMs: Date.now() - start,
        result: {
          kind: 'misconfigured',
          message: `customer.yaml has no bridges.${this.kind} section`,
        },
      };
    }
    return {
      bridgeKind: this.kind,
      customerSlug: customer.slug,
      probedAt,
      durationMs: Date.now() - start,
      result: { kind: 'ok', data: { status: 'noop' } },
    };
  }
}
