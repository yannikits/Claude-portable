/**
 * MSP-E Note-to-Skill RPCs (Phase MSP-E-2).
 *
 * Two endpoints — proposal-first to avoid double-writes:
 *
 *   notes.proposeAsSkill({notePath, overrides?})
 *     → preview-only. Reads the note, generates the candidate
 *       DraftSkill content + name + classification. NO FS write.
 *
 *   notes.createSkillDraftFromNote({notePath, draftSpec})
 *     → writes <vault>/.../skills/_drafts/<name>/SKILL.md.
 *       Refuses to overwrite an existing draft of the same name
 *       (UnknownErrorEnvelope `code: 'draft-exists'`).
 *
 * Audit-event on real write: `note.write` (with `action:
 * 'note-to-skill-draft'`). The skill-promote pipeline (Phase 5c)
 * handles the rest of the lifecycle.
 *
 * @module @sidecar/methods/notes-to-skill
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLogger } from '../../core/audit/index.js';
import { readNote } from '../../domains/notes/index.js';
import {
  assertValidDraftName,
  draftSkillFilePath,
  draftsDir,
  type NoteDraftOpts,
  noteToDraftSkill,
} from '../../domains/skill-lifecycle/index.js';
import { resolveVaultRoot } from '../../domains/workspace/index.js';
import type { RpcDispatcher } from '../rpc.js';
import { type MethodsContext, requireString } from './_shared.js';

interface ProposeParams {
  readonly notePath?: unknown;
  readonly overrides?: unknown;
}

interface CreateParams {
  readonly notePath?: unknown;
  readonly draftSpec?: unknown;
}

interface DraftSpec {
  readonly name?: string;
  readonly useWhen?: string;
  readonly preserveCustomerData?: boolean;
  readonly workspace?: string;
}

function parseOverrides(raw: unknown): NoteDraftOpts {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('overrides muss ein Object sein');
  }
  const r = raw as Record<string, unknown>;
  return {
    ...(typeof r.name === 'string' ? { name: r.name } : {}),
    ...(typeof r.useWhen === 'string' ? { useWhen: r.useWhen } : {}),
    ...(typeof r.preserveCustomerData === 'boolean'
      ? { preserveCustomerData: r.preserveCustomerData }
      : {}),
    ...(typeof r.workspace === 'string' ? { workspace: r.workspace } : {}),
  };
}

export function registerNotesToSkillMethods(dispatcher: RpcDispatcher, ctx: MethodsContext): void {
  const makeAudit = (): AuditLogger =>
    new AuditLogger({ auditDir: join(ctx.machinePaths().dataDir, 'audit') });

  // ─── notes.proposeAsSkill ─────────────────────────────────────────
  dispatcher.register('notes.proposeAsSkill', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as ProposeParams;
    const notePath = requireString(params.notePath, 'notePath', 'notes.proposeAsSkill');
    if (!existsSync(notePath)) {
      return {
        ok: false as const,
        code: 'note-not-found' as const,
        message: `note not found: ${notePath}`,
      };
    }
    let overrides: NoteDraftOpts;
    try {
      overrides = parseOverrides(params.overrides);
    } catch (err) {
      throw new Error(`notes.proposeAsSkill: ${err instanceof Error ? err.message : String(err)}`);
    }

    const note = readNote(notePath);
    const draft = noteToDraftSkill(note, overrides);

    // Where it WOULD be written (caller picks workspace).
    const targetWorkspace = overrides.workspace ?? note.workspace;
    const targetPath = draftSkillFilePath(resolveVaultRoot(), targetWorkspace, draft.name);
    return {
      ok: true as const,
      proposed: {
        name: draft.name,
        workspace: targetWorkspace,
        classification: note.frontmatter.classification,
        content: draft.content,
        targetPath,
        alreadyExists: existsSync(targetPath),
      },
    };
  });

  // ─── notes.createSkillDraftFromNote ───────────────────────────────
  dispatcher.register('notes.createSkillDraftFromNote', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as CreateParams;
    const notePath = requireString(params.notePath, 'notePath', 'notes.createSkillDraftFromNote');
    if (!existsSync(notePath)) {
      return {
        ok: false as const,
        code: 'note-not-found' as const,
        message: `note not found: ${notePath}`,
      };
    }
    const draftSpec: DraftSpec = (params.draftSpec ?? {}) as DraftSpec;
    if (typeof draftSpec !== 'object' || Array.isArray(draftSpec)) {
      throw new Error('notes.createSkillDraftFromNote: draftSpec muss ein Object sein');
    }
    const overrides: NoteDraftOpts = {
      ...(typeof draftSpec.name === 'string' ? { name: draftSpec.name } : {}),
      ...(typeof draftSpec.useWhen === 'string' ? { useWhen: draftSpec.useWhen } : {}),
      ...(typeof draftSpec.preserveCustomerData === 'boolean'
        ? { preserveCustomerData: draftSpec.preserveCustomerData }
        : {}),
      ...(typeof draftSpec.workspace === 'string' ? { workspace: draftSpec.workspace } : {}),
    };

    const note = readNote(notePath);
    const draft = noteToDraftSkill(note, overrides);
    try {
      assertValidDraftName(draft.name);
    } catch (err) {
      return {
        ok: false as const,
        code: 'invalid-name' as const,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const vault = resolveVaultRoot();
    const targetWorkspace = overrides.workspace ?? note.workspace;
    const targetDir = join(draftsDir(vault, targetWorkspace), draft.name);
    const targetFile = join(targetDir, 'SKILL.md');
    if (existsSync(targetFile)) {
      return {
        ok: false as const,
        code: 'draft-exists' as const,
        message: `draft "${draft.name}" already exists at ${targetFile}`,
      };
    }

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetFile, draft.content, 'utf8');

    makeAudit().append({
      kind: 'note.write',
      action: 'note-to-skill-draft',
      workspace: targetWorkspace,
      outcome: 'ok',
      details: {
        sourceNotePath: notePath,
        targetDraftPath: targetFile,
        draftName: draft.name,
        classification: note.frontmatter.classification,
        redactionApplied: overrides.preserveCustomerData !== true,
      },
    });

    return {
      ok: true as const,
      created: { name: draft.name, workspace: targetWorkspace, path: targetFile },
    };
  });
}
