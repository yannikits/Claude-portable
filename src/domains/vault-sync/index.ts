/**
 * Vault-sync domain — Phase 2 (ADR-0002).
 *
 * @module @domains/vault-sync
 */
export type { SnapshotResult, SnapshotState } from './types.js';
export { detectVaultBranch, DetachedHeadError } from './branch-detect.js';
export { snapshot } from './snapshot.js';
export {
  DEFAULT_GITIGNORE_LINES,
  applyDefaultGitignore,
  type ApplyGitignoreResult,
} from './gitignore-template.js';
export { BusyFlag, BusyFlagError, type BusyState } from './busy-flag.js';
