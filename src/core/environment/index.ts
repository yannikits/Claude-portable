/**
 * Environment domain — public API.
 *
 * @module @core/environment
 */
export { resolveRoot, detectCloudProvider } from './root-resolver.js';
export { RootNotFoundError } from './types.js';
export type { ResolvedRoot, CloudProvider, RootSource } from './types.js';
