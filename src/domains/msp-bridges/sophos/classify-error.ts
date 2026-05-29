/**
 * Map HTTP/network/Sophos-status-code failures to `BridgeResult.kind`.
 *
 * Sophos sneaks errors inside HTTP-200 responses via a top-level
 * `<Status code="...">` block, so `classifySophosStatusCode` is called
 * on parsed-response state, not on HTTP-status.
 *
 * @module @domains/msp-bridges/sophos/classify-error
 */
import type { BridgeResult } from '../types.js';

const UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

const TLS_HINT_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.cause && typeof e.cause === 'object' && typeof e.cause.code === 'string')
    return e.cause.code;
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

/** Map an HTTP status to a BridgeResult error variant. */
export function classifyHttpStatus(status: number): BridgeResult<never> {
  if (status === 401 || status === 403) {
    return { kind: 'auth-failed', message: `HTTP ${status}` };
  }
  if (status === 429) {
    return { kind: 'rate-limited', retryAfterSec: 60, message: 'HTTP 429' };
  }
  if (status === 404) {
    return { kind: 'misconfigured', message: 'HTTP 404 — endpoint unknown' };
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
  if (code !== null && TLS_HINT_CODES.has(code)) {
    return {
      kind: 'unreachable',
      message: `${code} — self-signed cert; set CLAUDE_OS_SOPHOS_INSECURE_TLS=1 if intentional`,
    };
  }
  if (code !== null && UNREACHABLE_ERROR_CODES.has(code)) {
    return { kind: 'unreachable', message: code };
  }
  if (errorName(err) === 'TypeError') {
    return { kind: 'unreachable', message: shortMessage(err) };
  }
  return { kind: 'error', message: shortMessage(err) };
}

/**
 * Map a Sophos top-level `<Status code="...">` to a BridgeResult.
 * Returns null when no actionable error was reported.
 *
 *   534 — IP not in API Access List
 *   532 — API not enabled
 *   500-series within the XML body — treat as generic auth-failed (Sophos uses these for "creds bad")
 */
export function classifySophosStatusCode(
  code: string | null,
  text: string | null,
): BridgeResult<never> | null {
  if (code === null) return null;
  if (code === '534') {
    return {
      kind: 'auth-failed',
      message: text ?? 'IP not allowed in Sophos API Access List (Status 534)',
    };
  }
  if (code === '532') {
    return {
      kind: 'misconfigured',
      message:
        text ??
        'Sophos XML-API not enabled (Status 532). Enable: System > Backup & firmware > API > Allow API access',
    };
  }
  // Any non-2xx code is treated as authoritative.
  if (!code.startsWith('2')) {
    return { kind: 'error', message: `Sophos status ${code}: ${text ?? 'unknown'}` };
  }
  return null;
}

/**
 * Detect when the Login block reports failure ("Authentication Failure")
 * but no explicit `<Status code>` is emitted.
 */
export function isLoginFailure(loginStatus: string | undefined): boolean {
  if (typeof loginStatus !== 'string') return false;
  return /fail|invalid|denied|unauthor/i.test(loginStatus);
}
