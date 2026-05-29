/**
 * Audit-routes HTTP tests — admin-gating + filter-parsing + export.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../src/core/audit/types.js';
import { SessionRepository } from '../../src/domains/sessions/index.js';
import { UserRepository } from '../../src/domains/users/index.js';
import { makeCookieAuthHook } from '../../src/server/cookie-auth.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../../src/server/cookies.js';
import { LoginRateLimiter } from '../../src/server/rate-limit.js';
import { registerAuditRoutes } from '../../src/server/routes-audit.js';
import { registerAuthRoutes } from '../../src/server/routes-auth.js';

const STRONG = 'correct-horse-battery-staple-12+';
const ADMIN_EMAIL = 'admin@example.com';
const REGULAR_EMAIL = 'regular@example.com';
const FALLBACK_TOKEN = 'fallback-token-for-audit-test';

interface Harness {
  app: FastifyInstance;
  userRepo: UserRepository;
  dataDir: string;
  auditDir: string;
}

async function buildHarness(adminEmails: readonly string[] = [ADMIN_EMAIL]): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'routes-audit-'));
  const auditDir = join(dataDir, 'audit');
  // Make the auditDir resolvable via CLAUDE_OS_DATA_DIR env override.
  process.env.CLAUDE_OS_DATA_DIR = dataDir;

  const userRepo = await UserRepository.open({ dataDir });
  await userRepo.createUser(ADMIN_EMAIL, STRONG);
  await userRepo.createUser(REGULAR_EMAIL, STRONG);
  const sessionRepo = new SessionRepository();
  const rateLimiter = new LoginRateLimiter({ capacity: 50 });

  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  app.addHook(
    'preHandler',
    makeCookieAuthHook({ expectedTokens: [FALLBACK_TOKEN], sessionRepo, userRepo }),
  );
  registerAuthRoutes(app, {
    userRepo,
    sessionRepo,
    rateLimiter,
    insecureCookies: true,
    sessionMaxAgeSec: 60 * 60,
  });
  registerAuditRoutes(app, { adminEmails, auditDir });

  return { app, userRepo, dataDir, auditDir };
}

function writeAuditDay(auditDir: string, day: string, entries: AuditEntry[]): void {
  // Force-create the audit subdir.
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(auditDir, { recursive: true });
  writeFileSync(
    join(auditDir, `audit-${day}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

function entry(at: string, action = 'a'): AuditEntry {
  return {
    schema_version: 1,
    at,
    kind: 'note.write',
    action,
    workspace: 'personal',
    outcome: 'ok',
    pid: 1,
    hostname: 'test',
  };
}

function extractCookie(setCookie: string | string[] | undefined, name: string): string | null {
  if (setCookie === undefined) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of arr) {
    const m = h.match(new RegExp(`^${name}=([^;]*)`));
    if (m !== null) return m[1] ?? null;
  }
  return null;
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: STRONG },
  });
  const setCookies = res.headers['set-cookie'];
  const sessionId = extractCookie(setCookies, SESSION_COOKIE_NAME);
  const csrf = extractCookie(setCookies, CSRF_COOKIE_NAME);
  if (sessionId === null || csrf === null) throw new Error(`login as ${email} failed`);
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${CSRF_COOKIE_NAME}=${csrf}`;
}

let h: Harness;

afterEach(async () => {
  if (h !== undefined) {
    await h.app.close();
    h.userRepo.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  }
  delete process.env.CLAUDE_OS_DATA_DIR;
});

describe('registerAuditRoutes — gating', () => {
  it('returns 401 without cookie-auth', async () => {
    h = await buildHarness();
    const res = await h.app.inject({ method: 'GET', url: '/api/audit/list' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    h = await buildHarness();
    const cookie = await loginAs(h.app, REGULAR_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/list',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('forbidden');
  });

  it('does not register routes when allowlist is empty', async () => {
    h = await buildHarness([]);
    const res = await h.app.inject({ method: 'GET', url: '/api/audit/list' });
    expect(res.statusCode).toBe(401); // global auth-hook blocks before 404
  });
});

describe('GET /api/audit/list', () => {
  it('returns the page payload for admin', async () => {
    h = await buildHarness();
    writeAuditDay(h.auditDir, '2026-05-29', [
      entry('2026-05-29T08:00:00.000Z', 'first'),
      entry('2026-05-29T16:00:00.000Z', 'last'),
    ]);
    const cookie = await loginAs(h.app, ADMIN_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/list?from=2026-05-29T00:00:00Z&to=2026-05-29T23:59:59Z',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.entries.map((e: AuditEntry) => e.action)).toEqual(['last', 'first']);
  });

  it('parses kinds + outcome filter', async () => {
    h = await buildHarness();
    writeAuditDay(h.auditDir, '2026-05-29', [
      { ...entry('2026-05-29T08:00:00.000Z'), outcome: 'ok' },
      { ...entry('2026-05-29T09:00:00.000Z'), outcome: 'denied' },
    ]);
    const cookie = await loginAs(h.app, ADMIN_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/list?from=2026-05-29T00:00:00Z&to=2026-05-29T23:59:59Z&outcome=denied',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(1);
    expect(body.entries[0].outcome).toBe('denied');
  });
});

describe('GET /api/audit/stats', () => {
  it('returns per-kind counts for admin', async () => {
    h = await buildHarness();
    writeAuditDay(h.auditDir, '2026-05-29', [
      entry('2026-05-29T08:00:00.000Z'),
      entry('2026-05-29T09:00:00.000Z'),
    ]);
    const cookie = await loginAs(h.app, ADMIN_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/stats?from=2026-05-29T00:00:00Z&to=2026-05-29T23:59:59Z',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalEvents).toBe(2);
    expect(body.counts['note.write']).toBe(2);
  });
});

describe('GET /api/audit/export', () => {
  it('exports JSONL by default', async () => {
    h = await buildHarness();
    writeAuditDay(h.auditDir, '2026-05-29', [entry('2026-05-29T08:00:00.000Z', 'x')]);
    const cookie = await loginAs(h.app, ADMIN_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/export?from=2026-05-29T00:00:00Z&to=2026-05-29T23:59:59Z',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.suggestedFilename).toMatch(/\.jsonl$/);
    expect(body.content).toContain('"action":"x"');
  });

  it('exports CSV when format=csv', async () => {
    h = await buildHarness();
    writeAuditDay(h.auditDir, '2026-05-29', [entry('2026-05-29T08:00:00.000Z', 'x,with,commas')]);
    const cookie = await loginAs(h.app, ADMIN_EMAIL);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/audit/export?from=2026-05-29T00:00:00Z&to=2026-05-29T23:59:59Z&format=csv',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.suggestedFilename).toMatch(/\.csv$/);
    // CSV-escaped comma
    expect(body.content).toContain('"x,with,commas"');
  });
});
