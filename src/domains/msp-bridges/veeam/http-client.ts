/**
 * Veeam HTTP-client: Bearer auth + x-api-version + 401-once retry.
 *
 * Design: one client instance per (server-host, port). The OAuth token
 * is cached inside `VeeamTokenCache` (owned by the bridge), not in the
 * http-client — that lets multiple probes for the same VBR share a
 * single login without coupling the cache lifecycle to the request.
 *
 * The client does ONE automatic retry on a 401 (token may have expired
 * server-side just before our local margin). The caller passes a
 * `relogin()` callback the client calls on the retry.
 *
 * @module @domains/msp-bridges/veeam/http-client
 */
import type { BridgeResult } from '../types.js';
import { classifyHttpStatus, classifyThrown } from './classify-error.js';

export interface VeeamGetOpts {
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly token: string;
  /** Called when the first attempt yields 401. Should return a new token or null. */
  readonly relogin: () => Promise<string | null>;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export type GetJsonResult<T> = { ok: true; data: T } | { ok: false; error: BridgeResult<never> };

export async function veeamGet<T>(path: string, opts: VeeamGetOpts): Promise<GetJsonResult<T>> {
  if (!path.startsWith('/')) {
    return { ok: false, error: { kind: 'error', message: 'internal: path must start with /' } };
  }
  const url = `${opts.baseUrl}${path}`;

  const doRequest = async (token: string): Promise<Response | { thrown: unknown }> => {
    try {
      return await opts.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-version': opts.apiVersion,
          Accept: 'application/json',
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      return { thrown: err };
    }
  };

  const first = await doRequest(opts.token);
  if ('thrown' in first) return { ok: false, error: classifyThrown(first.thrown) };
  if (first.ok) return parseJson<T>(first);

  if (first.status === 401) {
    const fresh = await opts.relogin();
    if (fresh === null) {
      return { ok: false, error: { kind: 'auth-failed', message: 'relogin yielded no token' } };
    }
    const second = await doRequest(fresh);
    if ('thrown' in second) return { ok: false, error: classifyThrown(second.thrown) };
    if (second.ok) return parseJson<T>(second);
    let bodyText: string | undefined;
    try {
      bodyText = await second.text();
    } catch {
      bodyText = undefined;
    }
    return {
      ok: false,
      error: classifyHttpStatus(second.status, second.headers.get('retry-after'), bodyText),
    };
  }

  let bodyText: string | undefined;
  try {
    bodyText = await first.text();
  } catch {
    bodyText = undefined;
  }
  return {
    ok: false,
    error: classifyHttpStatus(first.status, first.headers.get('retry-after'), bodyText),
  };
}

async function parseJson<T>(response: Response): Promise<GetJsonResult<T>> {
  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'error',
        message: `invalid JSON: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
      },
    };
  }
}
