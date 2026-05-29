/**
 * Veeam OAuth2 token acquisition + per-host in-memory token cache.
 *
 * Flow (Veeam VBR REST API v12+):
 *   POST {base}/api/oauth2/token
 *     Headers: x-api-version, Content-Type: application/x-www-form-urlencoded
 *     Body:    grant_type=password&username=<u>&password=<p>
 *   Response: { access_token, refresh_token, expires_in, token_type:"bearer" }
 *
 * Cache: Map<host, {token, expiresAtMs}>. The bridge owns this cache;
 * tests construct a fresh `TokenCache` each test. ADR-0038's "fetch the
 * secret per call" rule is honoured: we call `getCredentialsForHost()`
 * on every probe, but only do a network OAuth-login when the cached
 * token is missing/expired.
 *
 * @module @domains/msp-bridges/veeam/auth
 */
import type { BridgeResult } from '../types.js';
import { classifyHttpStatus, classifyThrown } from './classify-error.js';

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export class VeeamTokenCache {
  private readonly map = new Map<string, CachedToken>();
  /** Margin before `expires_in` we consider a token expired. Default 60s. */
  constructor(private readonly marginMs: number = 60_000) {}

  get(host: string): string | null {
    const c = this.map.get(host);
    if (c === undefined) return null;
    if (Date.now() >= c.expiresAtMs - this.marginMs) return null;
    return c.token;
  }

  set(host: string, token: string, expiresInSec: number): void {
    this.map.set(host, { token, expiresAtMs: Date.now() + expiresInSec * 1000 });
  }

  /** Invalidate after a 401 on a read so the next probe will re-login. */
  invalidate(host: string): void {
    this.map.delete(host);
  }

  size(): number {
    return this.map.size;
  }
}

export interface OAuthLoginOpts {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly apiVersion: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export type OAuthResult =
  | { ok: true; accessToken: string; expiresInSec: number }
  | { ok: false; error: BridgeResult<never> };

export async function oauthLogin(opts: OAuthLoginOpts): Promise<OAuthResult> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: opts.username,
    password: opts.password,
  }).toString();

  let response: Response;
  try {
    response = await opts.fetchImpl(`${opts.baseUrl}/api/oauth2/token`, {
      method: 'POST',
      headers: {
        'x-api-version': opts.apiVersion,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }

  if (!response.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = undefined;
    }
    return {
      ok: false,
      error: classifyHttpStatus(response.status, response.headers.get('retry-after'), bodyText),
    };
  }

  let parsed: { access_token?: unknown; expires_in?: unknown };
  try {
    parsed = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'error', message: `invalid OAuth response JSON: ${shortMsg(err)}` },
    };
  }

  const accessToken = parsed.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return {
      ok: false,
      error: { kind: 'error', message: 'OAuth response missing access_token' },
    };
  }
  const expiresInSec = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
  return { ok: true, accessToken, expiresInSec };
}

function shortMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return 'unknown';
}
