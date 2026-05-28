import { describe, expect, it } from 'vitest';
import type { Note } from '../../../src/domains/notes/index.js';
import {
  noteToDraftSkill,
  redactCustomerIdentifiers,
} from '../../../src/domains/skill-lifecycle/index.js';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    path: overrides.path ?? '/vault/Claude-OS/workspaces/personal/notes/m365-reset.md',
    workspace: overrides.workspace ?? 'personal',
    frontmatter: {
      workspace: 'personal',
      classification: 'personal',
      schema_version: 1,
      created: '2026-05-28T08:00:00.000Z',
      ...(overrides.frontmatter ?? {}),
    },
    body: overrides.body ?? '# M365 License Reset\n\nFor a user, do X then Y.',
    rawFrontmatter: overrides.rawFrontmatter ?? 'workspace: personal\nclassification: personal',
  };
}

describe('redactCustomerIdentifiers', () => {
  it('strips email addresses', () => {
    const out = redactCustomerIdentifiers('contact alice@example.com directly');
    expect(out).toBe('contact [REDACTED-email] directly');
  });

  it('strips multiple shapes in one pass', () => {
    const out = redactCustomerIdentifiers(
      'Kunde K12345 erreichte uns über alice@example.com aus 10.0.0.5.',
    );
    expect(out).toContain('[REDACTED-customer-id]');
    expect(out).toContain('[REDACTED-email]');
    expect(out).toContain('[REDACTED-ip]');
  });

  it('strips DACH phone numbers', () => {
    const cases = ['+49 30 1234 5678', '030 / 12345678', '030-12345678'];
    for (const phone of cases) {
      expect(redactCustomerIdentifiers(`Anruf von ${phone}`)).toContain('[REDACTED-phone]');
    }
  });

  it('idempotent on already-redacted body', () => {
    const once = redactCustomerIdentifiers('alice@example.com');
    const twice = redactCustomerIdentifiers(once);
    expect(twice).toBe(once);
  });

  it('preserves non-PII content', () => {
    const body = 'PowerShell Set-Calendar -User U1 -Permission Owner';
    expect(redactCustomerIdentifiers(body)).toBe(body);
  });
});

describe('noteToDraftSkill', () => {
  it('extracts the title from the first H1 in body', () => {
    const note = makeNote();
    const draft = noteToDraftSkill(note);
    expect(draft.content).toContain('# M365 License Reset');
    expect(draft.name).toBe('m365-license-reset');
  });

  it('prefers frontmatter.title when present', () => {
    const note = makeNote({
      frontmatter: {
        workspace: 'personal',
        classification: 'personal',
        schema_version: 1,
        title: 'Verzeichnis-Reset Anleitung',
      },
      body: '# something else\nbody',
    });
    const draft = noteToDraftSkill(note);
    expect(draft.name).toBe('verzeichnis-reset-anleitung');
    expect(draft.content).toContain('Verzeichnis-Reset Anleitung');
  });

  it('falls back to filename when title cannot be inferred', () => {
    const note = makeNote({
      path: '/vault/foo/bar/2026-05-28-untitled.md',
      body: 'no heading here',
    });
    const draft = noteToDraftSkill(note);
    expect(draft.name).toMatch(/^2026-05-28-untitled$|^note-/);
  });

  it('honours opts.name and opts.useWhen', () => {
    const note = makeNote();
    const draft = noteToDraftSkill(note, {
      name: 'overridden-name',
      useWhen: 'Wenn ein M365 Reset benötigt wird',
    });
    expect(draft.name).toBe('overridden-name');
    expect(draft.content).toContain('description: Wenn ein M365 Reset benötigt wird');
  });

  it('redacts PII by default for personal classification too', () => {
    const note = makeNote({
      body: '# Reset\nCheck alice@example.com from 10.0.0.1',
    });
    const draft = noteToDraftSkill(note);
    expect(draft.content).toContain('[REDACTED-email]');
    expect(draft.content).toContain('[REDACTED-ip]');
  });

  it('skips redaction when preserveCustomerData=true', () => {
    const note = makeNote({
      body: '# X\nemail alice@example.com',
    });
    const draft = noteToDraftSkill(note, { preserveCustomerData: true });
    expect(draft.content).toContain('alice@example.com');
    expect(draft.content).not.toContain('[REDACTED-email]');
  });

  it('shows a sensitive-banner for customer-confidential', () => {
    const note = makeNote({
      frontmatter: {
        workspace: 'msp-customers/kunde-a',
        classification: 'customer-confidential',
        tenant: 'kunde-a',
        schema_version: 1,
      },
      body: '# Customer-only resolution\nContact alice@example.com',
    });
    const draft = noteToDraftSkill(note);
    expect(draft.content).toContain('Sensitive Klassifikation');
    expect(draft.content).toContain('classification: customer-confidential');
    expect(draft.content).toContain('[REDACTED-email]');
  });

  it('respects opts.workspace override', () => {
    const note = makeNote({ workspace: 'personal' });
    const draft = noteToDraftSkill(note, { workspace: 'msp-internal' });
    expect(draft.workspace).toBe('msp-internal');
  });

  it('returns a DraftSkill with a synthesized pseudo-lesson', () => {
    const note = makeNote();
    const draft = noteToDraftSkill(note);
    expect(draft.sourceLesson.slug).toBe(draft.name);
    expect(draft.sourceLesson.title.length).toBeGreaterThan(0);
  });

  it('falls back to "note-<base36>" when the title slugifies to empty', () => {
    const note = makeNote({
      frontmatter: {
        workspace: 'personal',
        classification: 'personal',
        schema_version: 1,
        title: '???????',
      },
      body: '',
    });
    const draft = noteToDraftSkill(note);
    expect(draft.name).toMatch(/^note-[a-z0-9]+$/);
  });
});
