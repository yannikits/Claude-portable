/**
 * Sophos XG/XGS Firewall Read-Bridge — public surface.
 *
 * Wiring (typically in CLI `msp probe sophos <slug>` or Phase-7-E bootstrap):
 *
 *   const sophos = new SophosBridge({
 *     getCredentialsForHost: async (host) => {
 *       const u = await secrets.get(`sophos/${host}/username`);
 *       const p = await secrets.get(`sophos/${host}/password`);
 *       return u && p ? { username: u, password: p } : null;
 *     },
 *     insecureTls: process.env.CLAUDE_OS_SOPHOS_INSECURE_TLS === '1',
 *   });
 *   registry.register(withAuditTrail(sophos, auditLogger));
 *
 * @module @domains/msp-bridges/sophos
 */
export { SophosBridge } from './bridge.js';
export {
  classifyHttpStatus,
  classifySophosStatusCode,
  classifyThrown,
  isLoginFailure,
} from './classify-error.js';
export { mapSophosResponse, summarizeLicense } from './mapper.js';
export type {
  LicenseSummary,
  SophosBridgeConfig,
  SophosFirmwareRaw,
  SophosLicenseInfoRaw,
  SophosResponseRaw,
  SophosStatus,
  SophosSubscriptionRaw,
  SubscriptionInfo,
} from './types.js';
export { buildGetRequest, escapeXml } from './xml-builder.js';
export { extractSubscriptions, parseSophosResponse } from './xml-parser.js';
