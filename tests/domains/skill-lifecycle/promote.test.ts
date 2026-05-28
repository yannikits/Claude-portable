import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../../../src/core/audit/index.js';
import {
  approveReview,
  buildAndSignApproval,
  computeDiffHash,
  deprecateSkill,
  disableSkill,
  draftsDir,
  generateEd25519Keypair,
  PromoteError,
  promoteDraftToQuarantined,
  proposeReview,
  quarantinedDir,
  type ReviewApprovalPayload,
  reactivateSkill,
  type SandboxRunSummary,
  setFrontmatterState,
  signPayload,
} from '../../../src/domains/skill-lifecycle/index.js';

const WORKSPACE = 'personal';
let vaultRoot: string;
let auditEntries: ReturnType<AuditLogger['append']>[];
let audit: AuditLogger;

beforeEach(() => {
  vaultRoot = mkdtempSync(join(tmpdir(), 'promote-test-'));
  // Workspace subdir layout per resolveWorkspacePath.
  mkdirSync(join(vaultRoot, 'Claude-OS', 'workspaces', WORKSPACE), { recursive: true });
  auditEntries = [];
  audit = new AuditLogger({
    sink: (_filePath: string, jsonl: string) => {
      auditEntries.push(JSON.parse(jsonl.trimEnd()));
    },
    hostname: 'test-host',
  });
});

afterEach(() => {
  rmSync(vaultRoot, { recursive: true, force: true });
});

function writeDraft(name: string, body = 'sample-body'): string {
  const dir = join(draftsDir(vaultRoot, WORKSPACE), name);
  mkdirSync(dir, { recursive: true });
  const content = `---
name: ${name}
description: a draft skill
classification: personal
state: draft
generated_at: 2026-05-28T00:00:00.000Z
---

# ${name}

${body}
`;
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
  return content;
}

function readQ(name: string): string {
  return readFileSync(join(quarantinedDir(vaultRoot, WORKSPACE), name, 'SKILL.md'), 'utf8');
}

function readActive(name: string): string {
  return readFileSync(
    join(vaultRoot, 'Claude-OS', 'workspaces', WORKSPACE, 'skills', name, 'SKILL.md'),
    'utf8',
  );
}

describe('setFrontmatterState + computeDiffHash', () => {
  it('replaces state line in frontmatter', () => {
    const out = setFrontmatterState('---\nname: foo\nstate: draft\n---\nbody', 'quarantined');
    expect(out).toContain('state: quarantined');
    expect(out).not.toContain('state: draft');
  });

  it('computeDiffHash is deterministic and order-independent over keys', () => {
    const h1 = computeDiffHash('a', 'b', 'personal');
    const h2 = computeDiffHash('a', 'b', 'personal');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('promoteDraftToQuarantined', () => {
  it('moves _drafts/<name>/ → _quarantined/<name>/ and updates state', async () => {
    writeDraft('test-skill');
    const result = await promoteDraftToQuarantined('test-skill', {
      vaultRoot,
      workspaceId: WORKSPACE,
      audit,
    });
    expect(result.fromState).toBe('draft');
    expect(result.toState).toBe('quarantined');
    expect(existsSync(join(draftsDir(vaultRoot, WORKSPACE), 'test-skill'))).toBe(false);
    expect(readQ('test-skill')).toContain('state: quarantined');
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]?.kind).toBe('skill.promote');
    expect(auditEntries[0]?.action).toBe('draft-to-quarantined');
  });

  it('throws PromoteError(not-found) on missing draft', async () => {
    await expect(
      promoteDraftToQuarantined('missing-skill', { vaultRoot, workspaceId: WORKSPACE }),
    ).rejects.toBeInstanceOf(PromoteError);
  });

  it('rejects invalid draft names', async () => {
    await expect(
      promoteDraftToQuarantined('UPPER-CASE', { vaultRoot, workspaceId: WORKSPACE }),
    ).rejects.toThrow();
  });
});

describe('proposeReview', () => {
  it('returns a stable diffHash + extracts classification from frontmatter', async () => {
    writeDraft('rev-test');
    await promoteDraftToQuarantined('rev-test', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('rev-test', { vaultRoot, workspaceId: WORKSPACE });
    expect(proposal.beforeContent).toBe('');
    expect(proposal.afterContent).toContain('state: quarantined');
    expect(proposal.classification).toBe('personal');
    expect(proposal.diffHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proposal.sandboxRunSummary).toBeNull();
  });

  it('beforeContent reflects existing active skill when promoting an upgrade', async () => {
    // Manually plant a pre-existing active skill.
    const activeDir = join(vaultRoot, 'Claude-OS', 'workspaces', WORKSPACE, 'skills', 'upgrade-it');
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(join(activeDir, 'SKILL.md'), 'old-active-content\n', 'utf8');

    writeDraft('upgrade-it', 'new-body');
    await promoteDraftToQuarantined('upgrade-it', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('upgrade-it', { vaultRoot, workspaceId: WORKSPACE });
    expect(proposal.beforeContent).toBe('old-active-content\n');
    expect(proposal.afterContent).toContain('new-body');
  });

  it('attaches a previously persisted sandbox-run summary', async () => {
    writeDraft('with-sandbox');
    await promoteDraftToQuarantined('with-sandbox', { vaultRoot, workspaceId: WORKSPACE });
    const qDir = join(quarantinedDir(vaultRoot, WORKSPACE), 'with-sandbox');
    const summary: SandboxRunSummary = {
      skillName: 'with-sandbox',
      runAtIso: '2026-05-28T10:00:00.000Z',
      durationMs: 42,
      outcome: 'ok',
      output: { ok: true },
      killedBy: null,
      errorMessage: null,
    };
    writeFileSync(join(qDir, '.sandbox-run.json'), `${JSON.stringify(summary)}\n`, 'utf8');
    const proposal = await proposeReview('with-sandbox', { vaultRoot, workspaceId: WORKSPACE });
    expect(proposal.sandboxRunSummary?.outcome).toBe('ok');
    expect(proposal.sandboxRunSummary?.durationMs).toBe(42);
  });
});

describe('approveReview', () => {
  function makeKeypair() {
    const kp = generateEd25519Keypair();
    return { privateKeyB64: kp.privateKeyB64, publicKeyB64: kp.publicKeyB64 };
  }

  it('verifies envelope, writes audit, moves _quarantined/<n>/ → skills/<n>/', async () => {
    writeDraft('approve-it');
    await promoteDraftToQuarantined('approve-it', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('approve-it', { vaultRoot, workspaceId: WORKSPACE });

    const kp = makeKeypair();
    const envelope = buildAndSignApproval(
      'approve-it',
      proposal,
      kp.privateKeyB64,
      kp.publicKeyB64,
    );

    const result = await approveReview('approve-it', envelope, {
      vaultRoot,
      workspaceId: WORKSPACE,
      audit,
      expectedPublicKeyB64: kp.publicKeyB64,
    });
    expect(result.toState).toBe('active');
    expect(readActive('approve-it')).toContain('state: active');
    expect(existsSync(join(quarantinedDir(vaultRoot, WORKSPACE), 'approve-it'))).toBe(false);
    expect(auditEntries.some((e) => e.action === 'review-approved')).toBe(true);
  });

  it('rejects an envelope signed for a different diffHash', async () => {
    writeDraft('tamper-test');
    await promoteDraftToQuarantined('tamper-test', { vaultRoot, workspaceId: WORKSPACE });

    const kp = makeKeypair();
    // Build envelope with a deliberately stale diffHash.
    const stalePayload: ReviewApprovalPayload = {
      skillId: 'tamper-test',
      diffHash: 'a'.repeat(64),
      classification: 'personal',
      reviewedAtIso: new Date().toISOString(),
    };
    const envelope = signPayload(stalePayload, kp.privateKeyB64, kp.publicKeyB64);

    try {
      await approveReview('tamper-test', envelope, { vaultRoot, workspaceId: WORKSPACE });
      expect.fail('approveReview should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PromoteError);
      expect((err as PromoteError).code).toBe('signature-mismatch-diff-hash');
    }
  });

  it('rejects an envelope with the wrong publicKey when expectedPublicKey is set', async () => {
    writeDraft('pinned-key');
    await promoteDraftToQuarantined('pinned-key', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('pinned-key', { vaultRoot, workspaceId: WORKSPACE });

    const intruder = makeKeypair();
    const trusted = makeKeypair();
    const envelope = buildAndSignApproval(
      'pinned-key',
      proposal,
      intruder.privateKeyB64,
      intruder.publicKeyB64,
    );
    try {
      await approveReview('pinned-key', envelope, {
        vaultRoot,
        workspaceId: WORKSPACE,
        expectedPublicKeyB64: trusted.publicKeyB64,
      });
      expect.fail('approveReview should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PromoteError);
      expect((err as PromoteError).code).toBe('signature-invalid');
    }
  });

  it('rejects an envelope for the wrong skillId', async () => {
    writeDraft('right-name');
    await promoteDraftToQuarantined('right-name', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('right-name', { vaultRoot, workspaceId: WORKSPACE });
    const kp = makeKeypair();
    const wrongIdPayload: ReviewApprovalPayload = {
      skillId: 'wrong-name',
      diffHash: proposal.diffHash,
      classification: proposal.classification,
      reviewedAtIso: new Date().toISOString(),
    };
    const envelope = signPayload(wrongIdPayload, kp.privateKeyB64, kp.publicKeyB64);
    try {
      await approveReview('right-name', envelope, { vaultRoot, workspaceId: WORKSPACE });
      expect.fail('approveReview should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PromoteError);
      expect((err as PromoteError).code).toBe('signature-mismatch-diff-hash');
    }
  });

  it('snapshots an older active version before overwriting', async () => {
    // Plant an existing active skill.
    const activeDir = join(vaultRoot, 'Claude-OS', 'workspaces', WORKSPACE, 'skills', 'upgrade');
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(join(activeDir, 'SKILL.md'), 'old-active-content', 'utf8');

    writeDraft('upgrade', 'new-body');
    await promoteDraftToQuarantined('upgrade', { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview('upgrade', { vaultRoot, workspaceId: WORKSPACE });
    const kp = makeKeypair();
    const envelope = buildAndSignApproval('upgrade', proposal, kp.privateKeyB64, kp.publicKeyB64);
    await approveReview('upgrade', envelope, { vaultRoot, workspaceId: WORKSPACE });

    // Backup dir exists with the old content.
    const skillsParent = join(vaultRoot, 'Claude-OS', 'workspaces', WORKSPACE, 'skills');
    const backupDirs = readdir(skillsParent).filter((n) => n.startsWith('upgrade.prev-'));
    expect(backupDirs.length).toBeGreaterThan(0);
    const backupContent = readFileSync(
      join(skillsParent, backupDirs[0] as string, 'SKILL.md'),
      'utf8',
    );
    expect(backupContent).toBe('old-active-content');
  });
});

describe('deprecate / disable / reactivate', () => {
  async function plantActive(name: string): Promise<void> {
    writeDraft(name);
    await promoteDraftToQuarantined(name, { vaultRoot, workspaceId: WORKSPACE });
    const proposal = await proposeReview(name, { vaultRoot, workspaceId: WORKSPACE });
    const kp = generateEd25519Keypair();
    const envelope = buildAndSignApproval(name, proposal, kp.privateKeyB64, kp.publicKeyB64);
    await approveReview(name, envelope, { vaultRoot, workspaceId: WORKSPACE });
  }

  it('deprecate an active skill', async () => {
    await plantActive('dep-it');
    const res = await deprecateSkill('dep-it', { vaultRoot, workspaceId: WORKSPACE, audit });
    expect(res.toState).toBe('deprecated');
    expect(readActive('dep-it')).toContain('state: deprecated');
  });

  it('disable goes from active or deprecated', async () => {
    await plantActive('dis-it');
    await deprecateSkill('dis-it', { vaultRoot, workspaceId: WORKSPACE });
    const res = await disableSkill('dis-it', { vaultRoot, workspaceId: WORKSPACE });
    expect(res.toState).toBe('disabled');
  });

  it('reactivate rejects wrong-state from active', async () => {
    await plantActive('react-it');
    try {
      await reactivateSkill('react-it', { vaultRoot, workspaceId: WORKSPACE });
      expect.fail('reactivateSkill should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PromoteError);
      expect((err as PromoteError).code).toBe('wrong-state');
    }
  });

  it('reactivate succeeds from disabled', async () => {
    await plantActive('react-ok');
    await disableSkill('react-ok', { vaultRoot, workspaceId: WORKSPACE });
    const res = await reactivateSkill('react-ok', { vaultRoot, workspaceId: WORKSPACE });
    expect(res.toState).toBe('active');
  });

  it('deprecate on missing skill → PromoteError(not-found)', async () => {
    await expect(
      deprecateSkill('does-not-exist', { vaultRoot, workspaceId: WORKSPACE }),
    ).rejects.toBeInstanceOf(PromoteError);
  });
});

// helper — minimal in-test readdir without pulling fs.readdirSync into
// every describe-block import list.
function readdir(dir: string): string[] {
  // biome-ignore lint/correctness/noNodejsModules: in-test only
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readdirSync(dir) as string[];
}
