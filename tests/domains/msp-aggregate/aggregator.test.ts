import { describe, expect, it } from 'vitest';
import { AggregateCache, MspHealthAggregator } from '../../../src/domains/msp-aggregate/index.js';
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
  ) {}
  async probe(c: CustomerRecord): Promise<BridgeProbe<T>> {
    this.probeCount += 1;
    return {
      bridgeKind: this.kind,
      customerSlug: c.slug,
      probedAt: new Date().toISOString(),
      durationMs: 1,
      result: this.result,
    };
  }
}

function makeRepo(customers: readonly CustomerRecord[]) {
  return async () => customers;
}

describe('MspHealthAggregator', () => {
  it('first call runs probes; second call within TTL serves cache (no new probes)', async () => {
    const registry = new BridgeRegistry();
    const stub = new StubBridge('tanss', { kind: 'ok', data: { x: 1 } });
    registry.register(stub);
    const customers: CustomerRecord[] = [
      { slug: 'a', displayName: 'A', bridges: { tanss: { customerId: 1 } } },
    ];
    const cache = new AggregateCache({ ttlSec: 60 });
    const aggr = new MspHealthAggregator({ registry, listCustomers: makeRepo(customers), cache });
    await aggr.getSnapshot();
    expect(stub.probeCount).toBe(1);
    await aggr.getSnapshot();
    await aggr.getSnapshot();
    expect(stub.probeCount).toBe(1); // still 1 — cached
  });

  it('forceRefresh re-runs probes', async () => {
    const registry = new BridgeRegistry();
    const stub = new StubBridge('tanss', { kind: 'ok', data: { x: 1 } });
    registry.register(stub);
    const customers: CustomerRecord[] = [
      { slug: 'a', displayName: 'A', bridges: { tanss: { customerId: 1 } } },
    ];
    const aggr = new MspHealthAggregator({ registry, listCustomers: makeRepo(customers) });
    await aggr.getSnapshot();
    await aggr.forceRefresh();
    expect(stub.probeCount).toBe(2);
  });

  it('peek returns cached snapshot without triggering a probe', async () => {
    const registry = new BridgeRegistry();
    const stub = new StubBridge('tanss', { kind: 'ok', data: {} });
    registry.register(stub);
    const aggr = new MspHealthAggregator({
      registry,
      listCustomers: makeRepo([]),
    });
    expect(aggr.peek()).toBeNull();
    await aggr.getSnapshot();
    expect(aggr.peek()).not.toBeNull();
  });

  it('listCustomers is called on every fresh probe (vault edits visible without restart)', async () => {
    const registry = new BridgeRegistry();
    registry.register(new StubBridge('tanss', { kind: 'ok', data: {} }));
    let listCalls = 0;
    const listCustomers = async () => {
      listCalls += 1;
      return [];
    };
    const aggr = new MspHealthAggregator({
      registry,
      listCustomers,
      cacheOpts: { ttlSec: 0 }, // forces miss every time
    });
    await aggr.getSnapshot();
    await aggr.getSnapshot();
    expect(listCalls).toBe(2);
  });

  it('cachedSnapshotAgeMs is null before first probe', async () => {
    const aggr = new MspHealthAggregator({
      registry: new BridgeRegistry(),
      listCustomers: makeRepo([]),
    });
    expect(aggr.cachedSnapshotAgeMs()).toBeNull();
    await aggr.getSnapshot();
    expect(aggr.cachedSnapshotAgeMs()).not.toBeNull();
  });
});
