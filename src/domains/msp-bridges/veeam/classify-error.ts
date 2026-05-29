/**
 * Map low-level HTTP/network failures to `BridgeResult.kind`.
 *
 * Largely identical to the TANSS classifier — Veeam adds one wrinkle:
 * mismatched `x-api-version` header returns 400 with a body indicating
 * the mismatch. We surface those as `misconfigured` (not `error`) so
 * the operator gets a useful hint.
 *
 * @module @domains/msp-bridges/veeam/classify-error
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

function parseRetryAfter(header: string | null): number {
  if (!header) return 60;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const diffSec = Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
    return diffSec > 0 ? diffSec : 60;
  }
  return 60;
}

/**
 * Heuristic: detect "api-version not supported" responses so we can
 * surface them as `misconfigured` (operator fix: bump CLAUDE_OS_VEEAM_API_VERSION).
 */
export function isApiVersionMismatch(bodyText: string | undefined): boolean {
  if (!bodyText) return false;
  const lc = bodyText.toLowerCase();
  return lc.includes('api-version') && (lc.includes('not supported') || lc.includes('unsupported'));
}

export function classifyHttpStatus(
  status: number,
  retryAfterHeader: string | null,
  bodyText?: string,
): BridgeResult<never> {
  if (status === 401 || status === 403) {
    return { kind: 'auth-failed', message: `HTTP ${status}` };
  }
  if (status === 429) {
    return {
      kind: 'rate-limited',
      retryAfterSec: parseRetryAfter(retryAfterHeader),
      message: `HTTP 429${retryAfterHeader ? ` (retry-after: ${retryAfterHeader})` : ''}`,
    };
  }
  if (status === 404) {
    return { kind: 'misconfigured', message: 'HTTP 404 — endpoint or resource unknown' };
  }
  if (status === 400 && isApiVersionMismatch(bodyText)) {
    return {
      kind: 'misconfigured',
      message:
        'HTTP 400 — x-api-version mismatch; bump CLAUDE_OS_VEEAM_API_VERSION to match the VBR version',
    };
  }
  if (status >= 500 && status < 600) {
    return { kind: 'unreachable', message: `HTTP ${status}` };
  }
  return { kind: 'error', message: `HTTP ${status}` };
}

export function classifyThrown(err: unknown): BridgeResult<never> {
  if (errorName(err) === 'AbortError') {
    return { kind: 'unreachable', message: 'request timed out' };
  }
  const code = errorCode(err);
  if (code !== null && TLS_HINT_CODES.has(code)) {
    return {
      kind: 'unreachable',
      message: `${code} — self-signed cert; set CLAUDE_OS_VEEAM_INSECURE_TLS=1 if intentional`,
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
