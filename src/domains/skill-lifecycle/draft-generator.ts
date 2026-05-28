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
import type { Note, NoteClassification } from '../notes/index.js';
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

// ─── MSP-E: Note → DraftSkill ─────────────────────────────────────

const NOTE_DRAFT_TODO = 'TODO: refine before promoting to quarantined';

/**
 * MSP-E Note-to-Skill — turn a vault note (e.g. a customer-ticket
 * resolution) into a `DraftSkill`. Same output shape as
 * `lessonToDraftSkill`; the only difference is the source and the
 * optional best-effort PII-redaction step.
 *
 * Pure (no FS-Effect). Caller writes the draft via
 * `draftSkillFilePath` + `writeFileSync`.
 */
export interface NoteDraftOpts {
  /** Override the kebab-case draft name. Default: slugify(title). */
  readonly name?: string;
  /** "Wann soll der Skill triggern?" — wird Frontmatter-description. */
  readonly useWhen?: string;
  /**
   * If false (default), strip detected emails/phones/IPs/customer-IDs
   * from the body before rendering. Best-effort regex-based — caller
   * MUST review the diff before promote.
   */
  readonly preserveCustomerData?: boolean;
  /** Workspace the draft belongs to. Default: note's own workspace. */
  readonly workspace?: string;
}

export function noteToDraftSkill(note: Note, opts: NoteDraftOpts = {}): DraftSkill {
  const title = extractNoteTitle(note);
  const name = opts.name ?? slugifyForSkillName(title);
  const workspace = opts.workspace ?? note.workspace;
  const description =
    opts.useWhen !== undefined && opts.useWhen.trim().length > 0
      ? opts.useWhen.trim()
      : NOTE_DRAFT_TODO;
  const classification: NoteClassification = note.frontmatter.classification;
  const body =
    opts.preserveCustomerData === true ? note.body : redactCustomerIdentifiers(note.body);

  const fm = renderFrontmatter({
    name,
    description,
    version: DRAFT_VERSION,
    lifecycle_state: 'draft',
    source: 'note',
    source_path: note.path,
    source_workspace: note.workspace,
    classification,
  });
  const content = `${fm}\n${renderNoteBody(title, body, note.path, classification)}\n`;
  // Reuse `DraftSkill` shape from lesson-flow. Required `sourceLesson`
  // becomes a synthesized pseudo-entry so renderers don't have to
  // branch on origin.
  const pseudoLesson: LessonEntry = {
    date: (note.frontmatter.created as string | undefined) ?? new Date().toISOString().slice(0, 10),
    title,
    slug: name,
    situation: '',
    lektion: description === NOTE_DRAFT_TODO ? '' : description,
    anwendung: '',
    lineNumber: 0,
  };
  return { name, content, sourceLesson: pseudoLesson, workspace };
}

function extractNoteTitle(note: Note): string {
  const fmTitle = note.frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim().length > 0) return fmTitle.trim();
  const m = /^#\s+(.+?)\s*$/m.exec(note.body);
  if (m !== null && m[1] !== undefined) return m[1].trim();
  const base = note.path.split(/[\\/]/).pop() ?? 'untitled';
  return base.replace(/\.md$/i, '');
}

function slugifyForSkillName(title: string): string {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/g, '');
  if (ascii.length === 0 || !/^[a-z0-9]/.test(ascii)) {
    return `note-${Date.now().toString(36)}`;
  }
  return ascii;
}

function renderNoteBody(
  title: string,
  body: string,
  sourcePath: string,
  classification: NoteClassification,
): string {
  const sensitive = classification === 'customer-confidential' || classification === 'secret';
  const sensitiveBanner = sensitive
    ? '> **Sensitive Klassifikation** — die Quelle ist `customer-confidential`/`secret`. ' +
      'Der Body wurde best-effort PII-redacted; manuelles Review ist Pflicht.\n'
    : '';
  return [
    `# ${title}`,
    '',
    `> Generated from note \`${sourcePath}\` (MSP-E Note-to-Skill).`,
    `> Classification: **${classification}**.`,
    sensitiveBanner,
    '## Quell-Inhalt (potentiell redacted)',
    '',
    body.trim().length > 0 ? body : `_${NOTE_DRAFT_TODO}_`,
    '',
    '## Lifecycle',
    '',
    'Dieser Skill wurde aus einer Note generiert und liegt im `_drafts/`-Bucket.',
    'Nächste Schritte:',
    '',
    '1. Body lesen + ggf. PII-Verluste durch Redaction prüfen',
    '2. `claude-os skill promote <name> --to-quarantined`',
    '3. Optional sandbox-run',
    '4. `claude-os skill propose-review <name>` → signieren → `--to-active`',
  ].join('\n');
}

/**
 * Best-effort PII redaction. NOT a security boundary — the operator
 * MUST review the diff before activation. Catches the obvious shapes
 * that surface in MSP customer-tickets (Emails, phones, IPv4,
 * customer-IDs like `K12345` / `CUST-1234`).
 */
const REDACTION_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly replacement: string }> = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED-email]',
  },
  {
    // German-style phone: optional +, optional 0, 6+ digits with
    // separators. Lookbehind/lookahead exclude embedding inside
    // longer digit-runs (timestamps, line-numbers).
    pattern:
      /(?<!\d)(?:\+\d{1,3}[\s./-]?)?\(?0?\d{2,4}\)?[\s./-]?\d{2,4}[\s./-]?\d{2,4}[\s./-]?\d{0,4}(?!\d)/g,
    replacement: '[REDACTED-phone]',
  },
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[REDACTED-ip]' },
  { pattern: /\b(?:CUST|KUNDE|K)-?\d{3,}\b/gi, replacement: '[REDACTED-customer-id]' },
];

export function redactCustomerIdentifiers(body: string): string {
  let out = body;
  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
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
