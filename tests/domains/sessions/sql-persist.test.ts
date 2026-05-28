import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveSessionsDbPath,
  SessionError,
  SessionRepository,
  SqlSessionPersistAdapter,
} from '../../../src/domains/sessions/index.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'session-persist-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SqlSessionPersistAdapter — standalone', () => {
  it('creates a fresh sessions.sqlite on open', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    expect(statSync(resolveSessionsDbPath(dataDir)).isFile()).toBe(true);
    expect(adapter.loadAll()).toEqual([]);
    adapter.close();
  });

  it('persists save/delete/loadAll roundtrip', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const s = {
      id: 'sess-1',
      userId: 'user-1',
      createdAt: 1_700_000_000_000,
      lastUsedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60_000,
      userAgent: 'curl/8',
      ip: '1.2.3.4',
    };
    adapter.save(s);
    const reloaded = adapter.loadAll();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toEqual(s);

    adapter.delete('sess-1');
    expect(adapter.loadAll()).toEqual([]);
    adapter.close();
  });

  it('survives close + re-open with all fields intact', async () => {
    const first = await SqlSessionPersistAdapter.open({ dataDir });
    first.save({
      id: 'sess-survive',
      userId: 'user-1',
      createdAt: 1_700_000_000_000,
      lastUsedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_000_000 + 60_000,
      userAgent: null,
      ip: null,
    });
    first.close();

    const second = await SqlSessionPersistAdapter.open({ dataDir });
    const found = second.loadAll().find((s) => s.id === 'sess-survive');
    expect(found).toBeDefined();
    expect(found?.userId).toBe('user-1');
    expect(found?.userAgent).toBeNull();
    expect(found?.ip).toBeNull();
    second.close();
  });

  it('deleteAllForUser removes only that user’s sessions', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const mk = (id: string, userId: string) => ({
      id,
      userId,
      createdAt: 0,
      lastUsedAt: 0,
      expiresAt: 99999999999,
      userAgent: null,
      ip: null,
    });
    adapter.save(mk('a1', 'alice'));
    adapter.save(mk('a2', 'alice'));
    adapter.save(mk('b1', 'bob'));
    adapter.deleteAllForUser('alice');

    const remaining = adapter.loadAll();
    expect(remaining.map((s) => s.id)).toEqual(['b1']);
    adapter.close();
  });

  it('purgeExpired removes only expired entries and returns the count', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    adapter.save({
      id: 'expired-1',
      userId: 'u1',
      createdAt: 0,
      lastUsedAt: 0,
      expiresAt: 1_000,
      userAgent: null,
      ip: null,
    });
    adapter.save({
      id: 'live-1',
      userId: 'u1',
      createdAt: 0,
      lastUsedAt: 0,
      expiresAt: 99999999999,
      userAgent: null,
      ip: null,
    });
    expect(adapter.purgeExpired(5_000)).toBe(1);
    expect(adapter.loadAll().map((s) => s.id)).toEqual(['live-1']);
    adapter.close();
  });

  it('refuses to open a sessions.sqlite with mismatched schema-version', async () => {
    writeFileSync(resolveSessionsDbPath(dataDir), 'this is not a sqlite file');
    await expect(SqlSessionPersistAdapter.open({ dataDir })).rejects.toBeInstanceOf(Error);
  });

  it('refuses operations after close', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    adapter.close();
    expect(() => adapter.loadAll()).toThrow(SessionError);
  });
});

describe('SessionRepository — with persistence', () => {
  it('issue() mirrors to the adapter', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const repo = new SessionRepository({ persist: adapter });
    const session = repo.issue({ userId: 'alice', ip: '1.2.3.4' });
    expect(adapter.loadAll().map((s) => s.id)).toEqual([session.id]);
    adapter.close();
  });

  it('survives a "restart": new SessionRepository preloads from the adapter', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const first = new SessionRepository({ persist: adapter });
    const issued = first.issue({ userId: 'alice' });
    // First repo is dropped — simulating process exit / container restart.
    adapter.close();

    // Re-open the file from a fresh adapter + repo.
    const adapter2 = await SqlSessionPersistAdapter.open({ dataDir });
    const second = new SessionRepository({ persist: adapter2 });
    const resolved = second.resolve(issued.id);
    expect(resolved).not.toBeNull();
    expect(resolved?.userId).toBe('alice');
    adapter2.close();
  });

  it('preload skips already-expired entries', async () => {
    let t = 1_700_000_000_000;
    const ttlMs = 60_000;

    const adapter1 = await SqlSessionPersistAdapter.open({ dataDir });
    const repo1 = new SessionRepository({ ttlMs, now: () => t, persist: adapter1 });
    repo1.issue({ userId: 'alice' });
    expect(repo1.size()).toBe(1);
    adapter1.close();

    t += ttlMs + 1;

    const adapter2 = await SqlSessionPersistAdapter.open({ dataDir });
    const repo2 = new SessionRepository({ ttlMs, now: () => t, persist: adapter2 });
    expect(repo2.size()).toBe(0);
    adapter2.close();
  });

  it('revoke() mirrors to the adapter', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const repo = new SessionRepository({ persist: adapter });
    const s = repo.issue({ userId: 'alice' });
    expect(repo.revoke(s.id)).toBe(true);
    expect(adapter.loadAll()).toEqual([]);
    adapter.close();
  });

  it('revokeAllForUser() mirrors to the adapter', async () => {
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const repo = new SessionRepository({ persist: adapter });
    repo.issue({ userId: 'alice' });
    repo.issue({ userId: 'alice' });
    repo.issue({ userId: 'bob' });
    expect(repo.revokeAllForUser('alice')).toBe(2);
    const remaining = adapter.loadAll();
    expect(remaining.map((s) => s.userId)).toEqual(['bob']);
    adapter.close();
  });

  it('resolve() refreshes lastUsedAt in the persistent store too', async () => {
    let t = 1_700_000_000_000;
    const adapter = await SqlSessionPersistAdapter.open({ dataDir });
    const repo = new SessionRepository({ now: () => t, persist: adapter });
    const s = repo.issue({ userId: 'alice' });

    t += 10_000;
    repo.resolve(s.id);

    const persisted = adapter.loadAll().find((row) => row.id === s.id);
    expect(persisted?.lastUsedAt).toBe(t);
    adapter.close();
  });
});
