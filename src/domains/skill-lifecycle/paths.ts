/**
 * Skill-lifecycle on-disk paths.
 *
 * Layout (under each workspace):
 *   <vault>/Claude-OS/workspaces/<ws>/skills/_drafts/<name>/SKILL.md
 *   <vault>/Claude-OS/workspaces/<ws>/skills/_quarantined/<name>/SKILL.md
 *
 * The leading underscore means the Phase-4 `assertValidSkillName`
 * (`/^[a-z0-9][a-z0-9_-]*$/`) silently filters these buckets out of
 * the runtime skill-loader. Drafts and quarantined skills never get
 * picked up by `listSkills` accidentally — they require an explicit
 * lifecycle-aware reader.
 *
 * @module @domains/skill-lifecycle/paths
 */
import { join } from 'node:path';
import { resolveWorkspacePath, type WorkspaceId } from '../workspace/index.js';
import { SkillLifecycleError } from './types.js';

const SKILLS_SUBDIR = 'skills';
const DRAFTS_SUBDIR = '_drafts';
const QUARANTINED_SUBDIR = '_quarantined';

/**
 * Mirrors `domains/skills/paths.ts:skillsDir`. Inlined here so the
 * skill-lifecycle foundation stays buildable independently of the
 * Phase-4 skill-engine branch (the PR train merges both eventually
 * but neither needs the other's code at compile time).
 */
function skillsDir(vaultRoot: string, workspaceId: WorkspaceId): string {
  return join(resolveWorkspacePath(vaultRoot, workspaceId), SKILLS_SUBDIR);
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function assertValidDraftName(name: string): void {
  if (name.length === 0) throw new SkillLifecycleError(`draft name empty`);
  if (name.length > 128) throw new SkillLifecycleError(`draft name over 128 chars`);
  if (!NAME_PATTERN.test(name)) {
    throw new SkillLifecycleError(
      `draft name "${name}" must match /^[a-z0-9][a-z0-9_-]*$/ ` +
        '(lowercase, no spaces, no leading dash)',
    );
  }
}

export function draftsDir(vaultRoot: string, workspaceId: WorkspaceId): string {
  return join(skillsDir(vaultRoot, workspaceId), DRAFTS_SUBDIR);
}

export function quarantinedDir(vaultRoot: string, workspaceId: WorkspaceId): string {
  return join(skillsDir(vaultRoot, workspaceId), QUARANTINED_SUBDIR);
}

export function draftSkillFilePath(
  vaultRoot: string,
  workspaceId: WorkspaceId,
  draftName: string,
): string {
  assertValidDraftName(draftName);
  return join(draftsDir(vaultRoot, workspaceId), draftName, 'SKILL.md');
}
