import { describe, expect, it } from 'vitest';
import {
  mapSophosResponse,
  summarizeLicense,
} from '../../../../src/domains/msp-bridges/sophos/mapper.js';
import type { SubscriptionInfo } from '../../../../src/domains/msp-bridges/sophos/types.js';
import { parseSophosResponse } from '../../../../src/domains/msp-bridges/sophos/xml-parser.js';

// "Now" is 2026-05-29 UTC midnight for all license-day tests.
const NOW = Date.UTC(2026, 4, 29);
const now = () => NOW;

const FULL_RESPONSE = `<Response>
  <Firmware>
    <Version>SFOS 20.0.1 MR-1</Version>
    <Type>Default</Type>
  </Firmware>
  <LicenseInformation>
    <Subscriptions>
      <Subscription>
        <Name>Network Protection</Name>
        <Status>Subscribed</Status>
        <ExpiryDate>2027-01-31</ExpiryDate>
      </Subscription>
      <Subscription>
        <Name>Web Protection</Name>
        <Status>Subscribed</Status>
        <ExpiryDate>2027-01-31</ExpiryDate>
      </Subscription>
    </Subscriptions>
  </LicenseInformation>
</Response>`;

describe('mapSophosResponse — happy', () => {
  it('extracts firmware version + type', () => {
    const s = mapSophosResponse(parseSophosResponse(FULL_RESPONSE), { now });
    expect(s.firmwareVersion).toBe('SFOS 20.0.1 MR-1');
    expect(s.firmwareType).toBe('Default');
  });

  it('reports 2 subscriptions, each with correct daysRemaining (UTC)', () => {
    const s = mapSophosResponse(parseSophosResponse(FULL_RESPONSE), { now });
    expect(s.subscriptions).toHaveLength(2);
    const np = s.subscriptions[0];
    expect(np?.name).toBe('Network Protection');
    expect(np?.status).toBe('Subscribed');
    // 2026-05-29 → 2027-01-31 = 247 days
    expect(np?.daysRemaining).toBe(247);
  });

  it('licenseSummary=active and daysToEarliestExpiry=247 for both 2027 expiries', () => {
    const s = mapSophosResponse(parseSophosResponse(FULL_RESPONSE), { now });
    expect(s.licenseSummary).toBe('active');
    expect(s.daysToEarliestExpiry).toBe(247);
  });
});

describe('mapSophosResponse — license summaries', () => {
  function subs(...specs: Array<{ status: string; days: number | null }>): SubscriptionInfo[] {
    return specs.map((sp, i) => ({
      name: `s${i}`,
      status: sp.status,
      expiresAt: sp.days === null ? null : new Date(NOW + sp.days * 86400000).toISOString(),
      daysRemaining: sp.days,
    }));
  }

  it('unknown when 0 subscriptions', () => {
    expect(summarizeLicense([])).toBe('unknown');
  });

  it('active when all Subscribed and min days > 30', () => {
    expect(
      summarizeLicense(
        subs({ status: 'Subscribed', days: 100 }, { status: 'Subscribed', days: 60 }),
      ),
    ).toBe('active');
  });

  it('expiring-soon when min days ≤ 30 and all active', () => {
    expect(
      summarizeLicense(
        subs({ status: 'Subscribed', days: 100 }, { status: 'Subscribed', days: 12 }),
      ),
    ).toBe('expiring-soon');
  });

  it('expired when all Expired', () => {
    expect(
      summarizeLicense(subs({ status: 'Expired', days: -10 }, { status: 'Expired', days: -50 })),
    ).toBe('expired');
  });

  it('mixed when some Expired some Subscribed', () => {
    expect(
      summarizeLicense(subs({ status: 'Expired', days: -10 }, { status: 'Subscribed', days: 60 })),
    ).toBe('mixed');
  });

  it('treats Subscribed with negative daysRemaining as expired (Sophos stale-state)', () => {
    expect(summarizeLicense(subs({ status: 'Subscribed', days: -5 }))).toBe('expired');
  });

  it('treats unknown status (e.g. "Pending") as expired-side (conservative)', () => {
    expect(summarizeLicense(subs({ status: 'Pending', days: 100 }))).toBe('expired');
  });

  it('Trial counts as active', () => {
    expect(summarizeLicense(subs({ status: 'Trial', days: 50 }))).toBe('active');
  });
});

describe('mapSophosResponse — defensive', () => {
  it('null parsed response gives empty firmwareVersion + unknown license', () => {
    const s = mapSophosResponse({
      response: null,
      responseStatusCode: null,
      responseStatusText: null,
    });
    expect(s.firmwareVersion).toBe('');
    expect(s.firmwareType).toBeNull();
    expect(s.licenseSummary).toBe('unknown');
    expect(s.subscriptions).toEqual([]);
  });

  it('missing Type yields firmwareType=null but version still parsed', () => {
    const xml = '<Response><Firmware><Version>SFOS 19.5</Version></Firmware></Response>';
    const s = mapSophosResponse(parseSophosResponse(xml), { now });
    expect(s.firmwareVersion).toBe('SFOS 19.5');
    expect(s.firmwareType).toBeNull();
  });

  it('subscription without ExpiryDate sets daysRemaining=null', () => {
    const xml = `<Response>
      <LicenseInformation><Subscriptions>
        <Subscription><Name>X</Name><Status>Subscribed</Status></Subscription>
      </Subscriptions></LicenseInformation></Response>`;
    const s = mapSophosResponse(parseSophosResponse(xml), { now });
    expect(s.subscriptions[0]?.daysRemaining).toBeNull();
  });

  it('daysToEarliestExpiry skips already-expired subscriptions', () => {
    const xml = `<Response>
      <LicenseInformation><Subscriptions>
        <Subscription><Name>A</Name><Status>Expired</Status><ExpiryDate>2025-01-01</ExpiryDate></Subscription>
        <Subscription><Name>B</Name><Status>Subscribed</Status><ExpiryDate>2027-01-31</ExpiryDate></Subscription>
      </Subscriptions></LicenseInformation></Response>`;
    const s = mapSophosResponse(parseSophosResponse(xml), { now });
    expect(s.daysToEarliestExpiry).toBe(247);
  });
});
