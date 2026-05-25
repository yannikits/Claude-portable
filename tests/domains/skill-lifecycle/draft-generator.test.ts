import { describe, expect, it } from 'vitest';
import {
  type LessonEntry,
  lessonToDraftSkill,
} from '../../../src/domains/skill-lifecycle/index.js';

function lesson(over: Partial<LessonEntry> = {}): LessonEntry {
  return {
    date: '2026-05-25',
    title: 'NUL byte in regex',
    slug: '2026-05-25-nul-byte-in-regex',
    situation: 'literal space turned into NUL during write pipeline.',
    lektion: 'Always use \\s or \\x20 explicitly inside character classes.',
    anwendung: 'Filename validators, any regex with literal whitespace.',
    lineNumber: 17,
    ...over,
  };
}

describe('lessonToDraftSkill', () => {
  it('produces frontmatter with required fields + lifecycle metadata', () => {
    const draft = lessonToDraftSkill(lesson());
    expect(draft.content.startsWith('---\n')).toBe(true);
    expect(draft.content).toContain('name: 2026-05-25-nul-byte-in-regex');
    expect(draft.content).toContain('version: 0.1.0');
    expect(draft.content).toContain('lifecycle_state: draft');
    expect(draft.content).toContain('source_lesson_date: 2026-05-25');
    expect(draft.content).toContain('description:');
  });

  it('description (frontmatter) is the first sentence of the Lektion', async () => {
    const { parse } = await import('yaml');
    const draft = lessonToDraftSkill(
      lesson({ lektion: 'Use \\s explicitly. Avoid bare space inside [].' }),
    );
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(draft.content);
    expect(fmMatch).not.toBeNull();
    const fm = parse(fmMatch?.[1] ?? '') as { description: string };
    expect(fm.description).toBe('Use \\s explicitly.');
    // Body still contains the full lesson (both sentences live in the
    // "When to use" section).
    expect(draft.content).toContain('Avoid bare space inside [].');
  });

  it('falls back to a TODO marker when lektion is empty', () => {
    const draft = lessonToDraftSkill(lesson({ lektion: '' }));
    expect(draft.content).toContain('description: "TODO: refine before promoting to quarantined"');
  });

  it('includes Situation / Lektion / Anwendung sections in the body', () => {
    const draft = lessonToDraftSkill(lesson());
    expect(draft.content).toContain('## When to use this skill');
    expect(draft.content).toContain('## Why (situation context)');
    expect(draft.content).toContain('## How to apply');
    expect(draft.content).toContain('character classes');
  });

  it('emits TODO placeholders for missing sections', () => {
    const draft = lessonToDraftSkill(lesson({ lektion: 'present', situation: '', anwendung: '' }));
    expect(draft.content).toContain('_TODO: refine before promoting to quarantined_');
  });

  it('honours workspace override', () => {
    const draft = lessonToDraftSkill(lesson(), { workspace: 'msp-internal' });
    expect(draft.workspace).toBe('msp-internal');
  });

  it('honours nameOverride', () => {
    const draft = lessonToDraftSkill(lesson(), { nameOverride: 'custom-name' });
    expect(draft.name).toBe('custom-name');
    expect(draft.content).toContain('name: custom-name');
  });

  it('round-trips YAML scalars with special chars via re-parse', async () => {
    const { parse } = await import('yaml');
    const draft = lessonToDraftSkill(
      lesson({ lektion: 'Has a "quote" inside it. Also: a colon.' }),
    );
    // Extract the frontmatter block and re-parse — the round-trip is what
    // matters, not the specific quoting style yaml@2 chose.
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(draft.content);
    expect(fmMatch).not.toBeNull();
    const fm = parse(fmMatch?.[1] ?? '') as { description: string };
    expect(fm.description).toContain('Has a "quote" inside it.');
  });
});
