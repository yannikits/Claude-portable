/**
 * MSP-Aggregate domain — Phase 7-E.
 *
 * Aggregates per-customer Read-Bridge results into a single dashboard
 * snapshot. Owns the TTL cache + cache-stampede protection. Consumed by
 * the admin-gated HTTP routes and (eventually) the React frontend.
 *
 * @module @domains/msp-aggregate
 */
export { MspHealthAggregator, type MspHealthAggregatorDeps } from './aggregator.js';
export { AggregateCache, type AggregateCacheOpts } from './cache.js';
export { runProbes } from './prober.js';
export type {
  AggregateProberOpts,
  AggregateSnapshot,
  BridgeCellResult,
  CustomerHealthCells,
  CustomerHealthRow,
} from './types.js';
