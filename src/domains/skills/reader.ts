/**
 * Skill reader — parses SKILL.md and validates frontmatter.
 *
 * Reuses Phase-2b `extractFrontmatter` + `parseFrontmatter` so the
 * fencing semantics stay identical to notes. After parsing the YAML,
 * we run the strict TypeBox schema (name + description + version
 * required) — malformed skills are surfaced via `MalformedSkillError`
 * rather than silently ignored.
 *
 * @module @domains/skills/reader
 */
import { readFileSync } from 'node:fs';
import { extractFrontmatter, parseFrontmatter } from '../notes/index.js';
import type { WorkspaceId } from '../workspace/index.js';
import { validateSkillFrontmatter } from './frontmatter-schema.js';
import { listSkillDirs, skillFilePath } from './paths.js';
import { MalformedSkillError, type Skill, type SkillFrontmatter } from './types.js';

/**
 * Reads + parses a SKILL.md at the given path. Throws
 * `MalformedSkillError` on any of:
 *   - file unreadable
 *   - no opening fence (skill MUST have frontmatter)
 *   - YAML parse error
 *   - schema validation failure (missing required fields)
 */
export function readSkill(skillFile: string, workspaceId: WorkspaceId): Skill {
  let raw: string;
  try {
    raw = readFileSync(skillFile, 'utf8');
  } catch (err) {
    throw new MalformedSkillError(skillFile, `failed to read: ${(err as Error).message}`);
  }
  let extracted: ReturnType<typeof extractFrontmatter>;
  try {
    extracted = extractFrontmatter(raw);
  } catch (err) {
    throw new MalformedSkillError(skillFile, (err as Error).message);
  }
  if (!extracted.hasFrontmatter) {
    throw new MalformedSkillError(skillFile, 'missing frontmatter (no opening ---)');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseFrontmatter(extracted.rawFrontmatter);
  } catch (err) {
    throw new MalformedSkillError(skillFile, (err as Error).message);
  }
  validateSkillFrontmatter(skillFile, parsed);
  const dir = skillFile.replace(/[\\/]SKILL\.md$/i, '');
  return {
    path: skillFile,
    dir,
    workspace: workspaceId,
    frontmatter: parsed as SkillFrontmatter,
    body: extracted.body,
    rawFrontmatter: extracted.rawFrontmatter,
  };
}

/**
 * Lists + reads every skill under the workspace. Skills that fail to
 * parse are surfaced via the optional `onSkillError` callback so the
 * caller can log them, but they're excluded from the result — one
 * malformed skill does not poison the loader.
 */
export function listSkills(
  vaultRoot: string,
  workspaceId: WorkspaceId,
  onSkillError?: (path: string, err: Error) => void,
): Skill[] {
  const dirs = listSkillDirs(vaultRoot, workspaceId);
  const out: Skill[] = [];
  for (const d of dirs) {
    try {
      out.push(readSkill(d.skillFile, workspaceId));
    } catch (err) {
      if (onSkillError !== undefined) {
        onSkillError(d.skillFile, err as Error);
      }
    }
  }
  return out;
}

/** Convenience: reads a skill by name (throws on missing or malformed). */
export function readSkillByName(
  vaultRoot: string,
  workspaceId: WorkspaceId,
  skillName: string,
): Skill {
  const path = skillFilePath(vaultRoot, workspaceId, skillName);
  return readSkill(path, workspaceId);
}
