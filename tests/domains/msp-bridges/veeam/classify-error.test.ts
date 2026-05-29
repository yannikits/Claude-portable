import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  classifyThrown,
  isApiVersionMismatch,
} from '../../../../src/domains/msp-bridges/veeam/classify-error.js';

describe('classifyHttpStatus', () => {
  it('401/403 → auth-failed', () => {
    expect(classifyHttpStatus(401, null).kind).toBe('auth-failed');
    expect(classifyHttpStatus(403, null).kind).toBe('auth-failed');
  });

  it('429 with Retry-After integer → rate-limited(retryAfterSec)', () => {
    const r = classifyHttpStatus(429, '90');
    if (r.kind === 'rate-limited') expect(r.retryAfterSec).toBe(90);
  });

  it('404 → misconfigured', () => {
    expect(classifyHttpStatus(404, null).kind).toBe('misconfigured');
  });

  it('500/503 → unreachable', () => {
    expect(classifyHttpStatus(500, null).kind).toBe('unreachable');
    expect(classifyHttpStatus(503, null).kind).toBe('unreachable');
  });

  it('400 plain → error', () => {
    expect(classifyHttpStatus(400, null).kind).toBe('error');
  });

  it('400 with api-version body → misconfigured with helpful hint', () => {
    const r = classifyHttpStatus(400, null, 'The requested api-version 1.0-rev1 is not supported.');
    expect(r.kind).toBe('misconfigured');
    if (r.kind === 'misconfigured') {
      expect(r.message).toContain('CLAUDE_OS_VEEAM_API_VERSION');
    }
  });
});

describe('isApiVersionMismatch', () => {
  it('detects "not supported" wording', () => {
    expect(isApiVersionMismatch('the api-version 1.0-rev1 is not supported')).toBe(true);
  });
  it('detects "unsupported" wording', () => {
    expect(isApiVersionMismatch('unsupported api-version requested')).toBe(true);
  });
  it('returns false for unrelated 400 bodies', () => {
    expect(isApiVersionMismatch('Job not found')).toBe(false);
    expect(isApiVersionMismatch(undefined)).toBe(false);
  });
});

describe('classifyThrown', () => {
  it('AbortError → unreachable', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('ECONNREFUSED → unreachable', () => {
    expect(classifyThrown(Object.assign(new Error(''), { code: 'ECONNREFUSED' })).kind).toBe(
      'unreachable',
    );
  });

  it('UNABLE_TO_VERIFY_LEAF_SIGNATURE → unreachable with TLS hint', () => {
    const r = classifyThrown(
      Object.assign(new Error(''), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
    );
    expect(r.kind).toBe('unreachable');
    if (r.kind === 'unreachable') expect(r.message).toContain('INSECURE_TLS');
  });

  it('TypeError("fetch failed") with .cause.code=ECONNREFUSED → unreachable', () => {
    const err = Object.assign(new Error('fetch failed'), {
      name: 'TypeError',
      cause: { code: 'ECONNREFUSED' },
    });
    expect(classifyThrown(err).kind).toBe('unreachable');
  });

  it('Arbitrary Error → error', () => {
    expect(classifyThrown(new Error('weird')).kind).toBe('error');
  });
});
