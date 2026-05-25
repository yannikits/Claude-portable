import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidSkillName,
  InvalidSkillNameError,
  listSkillDirs,
  skillDir,
  skillFilePath,
  skillsDir,
} from '../../../src/domains/skills/index.js';

describe('assertValidSkillName', () => {
  it.each(['memory-search', 'foo', 'a1', 'snake_case', 'with-many_chars-42'])('accepts %s', (n) => {
    expect(() => assertValidSkillName(n)).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['UPPER', 'uppercase'],
    ['with space', 'space'],
    ['../escape', 'traversal'],
    ['.dotfile', 'dotfile'],
    ['-leading-dash', 'leading-dash'],
    ['has/slash', 'slash'],
    ['has\\back', 'backslash'],
  ])('rejects %s', (n) => {
    expect(() => assertValidSkillName(n)).toThrow(InvalidSkillNameError);
  });

  it('refuses over 128 chars', () => {
    expect(() => assertValidSkillName('a'.repeat(129))).toThrow(InvalidSkillNameError);
  });
});

describe('skillsDir + skillDir + skillFilePath', () => {
  it('builds the ADR-0031 workspace layout', () => {
    const v = '/tmp/v';
    expect(skillsDir(v, 'personal').replace(/\\/g, '/')).toBe(
      '/tmp/v/Claude-OS/workspaces/personal/skills',
    );
    expect(skillDir(v, 'personal', 'memory-search').replace(/\\/g, '/')).toBe(
      '/tmp/v/Claude-OS/workspaces/personal/skills/memory-search',
    );
    expect(skillFilePath(v, 'personal', 'memory-search').replace(/\\/g, '/')).toBe(
      '/tmp/v/Claude-OS/workspaces/personal/skills/memory-search/SKILL.md',
    );
  });

  it('refuses traversal in skill name', () => {
    expect(() => skillDir('/tmp/v', 'personal', '../escape')).toThrow(InvalidSkillNameError);
  });
});

describe('listSkillDirs', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'sk-paths-'));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it('returns [] when no skills dir exists', () => {
    expect(listSkillDirs(vault, 'personal')).toEqual([]);
  });

  it('lists each skill dir that contains a SKILL.md', () => {
    const root = join(vault, 'Claude-OS', 'workspaces', 'personal', 'skills');
    mkdirSync(join(root, 'one'), { recursive: true });
    writeFileSync(join(root, 'one', 'SKILL.md'), '---\nname: one\n---\n');
    mkdirSync(join(root, 'two'), { recursive: true });
    writeFileSync(join(root, 'two', 'SKILL.md'), '---\nname: two\n---\n');
    const names = listSkillDirs(vault, 'personal')
      .map((d) => d.name)
      .sort();
    expect(names).toEqual(['one', 'two']);
  });

  it('skips dirs without SKILL.md', () => {
    const root = join(vault, 'Claude-OS', 'workspaces', 'personal', 'skills');
    mkdirSync(join(root, 'empty'), { recursive: true });
    mkdirSync(join(root, 'good'), { recursive: true });
    writeFileSync(join(root, 'good', 'SKILL.md'), '---\nname: good\n---\n');
    expect(listSkillDirs(vault, 'personal').map((d) => d.name)).toEqual(['good']);
  });

  it('skips dirs with invalid names (uppercase, dotfile)', () => {
    const root = join(vault, 'Claude-OS', 'workspaces', 'personal', 'skills');
    mkdirSync(join(root, 'UPPER'), { recursive: true });
    writeFileSync(join(root, 'UPPER', 'SKILL.md'), '---\nname: upper\n---\n');
    mkdirSync(join(root, '.hidden'), { recursive: true });
    writeFileSync(join(root, '.hidden', 'SKILL.md'), '---\nname: hidden\n---\n');
    mkdirSync(join(root, 'valid'), { recursive: true });
    writeFileSync(join(root, 'valid', 'SKILL.md'), '---\nname: valid\n---\n');
    expect(listSkillDirs(vault, 'personal').map((d) => d.name)).toEqual(['valid']);
  });
});
