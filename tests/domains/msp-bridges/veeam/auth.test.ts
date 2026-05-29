import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { oauthLogin, VeeamTokenCache } from '../../../../src/domains/msp-bridges/veeam/auth.js';

describe('VeeamTokenCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    const c = new VeeamTokenCache();
    expect(c.get('vbr.example.com')).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('returns the token when fresh', () => {
    const c = new VeeamTokenCache();
    c.set('vbr.example.com', 'tok-1', 3600);
    expect(c.get('vbr.example.com')).toBe('tok-1');
  });

  it('returns null when token is within margin of expiry (60s default)', () => {
    const c = new VeeamTokenCache();
    c.set('vbr.example.com', 'tok-1', 30); // expires in 30s, margin=60s
    expect(c.get('vbr.example.com')).toBeNull();
  });

  it('expires after expires_in - margin', () => {
    const c = new VeeamTokenCache();
    c.set('vbr.example.com', 'tok-1', 3600);
    expect(c.get('vbr.example.com')).toBe('tok-1');
    vi.advanceTimersByTime(3540 * 1000 + 1); // 1ms past margin
    expect(c.get('vbr.example.com')).toBeNull();
  });

  it('invalidate clears just one host', () => {
    const c = new VeeamTokenCache();
    c.set('a.example.com', 'tok-a', 3600);
    c.set('b.example.com', 'tok-b', 3600);
    c.invalidate('a.example.com');
    expect(c.get('a.example.com')).toBeNull();
    expect(c.get('b.example.com')).toBe('tok-b');
  });

  it('per-host isolation: setting one does not affect the other', () => {
    const c = new VeeamTokenCache();
    c.set('a.example.com', 'tok-a', 3600);
    c.set('b.example.com', 'tok-b', 60); // b expires within margin
    expect(c.get('a.example.com')).toBe('tok-a');
    expect(c.get('b.example.com')).toBeNull();
  });
});

describe('oauthLogin', () => {
  const baseUrl = 'https://vbr.example.com:9419';
  const apiVersion = '1.1-rev1';

  it('happy path returns ok with accessToken and expiresInSec', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'tok-xyz',
          refresh_token: 'r',
          expires_in: 86400,
          token_type: 'bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'secret',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.accessToken).toBe('tok-xyz');
      expect(out.expiresInSec).toBe(86400);
    }
    const [url, opts] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe(`${baseUrl}/api/oauth2/token`);
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-api-version']).toBe(apiVersion);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(opts.body).toContain('grant_type=password');
    expect(opts.body).toContain('username=svc');
    // password should be in body — that's what x-www-form-urlencoded is for
    expect(opts.body).toContain('password=secret');
  });

  it('401 → auth-failed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'wrong',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.kind).toBe('auth-failed');
  });

  it('500 → unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'p',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.kind).toBe('unreachable');
  });

  it('thrown TypeError → unreachable', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('fetch failed'), { name: 'TypeError' }));
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'p',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.kind).toBe('unreachable');
  });

  it('response lacks access_token → error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ refresh_token: 'r' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'p',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.kind).toBe('error');
  });

  it('defaults expires_in to 3600 when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const out = await oauthLogin({
      baseUrl,
      username: 'svc',
      password: 'p',
      apiVersion,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    });
    if (out.ok) expect(out.expiresInSec).toBe(3600);
  });
});
