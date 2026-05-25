/**
 * Generates a `SKILL.md` skeleton from a parsed `LessonEntry`.
 *
 * The output frontmatter passes the Phase-4 `validateSkillFrontmatter`
 * schema (name + description + version) and adds lifecycle metadata
 * (`lifecycle_state: draft`, `source_lesson_date`). The body wraps
 * the Situation / Lektion / Anwendung sections of the lesson into
 * a "when to use" / "how to apply" structure for claude.exe.
 *
 * **No write side-effects** — pure transformation. CLI / sidecar
 * decide whether to persist via `draftSkillFilePath`.
 *
 * @module @domains/skill-lifecycle/draft-generator
 */
import { stringify as stringifyYaml } from 'yaml';
import type { DraftSkill, LessonEntry } from './types.js';

const DRAFT_VERSION = '0.1.0';
const TODO_PLACEHOLDER = 'TODO: refine before promoting to quarantined';

export interface DraftGeneratorOpts {
  /** Workspace the draft will live in. Default 'personal'. */
  readonly workspace?: string;
  /** Override the draft directory name. Default: `lesson.slug`. */
  readonly nameOverride?: string;
}

/**
 * Turns a `LessonEntry` into a `DraftSkill`. Pure, no FS access.
 */
export function lessonToDraftSkill(lesson: LessonEntry, opts: DraftGeneratorOpts = {}): DraftSkill {
  const workspace = opts.workspace ?? 'personal';
  const name = opts.nameOverride ?? lesson.slug;
  const description = lesson.lektion.length > 0 ? firstSentence(lesson.lektion) : TODO_PLACEHOLDER;
  const fm = renderFrontmatter({
    name,
    description,
    version: DRAFT_VERSION,
    lifecycle_state: 'draft',
    source_lesson_date: lesson.date,
    source_lesson_title: lesson.title,
  });
  const body = renderBody(lesson);
  const content = `${fm}\n${body}\n`;
  return { name, content, sourceLesson: lesson, workspace };
}

function renderFrontmatter(fields: Record<string, string>): string {
  // Use yaml@2 stringify so we don't reinvent plain-vs-quoted scalar
  // logic. lineWidth: 0 keeps long descriptions single-line.
  const body = stringifyYaml(fields, { lineWidth: 0 }).trimEnd();
  return `---\n${body}\n---`;
}

function renderBody(lesson: LessonEntry): string {
  return [
    `# ${lesson.title}`,
    '',
    `> Generated from lesson dated **${lesson.date}** (line ${lesson.lineNumber} in tasks/lessons.md).`,
    '> Lifecycle: **draft** — manual review required before promoting to `quarantined`.',
    '',
    '## When to use this skill',
    '',
    lesson.lektion.length > 0 ? lesson.lektion : `_${TODO_PLACEHOLDER}_`,
    '',
    '## Why (situation context)',
    '',
    lesson.situation.length > 0 ? lesson.situation : `_${TODO_PLACEHOLDER}_`,
    '',
    '## How to apply',
    '',
    lesson.anwendung.length > 0 ? lesson.anwendung : `_${TODO_PLACEHOLDER}_`,
  ].join('\n');
}

function firstSentence(text: string): string {
  // Split on first period/exclamation/question that's followed by space or EOL.
  const m = /^([^.!?\n]+[.!?])(?:\s|$)/.exec(text);
  const candidate = m !== null ? (m[1] ?? text) : (text.split(/\n/)[0] ?? text);
  // Cap length so the frontmatter description stays one-liner-ish.
  return candidate.length > 200 ? `${candidate.slice(0, 197)}...` : candidate.trim();
}
