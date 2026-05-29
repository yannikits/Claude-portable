/**
 * BridgeRegistry — Map BridgeKind → ReadBridge<unknown> instance.
 *
 * Bootstrap pattern: an operator-spawned `claude-os serve` constructs
 * the registry once, registers all concrete bridges (TanssBridge,
 * VeeamBridge, …) and passes the registry through to the routes /
 * dispatcher.
 *
 * Why not a global module-singleton: tests + secondary processes
 * (workers) want their own registry without cross-contamination.
 *
 * @module @domains/msp-bridges/registry
 */
import { type BridgeKind, BridgeRegistryError, type ReadBridge } from './types.js';

export class BridgeRegistry {
  private readonly bridges = new Map<BridgeKind, ReadBridge<unknown>>();

  register<T>(bridge: ReadBridge<T>): void {
    if (this.bridges.has(bridge.kind)) {
      throw new BridgeRegistryError(
        `Bridge of kind "${bridge.kind}" already registered — call unregister() first`,
      );
    }
    this.bridges.set(bridge.kind, bridge as ReadBridge<unknown>);
  }

  unregister(kind: BridgeKind): void {
    this.bridges.delete(kind);
  }

  /** Returns null when no bridge of that kind is registered. */
  get(kind: BridgeKind): ReadBridge<unknown> | null {
    return this.bridges.get(kind) ?? null;
  }

  /** All currently-registered kinds in registration-order. */
  kinds(): readonly BridgeKind[] {
    return [...this.bridges.keys()];
  }

  /** Number of registered bridges (useful for liveness telemetry). */
  size(): number {
    return this.bridges.size;
  }

  clear(): void {
    this.bridges.clear();
  }
}
