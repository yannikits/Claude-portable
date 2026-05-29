/**
 * Customer-Schema validation tests.
 */
import { describe, expect, it } from 'vitest';
import {
  CustomerSchemaError,
  defaultRecord,
  validateCustomerRecord,
} from '../../../src/domains/msp-customers/index.js';

const MIN = { slug: 'mueller-gmbh', displayName: 'Steuerkanzlei Müller GmbH' };

describe('validateCustomerRecord — required fields', () => {
  it('throws on non-object input', () => {
    expect(() => validateCustomerRecord(null)).toThrow(CustomerSchemaError);
    expect(() => validateCustomerRecord('a string')).toThrow(CustomerSchemaError);
  });

  it('throws when slug is missing', () => {
    expect(() => validateCustomerRecord({ displayName: 'X' })).toThrow(/slug is required/);
  });

  it('throws when displayName is missing', () => {
    expect(() => validateCustomerRecord({ slug: 'x' })).toThrow(/displayName is required/);
  });

  it('throws when slug contains uppercase or spaces', () => {
    expect(() => validateCustomerRecord({ slug: 'Has Space', displayName: 'X' })).toThrow(
      /slug.*must match/,
    );
    expect(() => validateCustomerRecord({ slug: 'UPPER', displayName: 'X' })).toThrow(
      /slug.*must match/,
    );
  });

  it('throws when slug starts with hyphen', () => {
    expect(() => validateCustomerRecord({ slug: '-foo', displayName: 'X' })).toThrow(
      /slug.*must match/,
    );
  });

  it('accepts minimal record', () => {
    const r = validateCustomerRecord(MIN);
    expect(r).toEqual(MIN);
  });

  it('throws when expectedSlug mismatches', () => {
    expect(() => validateCustomerRecord(MIN, { expectedSlug: 'different' })).toThrow(
      /does not match folder/,
    );
  });
});

describe('validateCustomerRecord — contact', () => {
  it('accepts partial contact', () => {
    const r = validateCustomerRecord({ ...MIN, contact: { primaryEmail: 'a@b.de' } });
    expect(r.contact).toEqual({ primaryEmail: 'a@b.de' });
  });

  it('rejects non-string contact field', () => {
    expect(() => validateCustomerRecord({ ...MIN, contact: { primaryEmail: 42 } })).toThrow(
      /contact.primaryEmail/,
    );
  });
});

describe('validateCustomerRecord — bridges', () => {
  it('accepts empty bridges', () => {
    expect(validateCustomerRecord({ ...MIN, bridges: {} }).bridges).toEqual({});
  });

  it('rejects unknown bridge kind to catch typos', () => {
    expect(() =>
      validateCustomerRecord({ ...MIN, bridges: { tansss: { customerId: 1 } } }),
    ).toThrow(/unknown bridge kind/);
  });

  it('validates tanss.customerId is positive integer', () => {
    expect(() =>
      validateCustomerRecord({ ...MIN, bridges: { tanss: { customerId: -1 } } }),
    ).toThrow(/positive integer/);
    expect(() =>
      validateCustomerRecord({ ...MIN, bridges: { tanss: { customerId: 'abc' } } }),
    ).toThrow(/positive integer/);
    const ok = validateCustomerRecord({ ...MIN, bridges: { tanss: { customerId: 12345 } } });
    expect(ok.bridges?.tanss?.customerId).toBe(12345);
  });

  it('validates veeam.jobNames as string array, drops non-strings', () => {
    const r = validateCustomerRecord({
      ...MIN,
      bridges: { veeam: { jobNames: ['a', 'b', 42, 'c'] } },
    });
    expect(r.bridges?.veeam?.jobNames).toEqual(['a', 'b', 'c']);
  });

  it('rejects veeam.jobNames not being an array', () => {
    expect(() =>
      validateCustomerRecord({ ...MIN, bridges: { veeam: { jobNames: 'single' } } }),
    ).toThrow(/jobNames must be an array/);
  });

  it('validates m365.tenantId non-empty', () => {
    expect(() => validateCustomerRecord({ ...MIN, bridges: { m365: { tenantId: '' } } })).toThrow(
      /m365.tenantId/,
    );
  });

  it('validates securepoint.deviceId non-empty', () => {
    expect(() =>
      validateCustomerRecord({ ...MIN, bridges: { securepoint: { deviceId: '' } } }),
    ).toThrow(/securepoint.deviceId/);
  });

  it('accepts sophos with only one of central/firewall populated', () => {
    const r = validateCustomerRecord({
      ...MIN,
      bridges: { sophos: { firewallHostname: 'fw.local' } },
    });
    expect(r.bridges?.sophos?.firewallHostname).toBe('fw.local');
    expect(r.bridges?.sophos?.centralCustomerId).toBeUndefined();
  });
});

describe('validateCustomerRecord — forward-compat extras', () => {
  it('preserves unknown top-level keys in extras', () => {
    const raw = { ...MIN, futureFeature: { weight: 'low' }, another: 'hello' };
    const r = validateCustomerRecord(raw);
    expect(r.extras).toEqual({ futureFeature: { weight: 'low' }, another: 'hello' });
  });

  it('omits extras when no unknown keys', () => {
    const r = validateCustomerRecord(MIN);
    expect(r.extras).toBeUndefined();
  });
});

describe('defaultRecord', () => {
  it('returns slug + displayName=slug', () => {
    expect(defaultRecord('mueller-gmbh')).toEqual({
      slug: 'mueller-gmbh',
      displayName: 'mueller-gmbh',
    });
  });
});
