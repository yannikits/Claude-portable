/**
 * Pure mapper — `TanssTicketRaw[]` → `TanssStatus`.
 *
 * Closed-detection is intentionally generous: TANSS reports closed-ness
 * via a few fields depending on installation, so we treat any of the
 * following as "closed":
 *   - `closed === true`
 *   - `status` or `statusName` matches /closed|done|erledigt|geschlossen/i
 * Everything else counts as open. This is robust to TANSS-side string
 * variations and consistent with the PSTANSS heuristic.
 *
 * @module @domains/msp-bridges/tanss/mapper
 */
import type { TanssStatus, TanssTicketRaw } from './types.js';

const CLOSED_RE = /closed|done|erledigt|geschlossen|completed|finished/i;

export function isClosed(t: TanssTicketRaw): boolean {
  if (t.closed === true) return true;
  if (typeof t.status === 'string' && CLOSED_RE.test(t.status)) return true;
  if (typeof t.statusName === 'string' && CLOSED_RE.test(t.statusName)) return true;
  return false;
}

/** Returns ms-epoch or null. Accepts both numeric epoch and ISO-strings. */
function tsOf(t: TanssTicketRaw): number | null {
  const raw = t.updateDate ?? t.date;
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // TANSS uses seconds OR millis depending on field; heuristic: < 1e12 → seconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function mapTanssTickets(rawTickets: readonly TanssTicketRaw[]): TanssStatus {
  let openCount = 0;
  let newestTs: number | null = null;
  let newestTicket: TanssTicketRaw | null = null;

  for (const t of rawTickets) {
    if (!isClosed(t)) openCount += 1;
    const ts = tsOf(t);
    if (ts !== null && (newestTs === null || ts > newestTs)) {
      newestTs = ts;
      newestTicket = t;
    }
  }

  const sample =
    newestTicket && typeof newestTicket.id === 'number'
      ? {
          id: newestTicket.id,
          subject: typeof newestTicket.subject === 'string' ? newestTicket.subject : '',
          status:
            (typeof newestTicket.statusName === 'string' && newestTicket.statusName) ||
            (typeof newestTicket.status === 'string' && newestTicket.status) ||
            'unknown',
        }
      : null;

  return {
    openCount,
    totalCount: rawTickets.length,
    newestUpdateAt: newestTs === null ? null : new Date(newestTs).toISOString(),
    sample,
  };
}
