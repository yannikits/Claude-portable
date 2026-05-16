/**
 * Git-metadata migration domain (Phase 1.5, ADR-0002).
 *
 * @module @core/git-metadata
 */
export type { MigrationResult, MigrationState } from './types.js';
export { GitMetadataMigrationError } from './types.js';
export { migrateGitMetadata } from './migrator.js';
