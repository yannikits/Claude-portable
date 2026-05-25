/**
 * Phase 2f — RPC tests for workspace.* / notes.* / retrieval.* methods.
 *
 * Tests run against a real tmpdir vault + tmpdir dataDir via env-vars.
 * Sidecar dispatcher uses real `registerMethods` so the wiring of
 * registerWorkspaceMethods + registerNotesMethods + registerRetrievalMethods
 * via the orchestrator is exercised as well.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerMethods } from '../../src/sidecar/methods.js';
import { RpcDispatcher } from '../../src/sidecar/rpc.js';

interface CapturedNotification {
  method: string;
  params: unknown;
}

function setupSidecarEnv(): { tmpRoot: string; tmpData: string; vault: string } {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'cos-mem-root-'));
  const tmpData = mkdtempSync(join(tmpdir(), 'cos-mem-data-'));
  mkdirSync(join(tmpData, 'data'), { recursive: true });
  writeFileSync(join(tmpRoot, '.claude-os-root'), '');
  const vault = mkdtempSync(join(tmpdir(), 'cos-mem-vault-'));
  process.env.CLAUDE_OS_ROOT = tmpRoot;
  process.env.CLAUDE_OS_DATA_DIR = tmpData;
  process.env.CLAUDE_OS_VAULT_PATH = vault;
  return { tmpRoot, tmpData, vault };
}

function makeDispatcher(): {
  dispatcher: RpcDispatcher;
  notifications: CapturedNotification[];
} {
  const dispatcher = new RpcDispatcher();
  const notifications: CapturedNotification[] = [];
  registerMethods(dispatcher, {
    emit: (method, params) => notifications.push({ method, params }),
  });
  return { dispatcher, notifications };
}

describe('workspace.* RPCs', () => {
  let cleanup: { tmpRoot: string; tmpData: string; vault: string };
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
    cleanup = setupSidecarEnv();
  });

  afterEach(() => {
    rmSync(cleanup.tmpRoot, { recursive: true, force: true });
    rmSync(cleanup.tmpData, { recursive: true, force: true });
    rmSync(cleanup.vault, { recursive: true, force: true });
    process.env = envBackup;
  });

  it('workspace.current returns personal default on fresh state', async () => {
    const { dispatcher } = makeDispatcher();
    const r = (await dispatcher.invoke('workspace.current', {})) as {
      active: string;
      kind: string;
      vaultPath: string;
      path: string | null;
    };
    expect(r.active).toBe('personal');
    expect(r.kind).toBe('personal');
    expect(r.vaultPath).toBe(cleanup.vault);
    expect(r.path).toBeNull();
  });

  it('workspace.list returns at least the personal default', async () => {
    const { dispatcher } = makeDispatcher();
    const r = (await dispatcher.invoke('workspace.list', {})) as {
      active: string;
      vaultPath: string;
      workspaces: readonly { id: string }[];
    };
    expect(r.active).toBe('personal');
    expect(r.workspaces.map((w) => w.id)).toContain('personal');
  });

  it('workspace.use persists + emits workspace://switched', async () => {
    const { dispatcher, notifications } = makeDispatcher();
    const r = (await dispatcher.invoke('workspace.use', { id: 'msp-internal' })) as {
      from: string;
      to: string;
    };
    expect(r.from).toBe('personal');
    expect(r.to).toBe('msp-internal');
    // Notification was emitted with correct payload.
    const switched = notifications.find((n) => n.method === 'workspace://switched');
    expect(switched).toBeDefined();
    expect(switched?.params).toMatchObject({ from: 'personal', to: 'msp-internal' });
    // workspace.current now reflects the switch.
    const cur = (await dispatcher.invoke('workspace.current', {})) as { active: string };
    expect(cur.active).toBe('msp-internal');
  });

  it('workspace.use rejects invalid ids', async () => {
    const { dispatcher } = makeDispatcher();
    await expect(dispatcher.invoke('workspace.use', { id: '../escape' })).rejects.toThrow();
  });

  it('workspace.current throws when CLAUDE_OS_VAULT_PATH is unset', async () => {
    delete process.env.CLAUDE_OS_VAULT_PATH;
    const { dispatcher } = makeDispatcher();
    await expect(dispatcher.invoke('workspace.current', {})).rejects.toThrow(
      /CLAUDE_OS_VAULT_PATH/,
    );
  });
});

describe('notes.* + retrieval.* RPCs', () => {
  let cleanup: { tmpRoot: string; tmpData: string; vault: string };
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
    cleanup = setupSidecarEnv();
  });

  afterEach(() => {
    rmSync(cleanup.tmpRoot, { recursive: true, force: true });
    rmSync(cleanup.tmpData, { recursive: true, force: true });
    rmSync(cleanup.vault, { recursive: true, force: true });
    process.env = envBackup;
  });

  it('notes.save creates a markdown file in the active workspace', async () => {
    const { dispatcher } = makeDispatcher();
    const r = (await dispatcher.invoke('notes.save', {
      filename: 'first.md',
      body: 'Hello world',
      frontmatter: { classification: 'personal', schema_version: 1 },
    })) as { path: string; created: boolean; workspace: string };
    expect(r.created).toBe(true);
    expect(r.workspace).toBe('personal');
    expect(r.path.replace(/\\/g, '/')).toContain('/Claude-OS/workspaces/personal/first.md');
  });

  it('notes.save rejects overwrite by default', async () => {
    const { dispatcher } = makeDispatcher();
    await dispatcher.invoke('notes.save', {
      filename: 'dup.md',
      body: 'a',
      frontmatter: { classification: 'personal', schema_version: 1 },
    });
    await expect(
      dispatcher.invoke('notes.save', {
        filename: 'dup.md',
        body: 'b',
        frontmatter: { classification: 'personal', schema_version: 1 },
      }),
    ).rejects.toThrow();
  });

  it('notes.list returns saved notes', async () => {
    const { dispatcher } = makeDispatcher();
    await dispatcher.invoke('notes.save', {
      filename: 'a.md',
      body: 'A',
      frontmatter: { classification: 'personal', schema_version: 1 },
    });
    await dispatcher.invoke('notes.save', {
      filename: 'b.md',
      body: 'B',
      frontmatter: { classification: 'personal', schema_version: 1 },
    });
    const items = (await dispatcher.invoke('notes.list', {})) as readonly { path: string }[];
    expect(items.length).toBe(2);
    expect(items.map((n) => n.path.split(/[\\/]/).pop()).sort()).toEqual(['a.md', 'b.md']);
  });

  it('retrieval.search ranks the matching note', async () => {
    const { dispatcher } = makeDispatcher();
    await dispatcher.invoke('notes.save', {
      filename: 'auth.md',
      body: 'Discussion about authentication patterns',
      frontmatter: { classification: 'personal', schema_version: 1 },
    });
    await dispatcher.invoke('notes.save', {
      filename: 'cook.md',
      body: 'Cooking recipe with garlic',
      frontmatter: { classification: 'personal', schema_version: 1 },
    });
    const r = (await dispatcher.invoke('retrieval.search', {
      text: 'authentication',
    })) as {
      hits: readonly { path: string; score: number }[];
      totalScanned: number;
      workspace: string;
    };
    expect(r.workspace).toBe('personal');
    expect(r.totalScanned).toBe(2);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]?.path.endsWith('auth.md')).toBe(true);
    expect(r.hits[0]?.score).toBeGreaterThan(0);
  });

  it('retrieval.search requires non-empty text', async () => {
    const { dispatcher } = makeDispatcher();
    await expect(dispatcher.invoke('retrieval.search', { text: '' })).rejects.toThrow();
  });
});
