import { describe, expect, it } from 'vitest';
import { isClosed, mapTanssTickets } from '../../../../src/domains/msp-bridges/tanss/mapper.js';
import type { TanssTicketRaw } from '../../../../src/domains/msp-bridges/tanss/types.js';

describe('isClosed', () => {
  it('treats closed=true as closed', () => {
    expect(isClosed({ closed: true })).toBe(true);
  });
  it('treats status="closed"/"done"/"erledigt"/"geschlossen" as closed', () => {
    expect(isClosed({ status: 'closed' })).toBe(true);
    expect(isClosed({ status: 'Done' })).toBe(true);
    expect(isClosed({ status: 'erledigt' })).toBe(true);
    expect(isClosed({ status: 'GESCHLOSSEN' })).toBe(true);
  });
  it('uses statusName as a fallback', () => {
    expect(isClosed({ statusName: 'completed' })).toBe(true);
  });
  it('treats "in progress" / "open" / arbitrary text as NOT closed', () => {
    expect(isClosed({ status: 'in progress' })).toBe(false);
    expect(isClosed({ status: 'open' })).toBe(false);
    expect(isClosed({})).toBe(false);
  });
});

describe('mapTanssTickets', () => {
  it('returns zero counts and null fields for an empty list', () => {
    expect(mapTanssTickets([])).toEqual({
      openCount: 0,
      totalCount: 0,
      newestUpdateAt: null,
      sample: null,
    });
  });

  it('counts only non-closed as open', () => {
    const t: TanssTicketRaw[] = [
      { id: 1, subject: 'a', status: 'open' },
      { id: 2, subject: 'b', status: 'closed' },
      { id: 3, subject: 'c', status: 'in progress' },
    ];
    const out = mapTanssTickets(t);
    expect(out.openCount).toBe(2);
    expect(out.totalCount).toBe(3);
  });

  it('picks the newest updateDate as sample (ISO-strings)', () => {
    const t: TanssTicketRaw[] = [
      { id: 1, subject: 'old', status: 'open', updateDate: '2026-05-01T00:00:00Z' },
      { id: 2, subject: 'new', status: 'open', updateDate: '2026-05-28T00:00:00Z' },
      { id: 3, subject: 'mid', status: 'open', updateDate: '2026-05-15T00:00:00Z' },
    ];
    const out = mapTanssTickets(t);
    expect(out.sample?.id).toBe(2);
    expect(out.sample?.subject).toBe('new');
    expect(out.newestUpdateAt).toBe('2026-05-28T00:00:00.000Z');
  });

  it('handles numeric epoch in SECONDS (TANSS convention < 1e12)', () => {
    const t: TanssTicketRaw[] = [
      { id: 7, subject: 'epoch-s', status: 'open', updateDate: 1748000000 },
    ];
    const out = mapTanssTickets(t);
    expect(out.newestUpdateAt).toBe(new Date(1748000000 * 1000).toISOString());
  });

  it('handles numeric epoch in MILLIS (>= 1e12)', () => {
    const ms = 1748000000000;
    const t: TanssTicketRaw[] = [{ id: 8, subject: 'epoch-ms', status: 'open', updateDate: ms }];
    expect(mapTanssTickets(t).newestUpdateAt).toBe(new Date(ms).toISOString());
  });

  it('prefers statusName over status for the sample.status', () => {
    const t: TanssTicketRaw[] = [
      { id: 1, subject: 'x', status: 'OFFEN', statusName: 'Offen (eskaliert)', updateDate: 1 },
    ];
    expect(mapTanssTickets(t).sample?.status).toBe('Offen (eskaliert)');
  });

  it('falls back to status when statusName is absent', () => {
    const t: TanssTicketRaw[] = [{ id: 1, subject: 'x', status: 'OFFEN', updateDate: 1 }];
    expect(mapTanssTickets(t).sample?.status).toBe('OFFEN');
  });

  it('returns sample=null when no ticket has a valid id', () => {
    const t: TanssTicketRaw[] = [{ subject: 'no-id', status: 'open', updateDate: 1 }];
    const out = mapTanssTickets(t);
    expect(out.sample).toBeNull();
    expect(out.totalCount).toBe(1);
  });

  it('returns empty-string subject when ticket has none', () => {
    const t: TanssTicketRaw[] = [{ id: 1, status: 'open', updateDate: 1 }];
    expect(mapTanssTickets(t).sample?.subject).toBe('');
  });

  it('ignores tickets with unparsable timestamps for newestUpdateAt', () => {
    const t: TanssTicketRaw[] = [
      { id: 1, subject: 'bad', status: 'open', updateDate: 'not-a-date' },
      { id: 2, subject: 'good', status: 'open', updateDate: '2026-05-01T00:00:00Z' },
    ];
    expect(mapTanssTickets(t).sample?.id).toBe(2);
  });
});
