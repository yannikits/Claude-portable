/**
 * Skill-lifecycle state-transitions (Phase 5c-1, ADR-0026 Gate 3).
 *
 * Centralises every promote-/demote-action so the CLI, the
 * sidecar-RPCs (Phase 5c-3) and the GUI (Phase 5c-4) all funnel
 * through the same FS-side-effects + audit-hooks. No callers
 * touch the SKILL.md files directly.
 *
 * State machine (per ADR-0026):
 *
 *   draft → quarantined → reviewed → active → deprecated → disabled
 *                                                        ↘ reactivate ↗
 *
 * Each transition is a pure async function with an injectable
 * AuditLogger so tests can verify the audit-entry shape without
 * touching the real append-only file.
 *
 * @module @domains/skill-lifecycle/promote
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AuditLogger } from '../../core/audit/index.js';
import { resolveWorkspacePath, type WorkspaceId } from '../workspace/index.js';
import { assertValidDraftName, draftsDir, quarantinedDir } from './paths.js';
import { runSkillInSandbox } from './sandbox/index.js';
import type { SandboxOpts, SandboxRunInput, SandboxRunResult } from './sandbox/types.js';
import { type SignedEnvelope, signPayload, verifyEnvelope } from './signing/index.js';
import { SkillLifecycleError, type SkillLifecycleState } from './types.js';

/** Error-codes match the spec in tasks/phase-5c-skill-promotion-gui.md §5c-1. */
export type PromoteErrorCode =
  | 'not-found'
  | 'wrong-state'
  | 'signature-invalid'
  | 'signature-mismatch-diff-hash'
  | 'audit-write-failed'
  | 'fs-failed';

export class PromoteError extends SkillLifecycleError {
  constructor(
    public readonly code: PromoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PromoteError';
  }
}

/** Common opts: workspace selector + audit-logger + clock. */
export interface PromoteOpts {
  readonly vaultRoot: string;
  readonly workspaceId: WorkspaceId;
  /** Audit-hook. When omitted, no audit-entry is written (useful for tests). */
  readonly audit?: AuditLogger;
  /** Time-source. Default: real wall-clock. */
  readonly now?: () => Date;
}

export interface PromoteResult {
  readonly name: string;
  readonly fromState: SkillLifecycleState;
  readonly toState: SkillLifecycleState;
  readonly path: string;
}

/**
 * Per-skill sandbox-run summary persisted on disk (`.sandbox-run.json`)
 * next to the quarantined skill so the GUI can render it alongside
 * the diff without re-running.
 */
export interface SandboxRunSummary {
  readonly skillName: string;
  readonly runAtIso: string;
  readonly durationMs: number;
  readonly outcome: 'ok' | 'error' | 'timeout';
  /** Serialized skill output (`SandboxRunOk.output`) — null on non-ok. */
  readonly output: unknown;
  /** Reason for hard-kill — null on ok. */
  readonly killedBy: 'timeout' | 'crash' | 'spawn-failure' | 'invalid-path' | null;
  /** Error message from `SandboxRunError` — null on ok/timeout. */
  readonly errorMessage: string | null;
}

/**
 * Payload signed by Yannik in the GUI-Approval (Phase 5c-5). The
 * audit-log stores the full SignedEnvelope.
 */
export interface ReviewApprovalPayload {
  readonly skillId: string;
  readonly diffHash: string;
  readonly classification: string;
  readonly reviewedAtIso: string;
}

/**
 * What the GUI sees BEFORE Yannik approves. Read + prep, no FS move.
 */
export interface ReviewProposal {
  readonly name: string;
  readonly classification: string;
  /** Active version on disk (empty when promoting a brand-new skill). */
  readonly beforeContent: string;
  /** Quarantined version being proposed. */
  readonly afterContent: string;
  /**
   * SHA-256 over the canonical JSON of `{beforeContent, afterContent,
   * classification}` — bound into the SignedEnvelope so a tamper
   * post-approve invalidates the signature.
   */
  readonly diffHash: string;
  readonly sandboxRunSummary: SandboxRunSummary | null;
}

// ─── path helpers ──────────────────────────────────────────────────

const SKILLS_SUBDIR = 'skills';
const SANDBOX_RUN_FILE = '.sandbox-run.json';

function skillDir(vaultRoot: string, workspaceId: WorkspaceId, name: string): string {
  return join(resolveWorkspacePath(vaultRoot, workspaceId), SKILLS_SUBDIR, name);
}

function activeSkillFilePath(vaultRoot: string, workspaceId: WorkspaceId, name: string): string {
  return join(skillDir(vaultRoot, workspaceId, name), 'SKILL.md');
}

function draftSkillDir(vaultRoot: string, workspaceId: WorkspaceId, name: string): string {
  return join(draftsDir(vaultRoot, workspaceId), name);
}

function quarantinedSkillDir(vaultRoot: string, workspaceId: WorkspaceId, name: string): string {
  return join(quarantinedDir(vaultRoot, workspaceId), name);
}

function sandboxRunFile(quarantinedDirPath: string): string {
  return join(quarantinedDirPath, SANDBOX_RUN_FILE);
}

// ─── frontmatter helpers ───────────────────────────────────────────

/**
 * Replace the `state: <value>` line in the SKILL.md frontmatter.
 * Falls back to a no-op when the field is missing (caller is expected
 * to keep the frontmatter shape — the draft-generator emits it).
 */
function setFrontmatterState(content: string, newState: SkillLifecycleState): string {
  return content.replace(/^state:\s*[a-z-]+\s*$/m, `state: ${newState}`);
}

function readFrontmatterField(content: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm');
  const m = content.match(re);
  return m === null ? null : (m[1] ?? null);
}

// ─── diff helpers ──────────────────────────────────────────────────

/**
 * Canonical JSON: sort keys recursively so the same payload always
 * stringifies to the same bytes (matches signing/canonicalizeJson
 * but keeps promote-side self-contained — only used for the
 * diff-hash, not for the signed payload which already canonicalises).
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
    return Object.keys(val as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (val as Record<string, unknown>)[k];
        return acc;
      }, {});
  });
}

function computeDiffHash(
  beforeContent: string,
  afterContent: string,
  classification: string,
): string {
  return createHash('sha256')
    .update(canonicalJson({ beforeContent, afterContent, classification }), 'utf8')
    .digest('hex');
}

// ─── FS helpers ────────────────────────────────────────────────────

function moveDir(src: string, dst: string): void {
  mkdirSync(join(dst, '..'), { recursive: true });
  try {
    renameSync(src, dst);
  } catch (err) {
    // rename across mount-points fails with EXDEV — fall back to
    // copy+rm. The tmp-vault in tests sometimes lives on a tmpfs
    // while the test runner sits on the main FS.
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      cpSync(src, dst, { recursive: true });
      rmSync(src, { recursive: true, force: true });
    } else {
      throw new PromoteError('fs-failed', `move ${src} → ${dst}: ${(err as Error).message}`);
    }
  }
}

function readSkillContent(skillMdPath: string): string {
  if (!existsSync(skillMdPath)) {
    throw new PromoteError('not-found', `SKILL.md not found at "${skillMdPath}"`);
  }
  return readFileSync(skillMdPath, 'utf8');
}

function writeSkillContent(skillMdPath: string, content: string): void {
  mkdirSync(join(skillMdPath, '..'), { recursive: true });
  writeFileSync(skillMdPath, content, 'utf8');
}

function safeAuditAppend(
  audit: AuditLogger | undefined,
  input: Parameters<AuditLogger['append']>[0],
): void {
  if (audit === undefined) return;
  try {
    audit.append(input);
  } catch (err) {
    throw new PromoteError(
      'audit-write-failed',
      `audit append failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── transitions ───────────────────────────────────────────────────

/**
 * Move `_drafts/<name>/` → `_quarantined/<name>/` and stamp
 * `state: quarantined` in the frontmatter. No sandbox-run yet.
 */
export async function promoteDraftToQuarantined(
  name: string,
  opts: PromoteOpts,
): Promise<PromoteResult> {
  assertValidDraftName(name);
  const draftDir = draftSkillDir(opts.vaultRoot, opts.workspaceId, name);
  const draftFile = join(draftDir, 'SKILL.md');
  const targetDir = quarantinedSkillDir(opts.vaultRoot, opts.workspaceId, name);
  const targetFile = join(targetDir, 'SKILL.md');

  const content = readSkillContent(draftFile);
  // FS-move BEFORE frontmatter rewrite — the move is atomic per-dir,
  // the rewrite is idempotent so retry-after-crash works.
  moveDir(draftDir, targetDir);
  writeSkillContent(targetFile, setFrontmatterState(content, 'quarantined'));

  safeAuditAppend(opts.audit, {
    kind: 'skill.promote',
    action: 'draft-to-quarantined',
    workspace: opts.workspaceId,
    outcome: 'ok',
    details: { skillName: name },
  });

  return { name, fromState: 'draft', toState: 'quarantined', path: targetDir };
}

/**
 * Run the quarantined skill in a sandboxed child_process.fork
 * (Phase-5b infrastructure) and persist the summary as
 * `<quarantinedDir>/<name>/.sandbox-run.json` so the GUI can show
 * it next to the diff.
 */
export async function runQuarantinedSandbox(
  name: string,
  opts: PromoteOpts & {
    readonly input: SandboxRunInput;
    readonly sandboxOpts: SandboxOpts;
  },
): Promise<SandboxRunSummary> {
  assertValidDraftName(name);
  const qDir = quarantinedSkillDir(opts.vaultRoot, opts.workspaceId, name);
  if (!existsSync(qDir)) {
    throw new PromoteError('not-found', `quarantined skill "${name}" not found`);
  }

  const startedAt = Date.now();
  const result = await runSkillInSandbox(opts.input, opts.sandboxOpts);
  const summary = buildSandboxSummary(name, result, Date.now() - startedAt, opts.now);
  writeSkillContent(sandboxRunFile(qDir), `${JSON.stringify(summary, null, 2)}\n`);

  safeAuditAppend(opts.audit, {
    kind: 'skill.invoke',
    action: 'sandbox-run',
    workspace: opts.workspaceId,
    outcome: summary.outcome === 'ok' ? 'ok' : 'error',
    details: {
      skillName: name,
      durationMs: summary.durationMs,
      outcome: summary.outcome,
      killedBy: summary.killedBy,
    },
  });
  return summary;
}

function buildSandboxSummary(
  skillName: string,
  result: SandboxRunResult,
  _measuredDurationMs: number,
  nowFn?: () => Date,
): SandboxRunSummary {
  const now = nowFn ?? ((): Date => new Date());
  const at = now().toISOString();

  if (result.status === 'ok') {
    return {
      skillName,
      runAtIso: at,
      durationMs: result.durationMs,
      outcome: 'ok',
      output: result.output,
      killedBy: null,
      errorMessage: null,
    };
  }
  if (result.status === 'timeout') {
    return {
      skillName,
      runAtIso: at,
      durationMs: result.durationMs,
      outcome: 'timeout',
      output: null,
      killedBy: 'timeout',
      errorMessage: null,
    };
  }
  return {
    skillName,
    runAtIso: at,
    durationMs: result.durationMs,
    outcome: 'error',
    output: null,
    killedBy: result.killedBy,
    errorMessage: result.errorMessage,
  };
}

/**
 * Read the quarantined skill + any existing active version, compute
 * the diff-hash. No FS-move. The GUI calls this to render the
 * approval-modal.
 */
export async function proposeReview(name: string, opts: PromoteOpts): Promise<ReviewProposal> {
  assertValidDraftName(name);
  const qDir = quarantinedSkillDir(opts.vaultRoot, opts.workspaceId, name);
  const qFile = join(qDir, 'SKILL.md');
  if (!existsSync(qFile)) {
    throw new PromoteError('not-found', `quarantined skill "${name}" not found`);
  }
  const afterContent = readFileSync(qFile, 'utf8');
  const classification = readFrontmatterField(afterContent, 'classification') ?? 'personal';

  const activeFile = activeSkillFilePath(opts.vaultRoot, opts.workspaceId, name);
  const beforeContent = existsSync(activeFile) ? readFileSync(activeFile, 'utf8') : '';

  const diffHash = computeDiffHash(beforeContent, afterContent, classification);

  // Optional sandbox-run summary alongside.
  let sandboxRunSummary: SandboxRunSummary | null = null;
  const runFile = sandboxRunFile(qDir);
  if (existsSync(runFile)) {
    try {
      sandboxRunSummary = JSON.parse(readFileSync(runFile, 'utf8')) as SandboxRunSummary;
    } catch {
      sandboxRunSummary = null;
    }
  }

  return { name, classification, beforeContent, afterContent, diffHash, sandboxRunSummary };
}

/**
 * Verify the envelope, write an audit entry, then move
 * `_quarantined/<name>/` → `skills/<name>/` with `state: active`.
 * Rolls back the FS-move if the audit-write fails.
 */
export async function approveReview(
  name: string,
  envelope: SignedEnvelope<ReviewApprovalPayload>,
  opts: PromoteOpts & { readonly expectedPublicKeyB64?: string },
): Promise<PromoteResult> {
  assertValidDraftName(name);
  let verified = false;
  try {
    verified = verifyEnvelope(envelope, {
      ...(opts.expectedPublicKeyB64 !== undefined
        ? { expectedPublicKeyB64: opts.expectedPublicKeyB64 }
        : {}),
    });
  } catch (err) {
    throw new PromoteError('signature-invalid', `verifyEnvelope threw: ${(err as Error).message}`);
  }
  if (!verified) {
    throw new PromoteError('signature-invalid', `envelope signature did not verify`);
  }

  // Bind envelope to current quarantined content via diffHash.
  const proposal = await proposeReview(name, opts);
  if (envelope.payload.diffHash !== proposal.diffHash) {
    throw new PromoteError(
      'signature-mismatch-diff-hash',
      `envelope.payload.diffHash (${envelope.payload.diffHash.slice(0, 8)}…) does not match current diffHash (${proposal.diffHash.slice(0, 8)}…) — the skill changed after the user signed it`,
    );
  }
  if (envelope.payload.skillId !== name) {
    throw new PromoteError(
      'signature-mismatch-diff-hash',
      `envelope.payload.skillId "${envelope.payload.skillId}" does not match request "${name}"`,
    );
  }

  // Audit FIRST — if the audit-store rejects (disk full, permission),
  // we don't want a half-moved skill on disk.
  safeAuditAppend(opts.audit, {
    kind: 'skill.promote',
    action: 'review-approved',
    workspace: opts.workspaceId,
    outcome: 'ok',
    details: {
      skillName: name,
      diffHash: proposal.diffHash,
      classification: proposal.classification,
      signedAt: envelope.signedAt,
      publicKeyB64: envelope.publicKeyB64,
    },
  });

  const qDir = quarantinedSkillDir(opts.vaultRoot, opts.workspaceId, name);
  const targetDir = skillDir(opts.vaultRoot, opts.workspaceId, name);
  const targetFile = join(targetDir, 'SKILL.md');

  // If an older active version exists, snapshot it as a *.prev sibling
  // so a rollback is trivially copy-back.
  if (existsSync(targetDir)) {
    const backupDir = `${targetDir}.prev-${Date.now()}`;
    moveDir(targetDir, backupDir);
  }

  moveDir(qDir, targetDir);
  writeSkillContent(targetFile, setFrontmatterState(proposal.afterContent, 'active'));

  return { name, fromState: 'quarantined', toState: 'active', path: targetDir };
}

/** Helper for callers: build the canonical payload + sign it. */
export function buildAndSignApproval(
  name: string,
  proposal: ReviewProposal,
  privateKeyB64: string,
  publicKeyB64: string,
  opts: { now?: () => Date } = {},
): SignedEnvelope<ReviewApprovalPayload> {
  const now = opts.now ?? ((): Date => new Date());
  const payload: ReviewApprovalPayload = {
    skillId: name,
    diffHash: proposal.diffHash,
    classification: proposal.classification,
    reviewedAtIso: now().toISOString(),
  };
  return signPayload(payload, privateKeyB64, publicKeyB64, { now });
}

// ─── deprecate / disable / reactivate ───────────────────────────────

async function flipActiveState(
  name: string,
  newState: SkillLifecycleState,
  expectedCurrentStates: readonly SkillLifecycleState[],
  action: string,
  opts: PromoteOpts,
): Promise<PromoteResult> {
  assertValidDraftName(name);
  const filePath = activeSkillFilePath(opts.vaultRoot, opts.workspaceId, name);
  if (!existsSync(filePath)) {
    throw new PromoteError('not-found', `active skill "${name}" not found`);
  }
  const content = readSkillContent(filePath);
  const currentState = (readFrontmatterField(content, 'state') ?? 'active') as SkillLifecycleState;
  if (!expectedCurrentStates.includes(currentState)) {
    throw new PromoteError(
      'wrong-state',
      `cannot ${action} skill "${name}" from state "${currentState}" (expected one of ${expectedCurrentStates.join('|')})`,
    );
  }
  writeSkillContent(filePath, setFrontmatterState(content, newState));
  safeAuditAppend(opts.audit, {
    kind: 'skill.promote',
    action,
    workspace: opts.workspaceId,
    outcome: 'ok',
    details: { skillName: name, fromState: currentState, toState: newState },
  });
  return {
    name,
    fromState: currentState,
    toState: newState,
    path: filePath,
  };
}

/** Mark an active skill as deprecated (still loadable, surfaces a warning). */
export async function deprecateSkill(name: string, opts: PromoteOpts): Promise<PromoteResult> {
  return flipActiveState(name, 'deprecated', ['active'], 'deprecate', opts);
}

/** Mark a deprecated or active skill as disabled (no longer loaded). */
export async function disableSkill(name: string, opts: PromoteOpts): Promise<PromoteResult> {
  return flipActiveState(name, 'disabled', ['active', 'deprecated'], 'disable', opts);
}

/** Bring a deprecated or disabled skill back to active. */
export async function reactivateSkill(name: string, opts: PromoteOpts): Promise<PromoteResult> {
  return flipActiveState(name, 'active', ['deprecated', 'disabled'], 'reactivate', opts);
}

/** Exported for tests + the CLI summary commands. */
export { computeDiffHash, setFrontmatterState };
