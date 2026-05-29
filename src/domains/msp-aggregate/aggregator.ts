/**
 * MspHealthAggregator — thin glue between Registry + CustomerRepository
 * + Cache + Prober. Owned by the serve()-bootstrap as a singleton.
 *
 * Responsibilities:
 *   - Resolve customer-list on each refresh (so adding a customer-workspace
 *     surfaces it without a server restart)
 *   - Cache-or-compute the snapshot
 *   - Expose a `forceRefresh()` for the POST /refresh route
 *
 * Owns nothing the routes layer needs to know about — routes just call
 * `getSnapshot()` and ship the result.
 *
 * @module @domains/msp-aggregate/aggregator
 */
import type { BridgeRegistry } from '../msp-bridges/registry.js';
import type { CustomerRecord } from '../msp-customers/index.js';
import { AggregateCache, type AggregateCacheOpts } from './cache.js';
import { runProbes } from './prober.js';
import type { AggregateProberOpts, AggregateSnapshot } from './types.js';

export interface MspHealthAggregatorDeps {
  readonly registry: BridgeRegistry;
  /** Callable so the repo state is read fresh each refresh (vault-edit support). */
  readonly listCustomers: () => Promise<readonly CustomerRecord[]>;
  readonly cache?: AggregateCache;
  readonly cacheOpts?: AggregateCacheOpts;
  readonly proberOpts?: AggregateProberOpts;
}

export class MspHealthAggregator {
  private readonly cache: AggregateCache;

  constructor(private readonly deps: MspHealthAggregatorDeps) {
    this.cache = deps.cache ?? new AggregateCache(deps.cacheOpts);
  }

  /** Cache-hit-friendly path: returns cached snapshot or runs a fresh probe. */
  async getSnapshot(): Promise<AggregateSnapshot> {
    return this.cache.getOrCompute(async () => {
      const customers = await this.deps.listCustomers();
      return runProbes(this.deps.registry, customers, this.deps.proberOpts);
    });
  }

  /** Bypasses the cache. */
  async forceRefresh(): Promise<AggregateSnapshot> {
    this.cache.invalidate();
    return this.getSnapshot();
  }

  /** Age of the cached snapshot in ms, or null when empty. */
  cachedSnapshotAgeMs(): number | null {
    return this.cache.ageMs();
  }

  /** Returns the cached snapshot without triggering a probe. */
  peek(): AggregateSnapshot | null {
    return this.cache.getEvenIfStale();
  }
}
