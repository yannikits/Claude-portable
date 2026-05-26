/**
 * Skills-domain types (Phase 4 — read-only skill loader).
 *
 * A "skill" is a `SKILL.md` file under
 * `<vault>/Claude-OS/workspaces/<workspaceId>/skills/<skillName>/` with
 * YAML frontmatter describing it. The skill body is the prompt
 * material claude.exe receives when the skill is matched.
 *
 * v1 covers loader + description-matcher only. Auto-promotion lifecycle
 * (draft → quarantined → reviewed → active) is Phase 5 / ADR-0026 and
 * lives in `src/domains/skill-lifecycle/` when added.
 *
 * @module @domains/skills/types
 */

export interface SkillFrontmatter {
  readonly name: string;
  /** One-liner used by the matcher. Required for retrieval. */
  readonly description: string;
  /** Semver-ish string. Required so we can detect breaking changes. */
  readonly version: string;
  /** Allow open frontmatter — users may add tags/category/etc. */
  readonly [key: string]: unknown;
}

export interface Skill {
  /** Absolute path to the SKILL.md file. */
  readonly path: string;
  /** Directory containing this SKILL.md (skill root). */
  readonly dir: string;
  /** Workspace this skill is scoped to. */
  readonly workspace: string;
  /** Frontmatter parsed from SKILL.md. */
  readonly frontmatter: SkillFrontmatter;
  /** Markdown body — everything after the closing `---`. */
  readonly body: string;
  /** Raw frontmatter YAML text (round-trip + audit). */
  readonly rawFrontmatter: string;
}

export class SkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillsError';
  }
}

export class InvalidSkillNameError extends SkillsError {
  constructor(name: string, reason: string) {
    super(`Invalid skill name "${name}": ${reason}`);
    this.name = 'InvalidSkillNameError';
  }
}

export class MalformedSkillError extends SkillsError {
  constructor(path: string, reason: string) {
    super(`Malformed SKILL.md at "${path}": ${reason}`);
    this.name = 'MalformedSkillError';
  }
}
