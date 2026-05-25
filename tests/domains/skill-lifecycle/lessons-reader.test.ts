import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LessonParseError,
  parseLessonsContent,
  readLessonsFile,
} from '../../../src/domains/skill-lifecycle/index.js';

describe('parseLessonsContent', () => {
  it('returns [] for empty input', () => {
    expect(parseLessonsContent('')).toEqual([]);
  });

  it('returns [] when no heading matches the date pattern', () => {
    expect(parseLessonsContent('## Just a section\n\nblah blah')).toEqual([]);
  });

  it('parses a single complete lesson', () => {
    const md = `# Lessons

## 2026-05-25 — NUL byte in regex

**Situation:** literal space mutated to NUL during write.

**Lektion:** Always use \\s or \\x20 explicitly inside character classes.

**Anwendung:** Filename validators, any regex with literal whitespace.
`;
    const lessons = parseLessonsContent(md);
    expect(lessons).toHaveLength(1);
    const l = lessons[0];
    expect(l?.date).toBe('2026-05-25');
    expect(l?.title).toBe('NUL byte in regex');
    expect(l?.situation).toContain('mutated to NUL');
    expect(l?.lektion).toContain('character classes');
    expect(l?.anwendung).toContain('Filename validators');
    expect(l?.slug).toBe('2026-05-25-nul-byte-in-regex');
  });

  it('parses multiple lessons preserving order', () => {
    const md = `## 2026-05-24 — First
**Lektion:** A
## 2026-05-25 — Second
**Lektion:** B`;
    const lessons = parseLessonsContent(md);
    expect(lessons.map((l) => l.date)).toEqual(['2026-05-24', '2026-05-25']);
    expect(lessons[0]?.lektion).toBe('A');
    expect(lessons[1]?.lektion).toBe('B');
  });

  it('tolerates missing sections (returns empty strings)', () => {
    const md = `## 2026-05-25 — Sparse
**Situation:** only situation here.`;
    const lesson = parseLessonsContent(md)[0];
    expect(lesson?.situation).toBe('only situation here.');
    expect(lesson?.lektion).toBe('');
    expect(lesson?.anwendung).toBe('');
  });

  it('captures multi-line section content', () => {
    const md = `## 2026-05-25 — Multi

**Lektion:** Line one.
Line two of lektion.

Still part of lektion until another label.

**Anwendung:** Now switches.`;
    const lesson = parseLessonsContent(md)[0];
    expect(lesson?.lektion).toContain('Line one');
    expect(lesson?.lektion).toContain('Line two');
    expect(lesson?.lektion).toContain('Still part of lektion');
    expect(lesson?.anwendung).toBe('Now switches.');
  });

  it('handles em-dash, en-dash, and plain hyphen in heading separator', () => {
    expect(parseLessonsContent('## 2026-05-25 — A')[0]?.title).toBe('A');
    expect(parseLessonsContent('## 2026-05-25 - B')[0]?.title).toBe('B');
    expect(parseLessonsContent('## 2026-05-25 -- C')[0]?.title).toBe('C');
  });

  it('records lineNumber for the heading', () => {
    const md = `intro\nfiller\n## 2026-05-25 — Third-line\n**Lektion:** x`;
    const lesson = parseLessonsContent(md)[0];
    expect(lesson?.lineNumber).toBe(3);
  });

  it('slug strips German umlauts via NFKD-normalisation', () => {
    const md = `## 2026-05-25 — Über die Möglichkeit
**Lektion:** x`;
    const lesson = parseLessonsContent(md)[0];
    expect(lesson?.slug).toMatch(/^2026-05-25-/);
    expect(lesson?.slug).not.toContain('ü');
    expect(lesson?.slug).not.toContain('ö');
  });
});

describe('readLessonsFile', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lesson-r-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads + parses a real file from disk', () => {
    const path = join(tmp, 'lessons.md');
    writeFileSync(path, '## 2026-05-25 — From disk\n**Lektion:** ok\n');
    const lessons = readLessonsFile(path);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.title).toBe('From disk');
  });

  it('throws LessonParseError when the file is unreadable', () => {
    expect(() => readLessonsFile(join(tmp, 'does-not-exist.md'))).toThrow(LessonParseError);
  });
});
