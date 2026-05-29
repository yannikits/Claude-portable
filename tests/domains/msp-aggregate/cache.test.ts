import { describe, expect, it } from 'vitest';
import type { AggregateSnapshot } from '../../../src/domains/msp-aggregate/index.js';
import { AggregateCache } from '../../../src/domains/msp-aggregate/index.js';

function snap(at: string): AggregateSnapshot {
  return { snapshotAt: at, durationMs: 1, registeredBridges: ['tanss'], rows: [] };
}

describe('AggregateCache', () => {
  it('starts empty', () => {
    const c = new AggregateCache();
    expect(c.get()).toBeNull();
    expect(c.ageMs()).toBeNull();
    expect(c.peek?.()).toBeUndefined();
    expect(c.getEvenIfStale()).toBeNull();
  });

  it('get returns the snapshot until TTL elapses', () => {
    let t = 0;
    const c = new AggregateCache({ ttlSec: 1, now: () => t });
    c.set(snap('2026-05-29T20:00:00.000Z'));
    t += 999;
    expect(c.get()).not.toBeNull();
    t += 2;
    expect(c.get()).toBeNull();
  });

  it('getEvenIfStale survives TTL', () => {
    let t = 0;
    const c = new AggregateCache({ ttlSec: 1, now: () => t });
    c.set(snap('2026-05-29T20:00:00.000Z'));
    t += 10_000;
    expect(c.getEvenIfStale()).not.toBeNull();
  });

  it('invalidate clears get + ageMs', () => {
    const c = new AggregateCache();
    c.set(snap('x'));
    c.invalidate();
    expect(c.get()).toBeNull();
    expect(c.ageMs()).toBeNull();
  });

  it('ageMs reports difference since set', () => {
    let t = 100;
    const c = new AggregateCache({ now: () => t });
    c.set(snap('x'));
    t = 250;
    expect(c.ageMs()).toBe(150);
  });

  it('getOrCompute serves cache when fresh — loader NOT called', async () => {
    const t = 0;
    const c = new AggregateCache({ ttlSec: 1, now: () => t });
    c.set(snap('cached'));
    let calls = 0;
    const out = await c.getOrCompute(async () => {
      calls += 1;
      return snap('fresh');
    });
    expect(out.snapshotAt).toBe('cached');
    expect(calls).toBe(0);
  });

  it('getOrCompute runs loader on miss and caches result', async () => {
    const c = new AggregateCache({ ttlSec: 60 });
    const out = await c.getOrCompute(async () => snap('fresh'));
    expect(out.snapshotAt).toBe('fresh');
    // Second call should hit cache
    let secondCallLoaderCalled = false;
    const out2 = await c.getOrCompute(async () => {
      secondCallLoaderCalled = true;
      return snap('other');
    });
    expect(out2.snapshotAt).toBe('fresh');
    expect(secondCallLoaderCalled).toBe(false);
  });

  it('cache-stampede: 10 concurrent callers share ONE in-flight loader', async () => {
    const c = new AggregateCache({ ttlSec: 60 });
    let calls = 0;
    let resolveLoader: ((v: AggregateSnapshot) => void) | null = null;
    const loaderPromise = new Promise<AggregateSnapshot>((res) => {
      resolveLoader = res;
    });
    const loader = async () => {
      calls += 1;
      return loaderPromise;
    };
    const callers = Array.from({ length: 10 }, () => c.getOrCompute(loader));
    // give the in-flight registration a microtask
    await Promise.resolve();
    resolveLoader?.(snap('shared'));
    const results = await Promise.all(callers);
    expect(calls).toBe(1);
    for (const r of results) expect(r.snapshotAt).toBe('shared');
  });

  it('loader-throw clears in-flight so the NEXT call retries', async () => {
    const c = new AggregateCache({ ttlSec: 60 });
    let calls = 0;
    await expect(
      c.getOrCompute(async () => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Next call must call loader again (not stuck on a poisoned in-flight)
    const out = await c.getOrCompute(async () => snap('after-recovery'));
    expect(out.snapshotAt).toBe('after-recovery');
    expect(calls).toBe(1);
  });
});
