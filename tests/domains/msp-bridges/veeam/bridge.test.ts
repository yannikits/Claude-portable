import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger } from '../../../../src/core/audit/index.js';
import type { AuditEntry } from '../../../../src/core/audit/types.js';
import { withAuditTrail } from '../../../../src/domains/msp-bridges/index.js';
import { VeeamBridge } from '../../../../src/domains/msp-bridges/veeam/index.js';
import type {
  VeeamBridgeConfig,
  VeeamCredentials,
  VeeamSessionRaw,
} from '../../../../src/domains/msp-bridges/veeam/types.js';
import type { CustomerRecord } from '../../../../src/domains/msp-customers/index.js';

const HOST = 'vbr.mueller.local';
const PORT = 9419;
const BASE = `https://${HOST}:${PORT}`;
const TOKEN = 'tok-XYZ';

function customer(
  opts: { withVeeam?: boolean; jobNames?: string[]; port?: number } = {},
): CustomerRecord {
  return {
    slug: 'mueller-gmbh',
    displayName: 'Mueller GmbH',
    ...(opts.withVeeam !== false
      ? {
          bridges: {
            veeam: {
              serverHostname: HOST,
              ...(opts.port !== undefined ? { serverPort: opts.port } : {}),
              ...(opts.jobNames !== undefined ? { jobNames: opts.jobNames } : {}),
            },
          },
        }
      : {}),
  };
}

function tokenResponse(token = TOKEN, expiresIn = 86400): Response {
  return new Response(
    JSON.stringify({ access_token: token, refresh_token: 'r', expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function sessionsResponse(sessions: VeeamSessionRaw[]): Response {
  return new Response(JSON.stringify({ data: sessions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const validCreds: VeeamCredentials = { username: 'svc-claude', password: 'pw' };

function bridge(
  fetchMock: ReturnType<typeof vi.fn>,
  credsFn: (host: string) => Promise<VeeamCredentials | null> = async () => validCreds,
  overrides: Partial<VeeamBridgeConfig> = {},
): VeeamBridge {
  return new VeeamBridge({
    getCredentialsForHost: credsFn,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...overrides,
  });
}

describe('VeeamBridge.probe', () => {
  it('misconfigured WITHOUT making a fetch call when bridges.veeam is missing', async () => {
    const fetchMock = vi.fn();
    const probe = await bridge(fetchMock).probe(customer({ withVeeam: false }));
    expect(probe.result.kind).toBe('misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auth-failed WITHOUT making a fetch call when getCredentialsForHost yields null', async () => {
    const fetchMock = vi.fn();
    const probe = await bridge(fetchMock, async () => null).probe(customer());
    expect(probe.result.kind).toBe('auth-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auth-failed when username or password is empty', async () => {
    const fetchMock = vi.fn();
    const probe = await bridge(fetchMock, async () => ({ username: '', password: 'p' })).probe(
      customer(),
    );
    expect(probe.result.kind).toBe('auth-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('happy path: OAuth login + sessions GET + correct mapping', async () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
      { jobName: 'daily-fs', result: 'Failed', endTime: '2026-05-27T02:00:00Z' },
      { jobName: 'weekly-dc', result: 'Warning', endTime: '2026-05-28T03:00:00Z' },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sessionsResponse(sessions));
    const probe = await bridge(fetchMock).probe(customer());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokUrl, tokOpts] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(tokUrl).toBe(`${BASE}/api/oauth2/token`);
    expect(tokOpts.method).toBe('POST');
    expect(tokOpts.headers['x-api-version']).toBe('1.1-rev1');
    const [sessUrl, sessOpts] = fetchMock.mock.calls[1] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(sessUrl).toBe(`${BASE}/api/v1/sessions?typeFilter=Backup&limit=200`);
    expect(sessOpts.method).toBe('GET');
    expect(sessOpts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sessOpts.headers['x-api-version']).toBe('1.1-rev1');
    expect(probe.result.kind).toBe('ok');
    if (probe.result.kind === 'ok') {
      expect(probe.result.data.knownJobs).toBe(2);
      expect(probe.result.data.okCount).toBe(1);
      expect(probe.result.data.warningCount).toBe(1);
    }
  });

  it('uses configured serverPort from customer.yaml when set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sessionsResponse([]));
    await bridge(fetchMock).probe(customer({ port: 9420 }));
    const [tokUrl] = fetchMock.mock.calls[0] as [string];
    expect(tokUrl).toBe(`https://${HOST}:9420/api/oauth2/token`);
  });

  it('OAuth 401 → auth-failed (no sessions call)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
    const probe = await bridge(fetchMock).probe(customer());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(probe.result.kind).toBe('auth-failed');
  });

  it('read 401 → invalidate cache, relogin, retry once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('first-tok'))
      .mockResolvedValueOnce(new Response('', { status: 401 })) // sessions call → 401
      .mockResolvedValueOnce(tokenResponse('second-tok')) // re-login
      .mockResolvedValueOnce(sessionsResponse([])); // retried sessions

    const probe = await bridge(fetchMock).probe(customer());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(probe.result.kind).toBe('ok');
    const retried = fetchMock.mock.calls[3] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(retried[1].headers.Authorization).toBe('Bearer second-tok');
  });

  it('read 401 + re-login also 401 → auth-failed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 })); // re-login fails

    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('auth-failed');
  });

  it('read 500 → unreachable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('unreachable');
  });

  it('read 400 with api-version body → misconfigured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response('The requested api-version 1.0-rev1 is not supported.', { status: 400 }),
      );
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('misconfigured');
  });

  it('unexpected response shape → error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ foo: 'bar' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('error');
  });

  it('filterJobNames is applied (jobNames from customer.yaml)', async () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'mine', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
      { jobName: 'other-customer', result: 'Failed', endTime: '2026-05-28T02:00:00Z' },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sessionsResponse(sessions));
    const probe = await bridge(fetchMock).probe(customer({ jobNames: ['mine'] }));
    expect(probe.result.kind).toBe('ok');
    if (probe.result.kind === 'ok') {
      expect(probe.result.data.knownJobs).toBe(1);
      expect(probe.result.data.failedCount).toBe(0);
    }
  });

  it('getCredentialsForHost called on EVERY probe (no creds cache, per ADR-0038)', async () => {
    const credsFn = vi.fn().mockResolvedValue(validCreds);
    const fetchMock = vi.fn().mockResolvedValue(sessionsResponse([])); // every call returns ok-empty
    // Override sessions for the alternating token/sessions pattern:
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sessionsResponse([]))
      .mockResolvedValueOnce(sessionsResponse([])) // 2nd probe: cached token, ONLY sessions call
      .mockResolvedValueOnce(sessionsResponse([])); // 3rd probe likewise

    const b = bridge(fetchMock, credsFn);
    await b.probe(customer());
    await b.probe(customer());
    await b.probe(customer());
    // 3 probes → 3 credential lookups
    expect(credsFn).toHaveBeenCalledTimes(3);
    // 3 probes → 1 OAuth (cached) + 3 sessions = 4 fetches total
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('VeeamBridge + withAuditTrail integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'veeam-audit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function events(): AuditEntry[] {
    const out: AuditEntry[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('audit-') || !f.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(dir, f), 'utf-8').split('\n')) {
        if (line.trim().length === 0) continue;
        out.push(JSON.parse(line) as AuditEntry);
      }
    }
    return out;
  }

  it('writes bridge.read event with action=bridge.veeam.probe + outcome=ok + NO creds/jobName in details', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        sessionsResponse([
          { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
        ]),
      );
    const inner = bridge(fetchMock);
    const logger = new AuditLogger({ auditDir: dir });
    await withAuditTrail(inner, logger).probe(customer());
    const e = events()[0];
    expect(e?.kind).toBe('bridge.read');
    expect(e?.action).toBe('bridge.veeam.probe');
    expect(e?.outcome).toBe('ok');
    const ds = JSON.stringify(e?.details ?? {});
    expect(ds).not.toContain('svc-claude');
    expect(ds).not.toContain('daily-fs');
    expect(ds).not.toContain(TOKEN);
  });

  it('OAuth 401 → outcome=denied in audit', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
    const inner = bridge(fetchMock);
    const logger = new AuditLogger({ auditDir: dir });
    await withAuditTrail(inner, logger).probe(customer());
    expect(events()[0]?.outcome).toBe('denied');
  });
});
