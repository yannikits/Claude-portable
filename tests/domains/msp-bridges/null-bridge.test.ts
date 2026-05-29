/**
 * NullBridge-Tests — reference-implementation contract.
 */
import { describe, expect, it } from 'vitest';
import { NullBridge } from '../../../src/domains/msp-bridges/index.js';
import type { CustomerRecord } from '../../../src/domains/msp-customers/index.js';

function customer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return { slug: 'mueller-gmbh', displayName: 'Mueller GmbH', ...overrides };
}

describe('NullBridge', () => {
  it('returns ok when the matching bridges sub-object is set', async () => {
    const b = new NullBridge('tanss');
    const probe = await b.probe(customer({ bridges: { tanss: { customerId: 42 } } }));
    expect(probe.bridgeKind).toBe('tanss');
    expect(probe.customerSlug).toBe('mueller-gmbh');
    expect(probe.result.kind).toBe('ok');
    if (probe.result.kind === 'ok') {
      expect(probe.result.data.status).toBe('noop');
    }
  });

  it('returns misconfigured when bridges sub-object is missing', async () => {
    const b = new NullBridge('tanss');
    const probe = await b.probe(customer());
    expect(probe.result.kind).toBe('misconfigured');
  });

  it('returns misconfigured when a DIFFERENT bridge kind is configured', async () => {
    const b = new NullBridge('tanss');
    const probe = await b.probe(customer({ bridges: { veeam: { jobNames: ['daily'] } } }));
    expect(probe.result.kind).toBe('misconfigured');
  });

  it('reports a non-negative durationMs and an ISO probedAt', async () => {
    const b = new NullBridge('veeam');
    const probe = await b.probe(customer({ bridges: { veeam: { jobNames: ['daily'] } } }));
    expect(probe.durationMs).toBeGreaterThanOrEqual(0);
    expect(() => new Date(probe.probedAt).toISOString()).not.toThrow();
  });

  it('never throws — even with an empty bridges record', async () => {
    const b = new NullBridge('sophos');
    await expect(b.probe(customer({ bridges: {} }))).resolves.toBeDefined();
  });
});
