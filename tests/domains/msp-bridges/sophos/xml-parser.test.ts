import { describe, expect, it } from 'vitest';
import {
  extractSubscriptions,
  parseSophosResponse,
} from '../../../../src/domains/msp-bridges/sophos/xml-parser.js';

const HAPPY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<Response APIVersion="2000.1">
  <Login>
    <status>Authentication Successful</status>
  </Login>
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

const SINGLE_SUB_RESPONSE = `<Response>
  <Firmware><Version>SFOS 19.5</Version></Firmware>
  <LicenseInformation>
    <Subscriptions>
      <Subscription>
        <Name>Network Protection</Name>
        <Status>Trial</Status>
        <ExpiryDate>2026-06-15</ExpiryDate>
      </Subscription>
    </Subscriptions>
  </LicenseInformation>
</Response>`;

const STATUS_534_RESPONSE = `<Response>
  <Status code="534">IP not allowed in API Access list</Status>
</Response>`;

const LOGIN_FAILURE_RESPONSE = `<Response>
  <Login><status>Authentication Failure</status></Login>
</Response>`;

describe('parseSophosResponse', () => {
  it('parses a full happy-path response with firmware + license', () => {
    const r = parseSophosResponse(HAPPY_RESPONSE);
    expect(r.response).not.toBeNull();
    expect(r.response?.Firmware?.Version).toBe('SFOS 20.0.1 MR-1');
    expect(r.response?.Firmware?.Type).toBe('Default');
    expect(r.responseStatusCode).toBeNull();
  });

  it('parses login.status when present', () => {
    const r = parseSophosResponse(HAPPY_RESPONSE);
    expect(r.response?.Login?.status).toBe('Authentication Successful');
  });

  it('extracts top-level Status code 534', () => {
    const r = parseSophosResponse(STATUS_534_RESPONSE);
    expect(r.responseStatusCode).toBe('534');
    expect(r.responseStatusText).toContain('IP not allowed');
  });

  it('returns response=null for invalid XML without throwing', () => {
    const r = parseSophosResponse('<<<not xml>>>');
    expect(r.response).toBeNull();
  });

  it('returns response=null when there is no top-level <Response>', () => {
    const r = parseSophosResponse('<SomethingElse><foo>bar</foo></SomethingElse>');
    expect(r.response).toBeNull();
  });

  it('extracts login.status="Authentication Failure"', () => {
    const r = parseSophosResponse(LOGIN_FAILURE_RESPONSE);
    expect(r.response?.Login?.status).toBe('Authentication Failure');
  });
});

describe('extractSubscriptions', () => {
  it('returns [] for null response', () => {
    expect(extractSubscriptions(null)).toEqual([]);
  });

  it('returns the array when multiple subscriptions present', () => {
    const r = parseSophosResponse(HAPPY_RESPONSE);
    const subs = extractSubscriptions(r.response);
    expect(subs).toHaveLength(2);
    expect(subs[0]?.Name).toBe('Network Protection');
  });

  it('returns the array even when only ONE subscription (parser is configured isArray)', () => {
    const r = parseSophosResponse(SINGLE_SUB_RESPONSE);
    const subs = extractSubscriptions(r.response);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.Name).toBe('Network Protection');
  });

  it('returns [] when LicenseInformation is absent', () => {
    const r = parseSophosResponse('<Response><Firmware><Version>x</Version></Firmware></Response>');
    expect(extractSubscriptions(r.response)).toEqual([]);
  });
});
