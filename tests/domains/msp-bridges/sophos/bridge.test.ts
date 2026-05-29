import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger } from '../../../../src/core/audit/index.js';
import type { AuditEntry } from '../../../../src/core/audit/types.js';
import { withAuditTrail } from '../../../../src/domains/msp-bridges/index.js';
import { SophosBridge } from '../../../../src/domains/msp-bridges/sophos/index.js';
import type { SophosBridgeConfig } from '../../../../src/domains/msp-bridges/sophos/types.js';
import type { CustomerRecord } from '../../../../src/domains/msp-customers/index.js';

const HOST = 'fw.mueller.local';
const PORT = 4444;
const URL = `https://${HOST}:${PORT}/webconsole/APIController`;

function customer(opts: { withSophos?: boolean; port?: number } = {}): CustomerRecord {
  return {
    slug: 'mueller-gmbh',
    displayName: 'Mueller GmbH',
    ...(opts.withSophos !== false
      ? {
          bridges: {
            sophos: {
              firewallHostname: HOST,
              ...(opts.port !== undefined ? { firewallPort: opts.port } : {}),
            },
          },
        }
      : {}),
  };
}

const HAPPY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Response APIVersion="2000.1">
  <Login><status>Authentication Successful</status></Login>
  <Firmware><Version>SFOS 20.0.1 MR-1</Version><Type>Default</Type></Firmware>
  <LicenseInformation>
    <Subscriptions>
      <Subscription>
        <Name>Network Protection</Name>
        <Status>Subscribed</Status>
        <ExpiryDate>2027-01-31</ExpiryDate>
      </Subscription>
    </Subscriptions>
  </LicenseInformation>
</Response>`;

const STATUS_534_XML = `<Response><Status code="534">IP not allowed in API Access list</Status></Response>`;
const STATUS_532_XML = `<Response><Status code="532">API not enabled</Status></Response>`;
const LOGIN_FAIL_XML = `<Response><Login><status>Authentication Failure</status></Login></Response>`;

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/xml' } });
}

const validCreds = { username: 'svc-claude', password: 'pw' };

function bridge(
  fetchMock: ReturnType<typeof vi.fn>,
  credsFn: SophosBridgeConfig['getCredentialsForHost'] = async () => validCreds,
  overrides: Partial<SophosBridgeConfig> = {},
): SophosBridge {
  return new SophosBridge({
    getCredentialsForHost: credsFn,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    ...overrides,
  });
}

describe('SophosBridge.probe', () => {
  it('misconfigured WITHOUT making a fetch call when bridges.sophos is missing', async () => {
    const fetchMock = vi.fn();
    const probe = await bridge(fetchMock).probe(customer({ withSophos: false }));
    expect(probe.result.kind).toBe('misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auth-failed WITHOUT making a fetch call when getCredentialsForHost returns null', async () => {
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

  it('happy path: POSTs ONE request with creds + Firmware + LicenseInformation Gets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(HAPPY_XML));
    const probe = await bridge(fetchMock).probe(customer());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string>; body: string },
    ];
    expect(calledUrl).toBe(URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Body is URL-encoded: contains reqxml=<URL-encoded XML>
    expect(opts.body).toMatch(/^reqxml=/);
    const decoded = decodeURIComponent(opts.body.slice('reqxml='.length).replace(/\+/g, ' '));
    expect(decoded).toContain('<Username>svc-claude</Username>');
    expect(decoded).toContain('<Get><Firmware></Firmware></Get>');
    expect(decoded).toContain('<Get><LicenseInformation></LicenseInformation></Get>');
    expect(probe.result.kind).toBe('ok');
    if (probe.result.kind === 'ok') {
      expect(probe.result.data.firmwareVersion).toBe('SFOS 20.0.1 MR-1');
      expect(probe.result.data.subscriptions).toHaveLength(1);
    }
  });

  it('uses configured firewallPort from customer.yaml', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(HAPPY_XML));
    await bridge(fetchMock).probe(customer({ port: 4445 }));
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe(`https://${HOST}:4445/webconsole/APIController`);
  });

  it('Sophos Status 534 → auth-failed with helpful message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(STATUS_534_XML));
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('auth-failed');
    if (probe.result.kind === 'auth-failed') {
      expect(probe.result.message).toContain('IP not allowed');
    }
  });

  it('Sophos Status 532 → misconfigured with enable-hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(STATUS_532_XML));
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('misconfigured');
  });

  it('Login Authentication Failure (no Status code) → auth-failed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(LOGIN_FAIL_XML));
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('auth-failed');
  });

  it('HTTP 500 → unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    expect((await bridge(fetchMock).probe(customer())).result.kind).toBe('unreachable');
  });

  it('thrown TypeError → unreachable', async () => {
    const err = Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    const fetchMock = vi.fn().mockRejectedValue(err);
    expect((await bridge(fetchMock).probe(customer())).result.kind).toBe('unreachable');
  });

  it('thrown UNABLE_TO_VERIFY_LEAF_SIGNATURE → unreachable with TLS hint', async () => {
    const err = Object.assign(new Error(''), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    const fetchMock = vi.fn().mockRejectedValue(err);
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('unreachable');
    if (probe.result.kind === 'unreachable') {
      expect(probe.result.message).toContain('CLAUDE_OS_SOPHOS_INSECURE_TLS');
    }
  });

  it('unparsable XML → error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse('not-xml-at-all'));
    const probe = await bridge(fetchMock).probe(customer());
    expect(probe.result.kind).toBe('error');
  });

  it('AbortController-driven timeout → unreachable', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const b = bridge(fetchMock, async () => validCreds, { timeoutMs: 50 });
    const probe = await b.probe(customer());
    expect(probe.result.kind).toBe('unreachable');
  });

  it('calls getCredentialsForHost ONCE per probe (no caching of creds)', async () => {
    const credsFn = vi.fn().mockResolvedValue(validCreds);
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(HAPPY_XML));
    const b = bridge(fetchMock, credsFn);
    await b.probe(customer());
    await b.probe(customer());
    await b.probe(customer());
    expect(credsFn).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('SophosBridge + withAuditTrail integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sophos-audit-'));
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

  it('writes bridge.read event with action=bridge.sophos.probe and NO creds/subscriptions in details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(HAPPY_XML));
    const inner = bridge(fetchMock);
    const logger = new AuditLogger({ auditDir: dir });
    await withAuditTrail(inner, logger).probe(customer());
    const e = events()[0];
    expect(e?.kind).toBe('bridge.read');
    expect(e?.action).toBe('bridge.sophos.probe');
    expect(e?.outcome).toBe('ok');
    const ds = JSON.stringify(e?.details ?? {});
    expect(ds).not.toContain('svc-claude');
    expect(ds).not.toContain('Network Protection');
  });

  it('Status 534 → outcome=denied in audit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(STATUS_534_XML));
    const inner = bridge(fetchMock);
    const logger = new AuditLogger({ auditDir: dir });
    await withAuditTrail(inner, logger).probe(customer());
    expect(events()[0]?.outcome).toBe('denied');
  });
});
