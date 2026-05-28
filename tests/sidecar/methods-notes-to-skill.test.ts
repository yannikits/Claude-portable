import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftsDir } from '../../src/domains/skill-lifecycle/index.js';
import { registerMethods } from '../../src/sidecar/methods.js';
import { RpcDispatcher } from '../../src/sidecar/rpc.js';

const WORKSPACE = 'personal';
let tmpRoot: string;
let vault: string;
let envBackup: NodeJS.ProcessEnv;
let dispatcher: RpcDispatcher;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'claude-os-msp-e-'));
  writeFileSync(join(tmpRoot, '.claude-os-root'), '');
  vault = join(tmpRoot, 'vault');
  mkdirSync(join(vault, 'Claude-OS', 'workspaces', WORKSPACE), { recursive: true });
  mkdirSync(join(tmpRoot, 'config'), { recursive: true });
  writeFileSync(join(tmpRoot, 'config', 'workspace.json'), JSON.stringify({ active: WORKSPACE }));
  envBackup = { ...process.env };
  process.env.CLAUDE_OS_ROOT = tmpRoot;
  process.env.CLAUDE_OS_VAULT_PATH = vault;
  process.env.CLAUDE_OS_DATA_DIR = join(tmpRoot, 'data');
  mkdirSync(process.env.CLAUDE_OS_DATA_DIR, { recursive: true });
  dispatcher = new RpcDispatcher();
  registerMethods(dispatcher);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  process.env = envBackup;
});

function writeNote(opts: {
  filename: string;
  body: string;
  classification?: string;
  title?: string;
}): string {
  const notesDir = join(vault, 'Claude-OS', 'workspaces', WORKSPACE, 'notes');
  mkdirSync(notesDir, { recursive: true });
  const fm = [
    '---',
    `workspace: ${WORKSPACE}`,
    `classification: ${opts.classification ?? 'personal'}`,
    'schema_version: 1',
    ...(opts.title !== undefined ? [`title: ${opts.title}`] : []),
    '---',
  ].join('\n');
  const path = join(notesDir, opts.filename);
  writeFileSync(path, `${fm}\n\n${opts.body}`, 'utf8');
  return path;
}

describe('notes.proposeAsSkill', () => {
  it('returns proposed draft content + targetPath without writing', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-m365-reset.md',
      body: '# M365 License Reset\n\nFor a user, do X then Y.',
    });
    const res = (await dispatcher.invoke('notes.proposeAsSkill', { notePath })) as {
      ok: boolean;
      proposed: {
        name: string;
        workspace: string;
        classification: string;
        content: string;
        targetPath: string;
        alreadyExists: boolean;
      };
    };
    expect(res.ok).toBe(true);
    expect(res.proposed.name).toBe('m365-license-reset');
    expect(res.proposed.workspace).toBe(WORKSPACE);
    expect(res.proposed.content).toContain('# M365 License Reset');
    expect(res.proposed.alreadyExists).toBe(false);
    // No write side-effect.
    expect(existsSync(join(draftsDir(vault, WORKSPACE), 'm365-license-reset'))).toBe(false);
  });

  it('returns note-not-found for non-existent path', async () => {
    const res = (await dispatcher.invoke('notes.proposeAsSkill', {
      notePath: '/does/not/exist.md',
    })) as { ok: boolean; code?: string };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('note-not-found');
  });

  it('respects overrides.name + overrides.useWhen', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-x.md',
      body: '# Something\nbody',
    });
    const res = (await dispatcher.invoke('notes.proposeAsSkill', {
      notePath,
      overrides: { name: 'custom-name', useWhen: 'Wenn X benötigt wird' },
    })) as { ok: boolean; proposed: { name: string; content: string } };
    expect(res.proposed.name).toBe('custom-name');
    expect(res.proposed.content).toContain('description: Wenn X benötigt wird');
  });

  it('alreadyExists=true when a draft of same name already lives in _drafts/', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-existing.md',
      body: '# Existing Skill\nbody',
    });
    // Plant a pre-existing draft.
    const draftDir = join(draftsDir(vault, WORKSPACE), 'existing-skill');
    mkdirSync(draftDir, { recursive: true });
    writeFileSync(join(draftDir, 'SKILL.md'), '---\nname: existing-skill\n---\n\nold', 'utf8');

    const res = (await dispatcher.invoke('notes.proposeAsSkill', { notePath })) as {
      ok: boolean;
      proposed: { alreadyExists: boolean };
    };
    expect(res.proposed.alreadyExists).toBe(true);
  });
});

describe('notes.createSkillDraftFromNote', () => {
  it('writes the draft + emits audit-event', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-write-it.md',
      body: '# Write It\nbody',
    });
    const res = (await dispatcher.invoke('notes.createSkillDraftFromNote', {
      notePath,
      draftSpec: { useWhen: 'When needed' },
    })) as { ok: boolean; created: { name: string; path: string } };
    expect(res.ok).toBe(true);
    expect(res.created.name).toBe('write-it');
    expect(existsSync(res.created.path)).toBe(true);
    const content = readFileSync(res.created.path, 'utf8');
    expect(content).toContain('# Write It');
    expect(content).toContain('description: When needed');
  });

  it('refuses to overwrite existing draft', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-dup.md',
      body: '# Dup\nbody',
    });
    await dispatcher.invoke('notes.createSkillDraftFromNote', { notePath });
    const second = (await dispatcher.invoke('notes.createSkillDraftFromNote', { notePath })) as {
      ok: boolean;
      code?: string;
    };
    expect(second.ok).toBe(false);
    expect(second.code).toBe('draft-exists');
  });

  it('redacts customer PII when preserveCustomerData is not set', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-pii.md',
      body: '# Customer Reset\nContact alice@example.com — Kunde K12345',
      classification: 'customer-confidential',
    });
    const res = (await dispatcher.invoke('notes.createSkillDraftFromNote', { notePath })) as {
      ok: boolean;
      created: { path: string };
    };
    const content = readFileSync(res.created.path, 'utf8');
    expect(content).toContain('[REDACTED-email]');
    expect(content).toContain('[REDACTED-customer-id]');
    expect(content).toContain('Sensitive Klassifikation');
  });

  it('preserves PII when explicit opt-in', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-keep.md',
      body: '# Keep PII\nalice@example.com',
    });
    const res = (await dispatcher.invoke('notes.createSkillDraftFromNote', {
      notePath,
      draftSpec: { preserveCustomerData: true },
    })) as { ok: boolean; created: { path: string } };
    const content = readFileSync(res.created.path, 'utf8');
    expect(content).toContain('alice@example.com');
    expect(content).not.toContain('[REDACTED-email]');
  });

  it('note-not-found surfaced as envelope', async () => {
    const res = (await dispatcher.invoke('notes.createSkillDraftFromNote', {
      notePath: '/missing.md',
    })) as { ok: boolean; code?: string };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('note-not-found');
  });

  it('invalid-name envelope when override produces an illegal slug', async () => {
    const notePath = writeNote({
      filename: '2026-05-28-bad-name.md',
      body: '# X\nbody',
    });
    const res = (await dispatcher.invoke('notes.createSkillDraftFromNote', {
      notePath,
      draftSpec: { name: 'UPPER-CASE-INVALID' },
    })) as { ok: boolean; code?: string };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('invalid-name');
  });
});
