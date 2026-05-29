/**
 * Parse a Sophos XG XML response into a flat `SophosResponseRaw`.
 *
 * Uses `fast-xml-parser` (well-maintained, TypeScript-friendly, ~10M
 * weekly downloads — only XML dep across the project; gates here so
 * the rest of the codebase stays XML-agnostic).
 *
 * @module @domains/msp-bridges/sophos/xml-parser
 */
import { XMLParser } from 'fast-xml-parser';
import type { SophosResponseRaw, SophosSubscriptionRaw } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Subscriptions can be Array OR single Subscription; we normalise.
  isArray: (name, _path) => name === 'Subscription',
});

export interface ParseResult {
  readonly response: SophosResponseRaw | null;
  /** Sophos `<Status code="...">` on the response body (532, 534, …). */
  readonly responseStatusCode: string | null;
  readonly responseStatusText: string | null;
}

/**
 * Returns the top-level `<Response>` payload + an extracted status code
 * if Sophos returned one in a top-level `<Status>` element.
 *
 * Never throws — invalid XML / missing `<Response>` returns `{response: null, ...}`.
 */
export function parseSophosResponse(xml: string): ParseResult {
  let doc: unknown;
  try {
    doc = parser.parse(xml) as unknown;
  } catch {
    return { response: null, responseStatusCode: null, responseStatusText: null };
  }
  if (doc === null || typeof doc !== 'object') {
    return { response: null, responseStatusCode: null, responseStatusText: null };
  }
  const root = (doc as { Response?: unknown }).Response;
  if (root === undefined || root === null || typeof root !== 'object') {
    return { response: null, responseStatusCode: null, responseStatusText: null };
  }
  const r = root as SophosResponseRaw;

  // Top-level Status — Sophos returns `<Status code="534">message</Status>` for
  // API-Access-List blocks, code="532" when API not enabled. Sometimes Status is
  // a string ("Authentication Successful") instead of an object.
  let responseStatusCode: string | null = null;
  let responseStatusText: string | null = null;
  if (r.Status !== undefined) {
    if (typeof r.Status === 'string') {
      responseStatusText = r.Status;
    } else if (typeof r.Status === 'object' && r.Status !== null) {
      const code = (r.Status as { '@_code'?: string })['@_code'];
      const text = (r.Status as { '#text'?: string })['#text'];
      responseStatusCode = typeof code === 'string' ? code : null;
      responseStatusText = typeof text === 'string' ? text : null;
    }
  }

  return { response: r, responseStatusCode, responseStatusText };
}

/** Extract the subscriptions array even when Sophos returned a single element. */
export function extractSubscriptions(
  raw: SophosResponseRaw | null,
): readonly SophosSubscriptionRaw[] {
  if (raw === null) return [];
  const subs = raw.LicenseInformation?.Subscriptions?.Subscription;
  if (subs === undefined) return [];
  if (Array.isArray(subs)) return subs as readonly SophosSubscriptionRaw[];
  return [subs as SophosSubscriptionRaw];
}
