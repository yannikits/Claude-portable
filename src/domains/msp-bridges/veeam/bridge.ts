/**
 * VeeamBridge — per-customer-VBR Read-Bridge (ADR-0040).
 *
 * Each `probe(customer)`:
 *   1. Reads customer.bridges.veeam.{serverHostname,serverPort?,jobNames?}
 *   2. Fetches credentials for that hostname via getCredentialsForHost()
 *   3. Uses cached OAuth token if fresh, else oauthLogin()
 *   4. GET /api/v1/sessions?typeFilter=Backup&limit=200
 *   5. mapVeeamSessions(...) → VeeamStatus
 *   6. On read-401: invalidate cache + ONE retry
 *
 * Each customer's VBR is its own auth boundary; the token cache is
 * keyed by hostname, so multiple customers on the same VBR share a
 * login. ADR-0038 hard-rules: never throws, credentials fetched per
 * probe, durationMs is real.
 *
 * @module @domains/msp-bridges/veeam/bridge
 */
import type { CustomerRecord } from '../../msp-customers/index.js';
import type { BridgeKind, BridgeProbe, BridgeResult, ReadBridge } from '../types.js';
import { oauthLogin, VeeamTokenCache } from './auth.js';
import { veeamGet } from './http-client.js';
import { mapVeeamSessions } from './mapper.js';
import type { VeeamBridgeConfig, VeeamCredentials, VeeamSessionRaw, VeeamStatus } from './types.js';

const DEFAULT_API_VERSION = '1.1-rev1';
const DEFAULT_PORT = 9419;
const DEFAULT_TIMEOUT_MS = 15_000;
const SESSIONS_PATH = '/api/v1/sessions?typeFilter=Backup&limit=200';

export class VeeamBridge implements ReadBridge<VeeamStatus> {
  readonly kind: BridgeKind = 'veeam';
  private readonly cache: VeeamTokenCache;
  private readonly apiVersion: string;
  private readonly defaultPort: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: VeeamBridgeConfig) {
    this.cache = new VeeamTokenCache();
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.defaultPort = config.defaultPort ?? DEFAULT_PORT;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    // insecureTls is opt-in; honoured by the fetch impl wired up at
    // bootstrap (we don't reach into Node's tls options here).
  }

  async probe(customer: CustomerRecord): Promise<BridgeProbe<VeeamStatus>> {
    const probedAt = new Date().toISOString();
    const start = Date.now();
    const ids = customer.bridges?.veeam;
    if (!ids) {
      return done(customer, probedAt, start, {
        kind: 'misconfigured',
        message: 'customer.yaml has no bridges.veeam section',
      });
    }

    const host = ids.serverHostname;
    const port = ids.serverPort ?? this.defaultPort;
    const baseUrl = `https://${host}:${port}`;

    const creds = await this.config.getCredentialsForHost(host);
    if (creds === null || !validCreds(creds)) {
      return done(customer, probedAt, start, {
        kind: 'auth-failed',
        message: `no credentials in secrets-backend for veeam host "${host}"`,
      });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    let token = this.cache.get(host);
    if (token === null) {
      const login = await oauthLogin({
        baseUrl,
        username: creds.username,
        password: creds.password,
        apiVersion: this.apiVersion,
        fetchImpl: this.fetchImpl,
        signal: ctrl.signal,
      });
      if (!login.ok) {
        clearTimeout(timer);
        return done(customer, probedAt, start, login.error);
      }
      this.cache.set(host, login.accessToken, login.expiresInSec);
      token = login.accessToken;
    }

    const response = await veeamGet<unknown>(SESSIONS_PATH, {
      baseUrl,
      apiVersion: this.apiVersion,
      token,
      relogin: async (): Promise<string | null> => {
        this.cache.invalidate(host);
        const freshCreds = await this.config.getCredentialsForHost(host);
        if (freshCreds === null || !validCreds(freshCreds)) return null;
        const login = await oauthLogin({
          baseUrl,
          username: freshCreds.username,
          password: freshCreds.password,
          apiVersion: this.apiVersion,
          fetchImpl: this.fetchImpl,
          signal: ctrl.signal,
        });
        if (!login.ok) return null;
        this.cache.set(host, login.accessToken, login.expiresInSec);
        return login.accessToken;
      },
      fetchImpl: this.fetchImpl,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return done(customer, probedAt, start, response.error);
    }

    const sessions = extractSessions(response.data);
    if (sessions === null) {
      return done(customer, probedAt, start, {
        kind: 'error',
        message: 'unexpected Veeam sessions response — neither array nor {data:[...]}',
      });
    }

    const status = mapVeeamSessions(sessions, {
      ...(ids.jobNames !== undefined ? { filterJobNames: ids.jobNames } : {}),
    });
    return done<VeeamStatus>(customer, probedAt, start, { kind: 'ok', data: status });
  }
}

function validCreds(c: VeeamCredentials): boolean {
  return c.username.length > 0 && c.password.length > 0;
}

/** Veeam wraps lists as `{ data: [...] }` typically; bare array tolerated. */
function extractSessions(raw: unknown): VeeamSessionRaw[] | null {
  if (Array.isArray(raw)) return raw as VeeamSessionRaw[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: VeeamSessionRaw[] }).data;
  }
  return null;
}

function done<T>(
  customer: CustomerRecord,
  probedAt: string,
  start: number,
  result: BridgeResult<T>,
): BridgeProbe<T> {
  return {
    bridgeKind: 'veeam',
    customerSlug: customer.slug,
    probedAt,
    durationMs: Date.now() - start,
    result,
  };
}
