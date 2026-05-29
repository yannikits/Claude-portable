/**
 * AggregateCache — single-entry TTL cache for the MSP-Health snapshot.
 *
 * Design:
 *   - Only ONE slot (the latest snapshot) — we don't paginate snapshots.
 *   - `get()` returns null when no snapshot OR snapshot is older than TTL.
 *   - `getOrCompute(loader)` collapses concurrent callers onto a single
 *     in-flight Promise (cache-stampede protection: 10 admins hit refresh
 *     at once → ONE probe runs).
 *
 * @module @domains/msp-aggregate/cache
 */
import type { AggregateSnapshot } from './types.js';

export interface AggregateCacheOpts {
  /** TTL in seconds. Default 60. */
  readonly ttlSec?: number;
  /** Inject a clock for tests. Default `() => Date.now()`. */
  readonly now?: () => number;
}

export class AggregateCache {
  private snapshot: AggregateSnapshot | null = null;
  private storedAtMs = 0;
  private inFlight: Promise<AggregateSnapshot> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: AggregateCacheOpts = {}) {
    this.ttlMs = (opts.ttlSec ?? 60) * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Returns the current snapshot when fresh; null when stale or empty. */
  get(): AggregateSnapshot | null {
    if (this.snapshot === null) return null;
    if (this.now() - this.storedAtMs >= this.ttlMs) return null;
    return this.snapshot;
  }

  /** Returns the cached snapshot even if stale (for "show stale + queue refresh" UX). */
  getEvenIfStale(): AggregateSnapshot | null {
    return this.snapshot;
  }

  set(snapshot: AggregateSnapshot): void {
    this.snapshot = snapshot;
    this.storedAtMs = this.now();
  }

  invalidate(): void {
    this.snapshot = null;
    this.storedAtMs = 0;
  }

  /** Age of the current snapshot in ms, or null when empty. */
  ageMs(): number | null {
    if (this.snapshot === null) return null;
    return this.now() - this.storedAtMs;
  }

  /**
   * Return cached fresh snapshot if available; else run `loader()` and
   * cache+return its result. Concurrent callers share a single in-flight
   * promise (stampede protection).
   */
  async getOrCompute(loader: () => Promise<AggregateSnapshot>): Promise<AggregateSnapshot> {
    const cached = this.get();
    if (cached !== null) return cached;
    if (this.inFlight !== null) return this.inFlight;
    const promise = loader().then(
      (snap) => {
        this.set(snap);
        this.inFlight = null;
        return snap;
      },
      (err) => {
        this.inFlight = null;
        throw err;
      },
    );
    this.inFlight = promise;
    return promise;
  }
}
