/**
 * Map low-level HTTP/network failures to `BridgeResult.kind`.
 *
 * Decision tree (highest-specificity first):
 *   - 401 / 403                       → 'auth-failed'
 *   - 429 (+ optional Retry-After)    → 'rate-limited'
 *   - 404                             → 'misconfigured' (customer.yaml customerId likely wrong)
 *   - 5xx                             → 'unreachable' (server's fault, not ours)
 *   - AbortError / timeout            → 'unreachable'
 *   - ECONNREFUSED / ENOTFOUND / EAI_AGAIN / fetch-throw → 'unreachable'
 *   - anything else                   → 'error'
 *
 * @module @domains/msp-bridges/tanss/classify-error
 */
import type { BridgeResult } from '../types.js';

const UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
]);

/** Extracts an error code from a Node `Error` or a wrapped fetch error. */
function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.cause && typeof e.cause === 'object' && typeof e.cause.code === 'string') {
    return e.cause.code;
  }
  return null;
}

function errorName(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { name?: unknown };
  return typeof e.name === 'string' ? e.name : null;
}

function shortMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  if (typeof err === 'string') return err.slice(0, 200);
  return 'unknown error';
}

/** Map a non-2xx Response to a BridgeResult error variant. */
export function classifyHttpStatus(
  status: number,
  retryAfterHeader: string | null,
): BridgeResult<never> {
  if (status === 401 || status === 403) {
    return { kind: 'auth-failed', message: `HTTP ${status}` };
  }
  if (status === 429) {
    const retryAfterSec = parseRetryAfter(retryAfterHeader);
    return {
      kind: 'rate-limited',
      retryAfterSec,
      message: `HTTP 429${retryAfterHeader ? ` (retry-after: ${retryAfterHeader})` : ''}`,
    };
  }
  if (status === 404) {
    return { kind: 'misconfigured', message: 'HTTP 404 — customerId unknown to TANSS' };
  }
  if (status >= 500 && status < 600) {
    return { kind: 'unreachable', message: `HTTP ${status}` };
  }
  return { kind: 'error', message: `HTTP ${status}` };
}

/** Map a thrown error (network/timeout/abort) to a BridgeResult error variant. */
export function classifyThrown(err: unknown): BridgeResult<never> {
  if (errorName(err) === 'AbortError') {
    return { kind: 'unreachable', message: 'request timed out' };
  }
  const code = errorCode(err);
  if (code !== null && UNREACHABLE_ERROR_CODES.has(code)) {
    return { kind: 'unreachable', message: code };
  }
  // `fetch()` wraps DNS/connect failures inside TypeError("fetch failed") with .cause.
  if (errorName(err) === 'TypeError') {
    return { kind: 'unreachable', message: shortMessage(err) };
  }
  return { kind: 'error', message: shortMessage(err) };
}

/** Returns the retry-after value in seconds, default 60 if missing/invalid. */
function parseRetryAfter(header: string | null): number {
  if (!header) return 60;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  // RFC-7231 HTTP-date form
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const diffSec = Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
    return diffSec > 0 ? diffSec : 60;
  }
  return 60;
}
