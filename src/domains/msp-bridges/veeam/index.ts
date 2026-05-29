/**
 * Veeam Read-Bridge — public surface.
 *
 * Wiring (typically in CLI `msp probe veeam <slug>` or Phase-7-E serve-bootstrap):
 *
 *   const veeam = new VeeamBridge({
 *     getCredentialsForHost: async (host) => {
 *       const u = await secrets.get(`veeam/${host}/username`);
 *       const p = await secrets.get(`veeam/${host}/password`);
 *       return u && p ? { username: u, password: p } : null;
 *     },
 *     apiVersion: process.env.CLAUDE_OS_VEEAM_API_VERSION,
 *     insecureTls: process.env.CLAUDE_OS_VEEAM_INSECURE_TLS === '1',
 *   });
 *   registry.register(withAuditTrail(veeam, auditLogger));
 *
 * @module @domains/msp-bridges/veeam
 */
export { oauthLogin, VeeamTokenCache } from './auth.js';
export { VeeamBridge } from './bridge.js';
export { classifyHttpStatus, classifyThrown, isApiVersionMismatch } from './classify-error.js';
export { veeamGet } from './http-client.js';
export { bucketOf, mapVeeamSessions } from './mapper.js';
export type {
  VeeamBridgeConfig,
  VeeamCredentials,
  VeeamCredentialsResolver,
  VeeamRun,
  VeeamSessionRaw,
  VeeamStatus,
} from './types.js';
