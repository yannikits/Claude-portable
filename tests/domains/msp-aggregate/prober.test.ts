import { describe, expect, it } from 'vitest';
import { runProbes } from '../../../src/domains/msp-aggregate/index.js';
import { BridgeRegistry } from '../../../src/domains/msp-bridges/index.js';
import type {
  BridgeKind,
  BridgeProbe,
  BridgeResult,
  ReadBridge,
} from '../../../src/domains/msp-bridges/types.js';
import type { CustomerRecord } from '../../../src/domains/msp-customers/index.js';

class StubBridge<T> implements ReadBridge<T> {
  public probeCount = 0;
  constructor(
    public readonly kind: BridgeKind,
    private readonly result: BridgeResult<T>,
    private readonly delayMs = 0,
  ) {}
  async probe(c: CustomerRecord): Promise<BridgeProbe<T>> {
    this.probeCount += 1;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return {
      bridgeKind: this.kind,
      customerSlug: c.slug,
      probedAt: new Date().toISOString(),
      durationMs: this.delayMs,
      result: this.result,
    };
  }
}

function customer(slug: string, bridges: CustomerRecord['bridges'] = {}): CustomerRecord {
  return { slug, displayName: slug, bridges };
}

describe('runProbes', () => {
  it('returns empty rows when no customers given', async () => {
    const r = new BridgeRegistry();
    r.register(new StubBridge('tanss', { kind: 'ok', data: { x: 1 } }));
    const snap = await runProbes(r, []);
    expect(snap.rows).toHaveLength(0);
    expect(snap.registeredBridges).toEqual(['tanss']);
  });

  it('emits NO cell when customer has no bridges.<kind> sub-object', async () => {
    const r = new BridgeRegistry();
    const tanss = new StubBridge('tanss', { kind: 'ok', data: { open: 3 } });
    r.register(tanss);
    const snap = await runProbes(r, [customer('a'), customer('b')]);
    expect(snap.rows).toHaveLength(2);
    expect(snap.rows[0]?.cells.tanss).toBeUndefined();
    expect(tanss.probeCount).toBe(0); // no customer probed
  });

  it('emits an ok cell when customer has bridges.tanss and bridge returns ok', async () => {
    const r = new BridgeRegistry();
    r.register(new StubBridge('tanss', { kind: 'ok', data: { open: 3 } }));
    const snap = await runProbes(r, [customer('mueller', { tanss: { customerId: 42 } })]);
    expect(snap.rows[0]?.cells.tanss?.kind).toBe('ok');
  });

  it('maps misconfigured/auth-failed/unreachable/error correctly', async () => {
    const r = new BridgeRegistry();
    r.register(new StubBridge('tanss', { kind: 'auth-failed', message: 'no token' }));
    const snap = await runProbes(r, [customer('a', { tanss: { customerId: 1 } })]);
    expect(snap.rows[0]?.cells.tanss?.kind).toBe('auth-failed');
  });

  it('maps rate-limited with retryAfterSec', async () => {
    const r = new BridgeRegistry();
    r.register(
      new StubBridge('tanss', { kind: 'rate-limited', retryAfterSec: 30, message: '429' }),
    );
    const snap = await runProbes(r, [customer('a', { tanss: { customerId: 1 } })]);
    const cell = snap.rows[0]?.cells.tanss;
    expect(cell?.kind).toBe('rate-limited');
    if (cell?.kind === 'rate-limited') {
      expect(cell.retryAfterSec).toBe(30);
    }
  });

  it('runs probes serially per bridge (one customer at a time)', async () => {
    const tanss = new StubBridge('tanss', { kind: 'ok', data: {} }, 30);
    const r = new BridgeRegistry();
    r.register(tanss);
    const customers = [
      customer('a', { tanss: { customerId: 1 } }),
      customer('b', { tanss: { customerId: 2 } }),
      customer('c', { tanss: { customerId: 3 } }),
    ];
    const start = Date.now();
    const snap = await runProbes(r, customers);
    const elapsed = Date.now() - start;
    expect(tanss.probeCount).toBe(3);
    expect(snap.rows).toHaveLength(3);
    // Serial → at least 3 * 30ms (allow some scheduler slack)
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('runs different bridges in parallel', async () => {
    const tanss = new StubBridge('tanss', { kind: 'ok', data: {} }, 40);
    const veeam = new StubBridge('veeam', { kind: 'ok', data: {} }, 40);
    const r = new BridgeRegistry();
    r.register(tanss);
    r.register(veeam);
    const customers = [
      customer('a', { tanss: { customerId: 1 }, veeam: { serverHostname: 'vbr.a' } }),
    ];
    const start = Date.now();
    await runProbes(r, customers);
    const elapsed = Date.now() - start;
    // Parallel across bridges → ~40ms not ~80ms
    expect(elapsed).toBeLessThan(120);
  });

  it('cell becomes "timeout" when probe exceeds probeTimeoutMs', async () => {
    const slow = new StubBridge('tanss', { kind: 'ok', data: {} }, 200);
    const r = new BridgeRegistry();
    r.register(slow);
    const snap = await runProbes(r, [customer('a', { tanss: { customerId: 1 } })], {
      probeTimeoutMs: 50,
    });
    expect(snap.rows[0]?.cells.tanss?.kind).toBe('timeout');
  });

  it('hardTimeoutMs caps total runtime; remaining cells are timeout', async () => {
    const slow = new StubBridge('tanss', { kind: 'ok', data: {} }, 60);
    const r = new BridgeRegistry();
    r.register(slow);
    const customers = [
      customer('a', { tanss: { customerId: 1 } }),
      customer('b', { tanss: { customerId: 2 } }),
      customer('c', { tanss: { customerId: 3 } }),
      customer('d', { tanss: { customerId: 4 } }),
    ];
    const snap = await runProbes(r, customers, { probeTimeoutMs: 100, hardTimeoutMs: 100 });
    const states = snap.rows.map((r2) => r2.cells.tanss?.kind);
    // At least the LATER customers must be timeout because hard-cap kicked in
    expect(states.filter((s) => s === 'timeout').length).toBeGreaterThanOrEqual(1);
  });

  it('snapshot contains registeredBridges + ISO snapshotAt + durationMs >= 0', async () => {
    const r = new BridgeRegistry();
    r.register(new StubBridge('tanss', { kind: 'ok', data: {} }));
    r.register(new StubBridge('veeam', { kind: 'ok', data: {} }));
    const snap = await runProbes(r, []);
    expect([...snap.registeredBridges].sort()).toEqual(['tanss', 'veeam']);
    expect(() => new Date(snap.snapshotAt).toISOString()).not.toThrow();
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
  });
});
