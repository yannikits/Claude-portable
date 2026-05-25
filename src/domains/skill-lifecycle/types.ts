/**
 * Skill-lifecycle domain types (Phase 5 — foundation only).
 *
 * Per ADR-0026 the full lifecycle is:
 *   draft → quarantined → reviewed → active → deprecated → disabled
 *
 * This Phase-5 foundation ships ONLY the read/draft-generate side:
 *   - parse `tasks/lessons.md` into structured entries
 *   - produce a `SKILL.md` skeleton from a lesson (state: draft)
 *   - write the draft into `<vault>/Claude-OS/workspaces/<ws>/skills/_drafts/<name>/SKILL.md`
 *
 * The `_drafts/` underscore prefix means the Phase-4 `assertValidSkillName`
 * regex (`/^[a-z0-9]/`) excludes the entire bucket from `listSkills`
 * automatically — drafts are invisible to the runtime loader by design.
 *
 * Out of scope for this PR (gated per ADR-0026 §"Implementation Gated"):
 *   - Sandbox-Process-Isolation for quarantined skills
 *   - Yannik Ed25519-Signatur-Flow im Tauri-GUI
 *   - Audit-Log-Format finalisation
 *   - Promote-to-quarantined / -reviewed / -active CLI
 *
 * @module @domains/skill-lifecycle/types
 */

export type SkillLifecycleState =
  | 'draft'
  | 'quarantined'
  | 'reviewed'
  | 'active'
  | 'deprecated'
  | 'disabled';

/**
 * Parsed lesson entry from `tasks/lessons.md`.
 *
 * Format on disk (per CLAUDE.md):
 *   ## YYYY-MM-DD — <title>
 *
 *   **Situation:** <text>
 *   **Lektion:** <text>
 *   **Anwendung:** <text>
 *
 * Section labels are case-tolerant. Missing sections are surfaced as
 * empty strings (the lesson is still considered parseable).
 */
export interface LessonEntry {
  readonly date: string;
  readonly title: string;
  readonly slug: string;
  readonly situation: string;
  readonly lektion: string;
  readonly anwendung: string;
  /** Approximate line in lessons.md where the heading was found. */
  readonly lineNumber: number;
}

/**
 * In-memory representation of a generated draft skill BEFORE it is
 * persisted to disk. Caller decides whether to write it (CLI does).
 */
export interface DraftSkill {
  /** kebab-case directory name (becomes `<draftsDir>/<name>/SKILL.md`). */
  readonly name: string;
  /** Full SKILL.md text (frontmatter + body). */
  readonly content: string;
  /** Lesson the draft was generated from. */
  readonly sourceLesson: LessonEntry;
  /** Workspace the draft belongs to. */
  readonly workspace: string;
}

export class SkillLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillLifecycleError';
  }
}

export class LessonParseError extends SkillLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = 'LessonParseError';
  }
}
