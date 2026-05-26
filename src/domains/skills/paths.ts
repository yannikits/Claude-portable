/**
 * Workspace-scoped skill paths (Phase 4).
 *
 * Layout:
 *   <vault>/Claude-OS/workspaces/<workspaceId>/skills/<skillName>/SKILL.md
 *
 * Skill names follow the same conservative rules as workspace customer-
 * ids: `/^[a-z0-9][a-z0-9_-]*$/`. Cross-platform-safe, no spaces,
 * no traversal, no leading dot.
 *
 * @module @domains/skills/paths
 */
import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveWorkspacePath, type WorkspaceId } from '../workspace/index.js';
import { InvalidSkillNameError } from './types.js';

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SKILLS_SUBDIR = 'skills';
const SKILL_FILE = 'SKILL.md';

export function assertValidSkillName(name: string): void {
  if (name.length === 0) {
    throw new InvalidSkillNameError(name, 'empty');
  }
  if (name.length > 128) {
    throw new InvalidSkillNameError(name, 'over 128 chars');
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new InvalidSkillNameError(
      name,
      'must match /^[a-z0-9][a-z0-9_-]*$/ (lowercase, no spaces, no leading dash)',
    );
  }
}

/** Returns `<vault>/Claude-OS/workspaces/<workspaceId>/skills/`. */
export function skillsDir(vaultRoot: string, workspaceId: WorkspaceId): string {
  return join(resolveWorkspacePath(vaultRoot, workspaceId), SKILLS_SUBDIR);
}

/** Returns the absolute path to a specific skill directory. */
export function skillDir(vaultRoot: string, workspaceId: WorkspaceId, skillName: string): string {
  assertValidSkillName(skillName);
  return join(skillsDir(vaultRoot, workspaceId), skillName);
}

/** Returns the absolute path to a skill's SKILL.md file. */
export function skillFilePath(
  vaultRoot: string,
  workspaceId: WorkspaceId,
  skillName: string,
): string {
  return join(skillDir(vaultRoot, workspaceId, skillName), SKILL_FILE);
}

/**
 * Lists every skill directory under the workspace that has a valid
 * name AND contains a SKILL.md file. Silently skips entries with
 * invalid names (Windows-reserved, dotfiles, uppercase, ...).
 */
export function listSkillDirs(
  vaultRoot: string,
  workspaceId: WorkspaceId,
): { name: string; dir: string; skillFile: string }[] {
  const root = skillsDir(vaultRoot, workspaceId);
  if (!existsSync(root)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' }) as Dirent[];
  } catch {
    return [];
  }
  const out: { name: string; dir: string; skillFile: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      assertValidSkillName(entry.name);
    } catch {
      continue;
    }
    const dir = join(root, entry.name);
    const skillFile = join(dir, SKILL_FILE);
    if (!existsSync(skillFile)) continue;
    try {
      if (!statSync(skillFile).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ name: entry.name, dir, skillFile });
  }
  return out;
}
