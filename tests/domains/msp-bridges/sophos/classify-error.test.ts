import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  classifySophosStatusCode,
  classifyThrown,
  isLoginFailure,
} from '../../../../src/domains/msp-bridges/sophos/classify-error.js';

describe('classifyHttpStatus', () => {
  it('401/403 → auth-failed', () => {
    expect(classifyHttpStatus(401).kind).toBe('auth-failed');
    expect(classifyHttpStatus(403).kind).toBe('auth-failed');
  });
  it('429 → rate-limited (Sophos has no Retry-After in this path)', () => {
    expect(classifyHttpStatus(429).kind).toBe('rate-limited');
  });
  it('404 → misconfigured', () => {
    expect(classifyHttpStatus(404).kind).toBe('misconfigured');
  });
  it('5xx → unreachable', () => {
    expect(classifyHttpStatus(500).kind).toBe('unreachable');
    expect(classifyHttpStatus(503).kind).toBe('unreachable');
  });
  it('400 → error', () => {
    expect(classifyHttpStatus(400).kind).toBe('error');
  });
});

describe('classifyThrown', () => {
  it('AbortError → unreachable', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(classifyThrown(e).kind).toBe('unreachable');
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
    if (r.kind === 'unreachable') expect(r.message).toContain('CLAUDE_OS_SOPHOS_INSECURE_TLS');
  });
  it('TypeError("fetch failed") with .cause.code → unreachable', () => {
    const e = Object.assign(new Error('fetch failed'), {
      name: 'TypeError',
      cause: { code: 'ECONNREFUSED' },
    });
    expect(classifyThrown(e).kind).toBe('unreachable');
  });
  it('Arbitrary Error → error', () => {
    expect(classifyThrown(new Error('weird')).kind).toBe('error');
  });
});

describe('classifySophosStatusCode', () => {
  it('null → null (no actionable error)', () => {
    expect(classifySophosStatusCode(null, null)).toBeNull();
  });

  it('"2xx" → null (success)', () => {
    expect(classifySophosStatusCode('216', 'ok')).toBeNull();
  });

  it('"534" → auth-failed (IP not in ACL)', () => {
    const r = classifySophosStatusCode('534', 'IP not allowed in API Access list');
    expect(r?.kind).toBe('auth-failed');
    expect(r?.message).toContain('IP not allowed');
  });

  it('"532" → misconfigured (API not enabled)', () => {
    const r = classifySophosStatusCode('532', 'API not enabled');
    expect(r?.kind).toBe('misconfigured');
    expect(r?.message).toContain('API not enabled');
  });

  it('"500" (non-2xx, unknown) → error', () => {
    const r = classifySophosStatusCode('500', 'bad password');
    expect(r?.kind).toBe('error');
  });
});

describe('isLoginFailure', () => {
  it('detects Authentication Failure', () => {
    expect(isLoginFailure('Authentication Failure')).toBe(true);
  });
  it('detects "Invalid credentials"', () => {
    expect(isLoginFailure('Invalid credentials')).toBe(true);
  });
  it('treats "Authentication Successful" as non-failure', () => {
    expect(isLoginFailure('Authentication Successful')).toBe(false);
  });
  it('non-string → false', () => {
    expect(isLoginFailure(undefined)).toBe(false);
  });
});
