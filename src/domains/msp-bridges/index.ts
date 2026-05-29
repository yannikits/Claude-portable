/**
 * MSP-Bridges domain — Foundation for the per-MSP-system Read-Bridges.
 *
 * Phase 7-A ships:
 *   - typed `ReadBridge<T>` interface
 *   - `BridgeRegistry` (kind → instance)
 *   - `withAuditTrail()` wrapper (every probe → audit event)
 *   - `NullBridge` (reference implementation + test-double)
 *
 * Concrete bridges (TanssBridge, VeeamBridge, SophosBridge, …) ship in
 * Phase 7-B/C/D as separate modules; they implement `ReadBridge<TStatus>`
 * with a kind-specific status payload.
 *
 * @module @domains/msp-bridges
 */

export { type AuditWrapOpts, withAuditTrail } from './audit-wrapper.js';
export { NullBridge, type NullStatus } from './null-bridge.js';
export { BridgeRegistry } from './registry.js';
export {
  type BridgeKind,
  type BridgeProbe,
  BridgeRegistryError,
  type BridgeResult,
  type ReadBridge,
} from './types.js';
