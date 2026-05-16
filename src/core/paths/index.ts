/**
 * Paths domain — platform-aware per-machine directories (ADR-0002).
 *
 * @module @core/paths
 */
export type { MachinePaths } from './types.js';
export { PathsResolutionError } from './types.js';
export { resolveMachinePaths, externalGitDirFor } from './machine-paths.js';
