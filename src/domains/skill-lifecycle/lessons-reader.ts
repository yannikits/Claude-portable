/**
 * Parser for `tasks/lessons.md` (format per CLAUDE.md):
 *
 *   ## YYYY-MM-DD — <Kurz-Titel>
 *
 *   **Situation:** <text — possibly multi-line>
 *
 *   **Lektion:** <text — possibly multi-line>
 *
 *   **Anwendung:** <text — possibly multi-line>
 *
 * Sections are case-tolerant (`**lektion:**` and `**LEKTION:**` both
 * work) and any of the three may be missing — they're surfaced as
 * empty strings so the draft-generator can emit a TODO marker.
 *
 * Cross-section delimiter is the next `**<label>:**` OR the next
 * `## ` heading OR end-of-file.
 *
 * @module @domains/skill-lifecycle/lessons-reader
 */
import { readFileSync } from 'node:fs';
import { type LessonEntry, LessonParseError } from './types.js';

const HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*(?:—|--|-)\s*(.+?)\s*$/;
const SECTION_RE = /^\*\*([A-Za-zÄÖÜäöüß]+):\*\*\s*(.*)$/;
const NEXT_HEADING_RE = /^##\s+/;

interface SectionMap {
  situation: string;
  lektion: string;
  anwendung: string;
}

/** Reads + parses `tasks/lessons.md`. Throws on FS errors. */
export function readLessonsFile(absolutePath: string): LessonEntry[] {
  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch (err) {
    throw new LessonParseError(
      `failed to read lessons file at "${absolutePath}": ${(err as Error).message}`,
    );
  }
  return parseLessonsContent(raw);
}

/**
 * Pure parser — operates on string content. Useful for tests.
 */
export function parseLessonsContent(content: string): LessonEntry[] {
  const lines = content.split(/\r?\n/);
  const out: LessonEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = HEADING_RE.exec(line);
    if (m === null) continue;
    const date = m[1] ?? '';
    const title = (m[2] ?? '').trim();
    const sections = collectSections(lines, i + 1);
    const slug = makeSlug(date, title);
    out.push({
      date,
      title,
      slug,
      situation: sections.situation,
      lektion: sections.lektion,
      anwendung: sections.anwendung,
      lineNumber: i + 1,
    });
  }
  return out;
}

function collectSections(lines: readonly string[], startIdx: number): SectionMap {
  const sections: SectionMap = { situation: '', lektion: '', anwendung: '' };
  let currentLabel: keyof SectionMap | null = null;
  const buffers: Record<keyof SectionMap, string[]> = {
    situation: [],
    lektion: [],
    anwendung: [],
  };

  for (let j = startIdx; j < lines.length; j++) {
    const ln = lines[j] ?? '';
    if (NEXT_HEADING_RE.test(ln)) break;
    const sec = SECTION_RE.exec(ln);
    if (sec !== null) {
      const label = (sec[1] ?? '').toLowerCase();
      const inline = sec[2] ?? '';
      const mapped: keyof SectionMap | null =
        label === 'situation'
          ? 'situation'
          : label === 'lektion'
            ? 'lektion'
            : label === 'anwendung'
              ? 'anwendung'
              : null;
      if (mapped !== null) {
        currentLabel = mapped;
        if (inline.length > 0) buffers[mapped].push(inline);
        continue;
      }
    }
    if (currentLabel !== null) buffers[currentLabel].push(ln);
  }

  sections.situation = buffers.situation.join('\n').trim();
  sections.lektion = buffers.lektion.join('\n').trim();
  sections.anwendung = buffers.anwendung.join('\n').trim();
  return sections;
}

function makeSlug(date: string, title: string): string {
  const titleSlug = title
    .toLowerCase()
    .normalize('NFKD')
    // Strip diacritics
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${date}-${titleSlug || 'lesson'}`;
}
