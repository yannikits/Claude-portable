/**
 * Audit-Wrapper-Tests — verify every probe emits a bridge.read event
 * with the right outcome + details payload.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../../../src/core/audit/index.js';
import type { AuditEntry } from '../../../src/core/audit/types.js';
import {
  type BridgeKind,
  type BridgeProbe,
  type BridgeResult,
  NullBridge,
  type ReadBridge,
  withAuditTrail,
} from '../../../src/domains/msp-bridges/index.js';
import type { CustomerRecord } from '../../../src/domains/msp-customers/index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-wrap-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function customer(slug: string, hasBridge = true): CustomerRecord {
  return {
    slug,
    displayName: slug,
    ...(hasBridge ? { bridges: { tanss: { customerId: 1 } } } : {}),
  };
}

function readAllEvents(): AuditEntry[] {
  const files = readdirSync(dir);
  const out: AuditEntry[] = [];
  for (const f of files) {
    if (!f.startsWith('audit-') || !f.endsWith('.jsonl')) continue;
    const raw = readFileSync(join(dir, f), 'utf-8');
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      out.push(JSON.parse(line) as AuditEntry);
    }
  }
  return out;
}

/** Stub bridge that returns whatever result the test provides. */
class StubBridge<T> implements ReadBridge<T> {
  constructor(
    public readonly kind: BridgeKind,
    private readonly result: BridgeResult<T>,
  ) {}
  async probe(c: CustomerRecord): Promise<BridgeProbe<T>> {
    return {
      bridgeKind: this.kind,
      customerSlug: c.slug,
      probedAt: new Date().toISOString(),
      durationMs: 7,
      result: this.result,
    };
  }
}

describe('withAuditTrail', () => {
  it('emits a bridge.read event on ok probe', async () => {
    const logger = new AuditLogger({ auditDir: dir });
    const bridge = withAuditTrail(new NullBridge('tanss'), logger);
    await bridge.probe(customer('mueller-gmbh'));
    const events = readAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('bridge.read');
    expect(events[0]?.outcome).toBe('ok');
    expect(events[0]?.action).toBe('bridge.tanss.probe');
    expect(events[0]?.tenant).toBe('mueller-gmbh');
    expect(events[0]?.details?.bridgeKind).toBe('tanss');
    expect(events[0]?.details?.resultKind).toBe('ok');
  });

  it('emits outcome=denied for auth-failed', async () => {
    const logger = new AuditLogger({ auditDir: dir });
    const inner = new StubBridge<unknown>('tanss', {
      kind: 'auth-failed',
      message: 'token expired',
    });
    const bridge = withAuditTrail(inner, logger);
    await bridge.probe(customer('mueller-gmbh'));
    const e = readAllEvents()[0];
    expect(e?.outcome).toBe('denied');
    expect(e?.details?.message).toBe('token expired');
  });

  it('emits outcome=error for unreachable / rate-limited / misconfigured / error', async () => {
    const logger = new AuditLogger({ auditDir: dir });
    const cases: BridgeResult<unknown>[] = [
      { kind: 'unreachable', message: 'connect ETIMEDOUT' },
      { kind: 'rate-limited', retryAfterSec: 30, message: '429' },
      { kind: 'misconfigured', message: 'no bridges.tanss section' },
      { kind: 'error', message: 'unexpected: ENOMEM' },
    ];
    for (const c of cases) {
      const stub = new StubBridge<unknown>('tanss', c);
      const bridge = withAuditTrail(stub, logger);
      await bridge.probe(customer(`cust-${c.kind}`));
    }
    const outcomes = readAllEvents().map((e) => e.outcome);
    expect(outcomes).toEqual(['error', 'error', 'error', 'error']);
  });

  it('honors workspace override', async () => {
    const logger = new AuditLogger({ auditDir: dir });
    const bridge = withAuditTrail(new NullBridge('tanss'), logger, { workspace: 'msp-internal' });
    await bridge.probe(customer('mueller-gmbh'));
    expect(readAllEvents()[0]?.workspace).toBe('msp-internal');
  });

  it('does NOT throw when the inner bridge returns misconfigured', async () => {
    const logger = new AuditLogger({ auditDir: dir });
    const bridge = withAuditTrail(new NullBridge('tanss'), logger);
    const out = await bridge.probe(customer('cust-no-bridge', false));
    expect(out.result.kind).toBe('misconfigured');
    expect(readAllEvents()).toHaveLength(1);
  });
});
