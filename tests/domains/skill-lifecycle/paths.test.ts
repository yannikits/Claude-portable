import { describe, expect, it } from 'vitest';
import {
  assertValidDraftName,
  draftSkillFilePath,
  draftsDir,
  quarantinedDir,
  SkillLifecycleError,
} from '../../../src/domains/skill-lifecycle/index.js';

describe('assertValidDraftName', () => {
  it.each(['foo', 'foo-bar', 'with_under', '2026-05-25-thing', 'a1'])('accepts %s', (n) => {
    expect(() => assertValidDraftName(n)).not.toThrow();
  });

  it.each(['', 'UPPER', 'with space', '../escape', '-leading', '.dot'])('rejects %s', (n) => {
    expect(() => assertValidDraftName(n)).toThrow(SkillLifecycleError);
  });

  it('refuses over 128 chars', () => {
    expect(() => assertValidDraftName('a'.repeat(129))).toThrow(SkillLifecycleError);
  });
});

describe('draftsDir / quarantinedDir / draftSkillFilePath', () => {
  it('places drafts under _drafts (underscore prefix → invisible to skills loader)', () => {
    const p = draftsDir('/tmp/v', 'personal').replace(/\\/g, '/');
    expect(p).toBe('/tmp/v/Claude-OS/workspaces/personal/skills/_drafts');
  });

  it('places quarantined under _quarantined', () => {
    const p = quarantinedDir('/tmp/v', 'personal').replace(/\\/g, '/');
    expect(p).toBe('/tmp/v/Claude-OS/workspaces/personal/skills/_quarantined');
  });

  it('builds the full draft SKILL.md path', () => {
    const p = draftSkillFilePath('/tmp/v', 'personal', '2026-05-25-x').replace(/\\/g, '/');
    expect(p).toBe('/tmp/v/Claude-OS/workspaces/personal/skills/_drafts/2026-05-25-x/SKILL.md');
  });

  it('refuses traversal in the draft name', () => {
    expect(() => draftSkillFilePath('/tmp/v', 'personal', '../escape')).toThrow(
      SkillLifecycleError,
    );
  });
});
