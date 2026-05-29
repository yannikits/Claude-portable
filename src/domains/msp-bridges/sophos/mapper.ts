/**
 * Pure mapper — parsed `SophosResponseRaw` → `SophosStatus`.
 *
 * License-summary heuristic (lowest-information first, accumulates):
 *   - no subscriptions parsed                  → 'unknown'
 *   - all subscriptions expired/deactivated    → 'expired'
 *   - some expired/deactivated, some active    → 'mixed'
 *   - all active, min daysRemaining ≤ 30       → 'expiring-soon'
 *   - all active, min daysRemaining > 30       → 'active'
 *
 * "Active" means status looks like Subscribed/Trial/Evaluation — Sophos
 * uses several strings and we're forgiving.
 *
 * @module @domains/msp-bridges/sophos/mapper
 */
import type { LicenseSummary, SophosStatus, SubscriptionInfo } from './types.js';
import { extractSubscriptions, type ParseResult } from './xml-parser.js';

const ACTIVE_STATUSES = new Set(['subscribed', 'trial', 'evaluation', 'active']);
const EXPIRED_STATUSES = new Set(['expired', 'deactivated', 'unsubscribed']);
const EXPIRING_THRESHOLD_DAYS = 30;

function parseSophosDate(s: string | undefined): { iso: string; ms: number } | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  // Sophos returns "2027-01-31" (YYYY-MM-DD) or sometimes "Jan 31 2027".
  // Try ISO first; fall back to Date.parse (tolerant).
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  // Normalize to UTC-midnight so day-diffs are stable regardless of TZ.
  const d = new Date(ms);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { iso: new Date(utcMidnight).toISOString(), ms: utcMidnight };
}

function daysFromNow(targetMs: number, nowMs: number): number {
  return Math.floor((targetMs - nowMs) / (24 * 60 * 60 * 1000));
}

export interface MapOpts {
  /** Inject "now" for deterministic tests. Default Date.now(). */
  readonly now?: () => number;
}

export function mapSophosResponse(parsed: ParseResult, opts: MapOpts = {}): SophosStatus {
  const now = (opts.now ?? Date.now)();
  const raw = parsed.response;

  const firmwareVersion = raw?.Firmware?.Version ?? '';
  const firmwareType = typeof raw?.Firmware?.Type === 'string' ? raw.Firmware.Type : null;

  const subsRaw = extractSubscriptions(raw);
  const subscriptions: SubscriptionInfo[] = [];
  for (const s of subsRaw) {
    const name = typeof s.Name === 'string' ? s.Name : '<unknown>';
    const status = typeof s.Status === 'string' ? s.Status : 'unknown';
    const expiry = parseSophosDate(s.ExpiryDate);
    subscriptions.push({
      name,
      status,
      expiresAt: expiry?.iso ?? null,
      daysRemaining: expiry === null ? null : daysFromNow(expiry.ms, now),
    });
  }

  return {
    firmwareVersion,
    firmwareType,
    licenseSummary: summarizeLicense(subscriptions),
    daysToEarliestExpiry: earliestExpiryDays(subscriptions),
    subscriptions,
  };
}

export function summarizeLicense(subs: readonly SubscriptionInfo[]): LicenseSummary {
  if (subs.length === 0) return 'unknown';
  let activeCount = 0;
  let expiredCount = 0;
  let minDays: number | null = null;
  for (const s of subs) {
    const status = s.status.toLowerCase();
    if (EXPIRED_STATUSES.has(status)) {
      expiredCount += 1;
      continue;
    }
    if (ACTIVE_STATUSES.has(status)) {
      activeCount += 1;
      if (s.daysRemaining !== null) {
        // If the days remaining went negative, treat as expired (Sophos sometimes
        // keeps status=Subscribed past expiry until the next sync).
        if (s.daysRemaining < 0) {
          expiredCount += 1;
          activeCount -= 1;
          continue;
        }
        if (minDays === null || s.daysRemaining < minDays) minDays = s.daysRemaining;
      }
      continue;
    }
    // Unknown status — treat as expired-side for conservative reporting.
    expiredCount += 1;
  }
  if (expiredCount > 0 && activeCount === 0) return 'expired';
  if (expiredCount > 0 && activeCount > 0) return 'mixed';
  if (minDays !== null && minDays <= EXPIRING_THRESHOLD_DAYS) return 'expiring-soon';
  return 'active';
}

function earliestExpiryDays(subs: readonly SubscriptionInfo[]): number | null {
  let min: number | null = null;
  for (const s of subs) {
    if (s.daysRemaining === null) continue;
    if (s.daysRemaining < 0) continue; // skip already-expired
    if (min === null || s.daysRemaining < min) min = s.daysRemaining;
  }
  return min;
}
