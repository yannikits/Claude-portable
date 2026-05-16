/**
 * Vault-sync domain — Phase 2 (ADR-0002).
 *
 * @module @domains/vault-sync
 */
export type { SnapshotResult, SnapshotState } from './types.js';
export { detectVaultBranch, DetachedHeadError } from './branch-detect.js';
export { snapshot } from './snapshot.js';
