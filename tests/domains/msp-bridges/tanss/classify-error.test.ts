import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  classifyThrown,
} from '../../../../src/domains/msp-bridges/tanss/classify-error.js';

describe('classifyHttpStatus', () => {
  it('401 → auth-failed', () => {
    expect(classifyHttpStatus(401, null).kind).toBe('auth-failed');
  });
  it('403 → auth-failed', () => {
    expect(classifyHttpStatus(403, null).kind).toBe('auth-failed');
  });

  it('429 without Retry-After → rate-limited, retryAfterSec=60 default', () => {
    const r = classifyHttpStatus(429, null);
    expect(r.kind).toBe('rate-limited');
    if (r.kind === 'rate-limited') {
      expect(r.retryAfterSec).toBe(60);
    }
  });

  it('429 with Retry-After seconds → uses that value', () => {
    const r = classifyHttpStatus(429, '30');
    if (r.kind === 'rate-limited') {
      expect(r.retryAfterSec).toBe(30);
    }
  });

  it('429 with Retry-After HTTP-date → diff in seconds', () => {
    const future = new Date(Date.now() + 90_000).toUTCString();
    const r = classifyHttpStatus(429, future);
    if (r.kind === 'rate-limited') {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(85);
      expect(r.retryAfterSec).toBeLessThanOrEqual(95);
    }
  });

  it('404 → misconfigured (likely wrong customerId)', () => {
    expect(classifyHttpStatus(404, null).kind).toBe('misconfigured');
  });

  it('500/503 → unreachable', () => {
    expect(classifyHttpStatus(500, null).kind).toBe('unreachable');
    expect(classifyHttpStatus(503, null).kind).toBe('unreachable');
  });

  it('400 → error (catch-all)', () => {
    expect(classifyHttpStatus(400, null).kind).toBe('error');
  });
});

describe('classifyThrown', () => {
  it('AbortError → unreachable (timeout)', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('ECONNREFUSED → unreachable', () => {
    const err = Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' });
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('ENOTFOUND → unreachable', () => {
    const err = Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('code inside .cause (wrapped fetch error) → unreachable', () => {
    const err = Object.assign(new Error('fetch failed'), {
      name: 'TypeError',
      cause: { code: 'ECONNREFUSED' },
    });
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('TypeError "fetch failed" without code → unreachable', () => {
    const err = Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('arbitrary Error → error', () => {
    expect(classifyThrown(new Error('something else')).kind).toBe('error');
  });

  it('non-error thrown value → error', () => {
    expect(classifyThrown('plain string').kind).toBe('error');
  });
});
