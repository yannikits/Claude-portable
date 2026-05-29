import { describe, expect, it } from 'vitest';
import {
  buildGetRequest,
  escapeXml,
} from '../../../../src/domains/msp-bridges/sophos/xml-builder.js';

describe('escapeXml', () => {
  it('escapes <, >, &, ", \'', () => {
    expect(escapeXml(`a<b>c&d"e'f`)).toBe(`a&lt;b&gt;c&amp;d&quot;e&apos;f`);
  });
  it('passes through plain text untouched', () => {
    expect(escapeXml('hello world 123')).toBe('hello world 123');
  });
});

describe('buildGetRequest', () => {
  it('embeds username and password and ONE Get tag', () => {
    const xml = buildGetRequest({ username: 'admin', password: 'pw', getTags: ['Firmware'] });
    expect(xml).toBe(
      '<Request><Login><Username>admin</Username><Password>pw</Password></Login><Get><Firmware></Firmware></Get></Request>',
    );
  });

  it('embeds MULTIPLE Get tags in one request', () => {
    const xml = buildGetRequest({
      username: 'admin',
      password: 'pw',
      getTags: ['Firmware', 'LicenseInformation'],
    });
    expect(xml).toContain('<Get><Firmware></Firmware></Get>');
    expect(xml).toContain('<Get><LicenseInformation></LicenseInformation></Get>');
  });

  it('escapes XML metachars in username', () => {
    const xml = buildGetRequest({
      username: 'admin<user>',
      password: 'pw',
      getTags: ['Firmware'],
    });
    expect(xml).toContain('<Username>admin&lt;user&gt;</Username>');
  });

  it('escapes XML metachars in password — most security-critical', () => {
    const xml = buildGetRequest({
      username: 'admin',
      password: `p&w"<x>`,
      getTags: ['Firmware'],
    });
    expect(xml).toContain('<Password>p&amp;w&quot;&lt;x&gt;</Password>');
  });
});
