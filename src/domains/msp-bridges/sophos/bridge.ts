/**
 * SophosBridge — per-customer Sophos XG/XGS Firewall Read-Bridge.
 *
 * Each `probe(customer)`:
 *   1. Reads `bridges.sophos.{firewallHostname, firewallPort?}` from customer.yaml
 *   2. Fetches credentials for that hostname via `getCredentialsForHost()`
 *   3. POSTs ONE XML request with TWO `<Get>` blocks (Firmware + LicenseInformation)
 *   4. Parses the XML response, returns `SophosStatus`
 *
 * Sophos has no session/token — credentials are embedded in EVERY
 * request body. So we always do exactly ONE HTTP call per probe.
 *
 * Hard-Contract per ADR-0038:
 *   - never throws
 *   - returns `misconfigured` without HTTP-call when bridges.sophos missing
 *   - returns `auth-failed` without HTTP-call when no creds in secrets-backend
 *   - durationMs is real
 *
 * @module @domains/msp-bridges/sophos/bridge
 */
import type { CustomerRecord } from '../../msp-customers/index.js';
import type { BridgeKind, BridgeProbe, BridgeResult, ReadBridge } from '../types.js';
import {
  classifyHttpStatus,
  classifySophosStatusCode,
  classifyThrown,
  isLoginFailure,
} from './classify-error.js';
import { mapSophosResponse } from './mapper.js';
import type { SophosBridgeConfig, SophosStatus } from './types.js';
import { buildGetRequest } from './xml-builder.js';
import { parseSophosResponse } from './xml-parser.js';

const DEFAULT_PORT = 4444;
const DEFAULT_TIMEOUT_MS = 15_000;
const API_PATH = '/webconsole/APIController';

export class SophosBridge implements ReadBridge<SophosStatus> {
  readonly kind: BridgeKind = 'sophos';
  private readonly defaultPort: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: SophosBridgeConfig) {
    this.defaultPort = config.defaultPort ?? DEFAULT_PORT;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    // insecureTls is honoured at bootstrap level via NODE_TLS_REJECT_UNAUTHORIZED.
  }

  async probe(customer: CustomerRecord): Promise<BridgeProbe<SophosStatus>> {
    const probedAt = new Date().toISOString();
    const start = Date.now();
    const ids = customer.bridges?.sophos;
    if (!ids) {
      return done(customer, probedAt, start, {
        kind: 'misconfigured',
        message: 'customer.yaml has no bridges.sophos section',
      });
    }

    const host = ids.firewallHostname;
    const port = ids.firewallPort ?? this.defaultPort;
    const url = `https://${host}:${port}${API_PATH}`;

    const creds = await this.config.getCredentialsForHost(host);
    if (creds === null || creds.username.length === 0 || creds.password.length === 0) {
      return done(customer, probedAt, start, {
        kind: 'auth-failed',
        message: `no credentials in secrets-backend for sophos host "${host}"`,
      });
    }

    const xmlBody = buildGetRequest({
      username: creds.username,
      password: creds.password,
      getTags: ['Firmware', 'LicenseInformation'],
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/xml',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ reqxml: xmlBody }).toString(),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return done(customer, probedAt, start, classifyThrown(err));
    }
    clearTimeout(timer);

    if (!response.ok) {
      return done(customer, probedAt, start, classifyHttpStatus(response.status));
    }

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (err) {
      return done(customer, probedAt, start, {
        kind: 'error',
        message: `failed to read body: ${err instanceof Error ? err.message : 'unknown'}`,
      });
    }

    const parsed = parseSophosResponse(bodyText);
    if (parsed.response === null) {
      return done(customer, probedAt, start, {
        kind: 'error',
        message: 'unparsable Sophos response (not XML or no <Response>)',
      });
    }

    // Top-level Status (534, 532, etc.) takes precedence over Login state.
    const statusErr = classifySophosStatusCode(
      parsed.responseStatusCode,
      parsed.responseStatusText,
    );
    if (statusErr !== null) {
      return done(customer, probedAt, start, statusErr);
    }

    if (isLoginFailure(parsed.response.Login?.status)) {
      return done(customer, probedAt, start, {
        kind: 'auth-failed',
        message: parsed.response.Login?.status ?? 'Authentication Failure',
      });
    }

    const status = mapSophosResponse(parsed);
    return done<SophosStatus>(customer, probedAt, start, { kind: 'ok', data: status });
  }
}

function done<T>(
  customer: CustomerRecord,
  probedAt: string,
  start: number,
  result: BridgeResult<T>,
): BridgeProbe<T> {
  return {
    bridgeKind: 'sophos',
    customerSlug: customer.slug,
    probedAt,
    durationMs: Date.now() - start,
    result,
  };
}
