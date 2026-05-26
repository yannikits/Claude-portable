import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listSkills,
  MalformedSkillError,
  readSkill,
  readSkillByName,
} from '../../../src/domains/skills/index.js';

function setupSkill(
  vault: string,
  skillName: string,
  body: string,
  workspaceId = 'personal',
): string {
  const dir = join(vault, 'Claude-OS', 'workspaces', workspaceId, 'skills', skillName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, body, 'utf8');
  return path;
}

const VALID_FM = `---
name: memory-search
description: Searches the user's vault for relevant notes by keyword.
version: 0.1.0
---
This skill triggers when the user asks "find notes about X".
`;

describe('readSkill', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'sk-read-'));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it('parses a well-formed SKILL.md', () => {
    const path = setupSkill(vault, 'memory-search', VALID_FM);
    const skill = readSkill(path, 'personal');
    expect(skill.frontmatter.name).toBe('memory-search');
    expect(skill.frontmatter.description).toContain('vault for relevant notes');
    expect(skill.frontmatter.version).toBe('0.1.0');
    expect(skill.body).toContain('This skill triggers');
    expect(skill.workspace).toBe('personal');
  });

  it('throws when SKILL.md has no frontmatter', () => {
    const path = setupSkill(vault, 'no-fm', '# Just a heading\nno frontmatter here');
    expect(() => readSkill(path, 'personal')).toThrow(MalformedSkillError);
  });

  it.each([
    ['missing-name', '---\ndescription: x\nversion: 0.1\n---\n'],
    ['missing-description', '---\nname: x\nversion: 0.1\n---\n'],
    ['missing-version', '---\nname: x\ndescription: y\n---\n'],
    ['empty-description', '---\nname: x\ndescription: ""\nversion: 0.1\n---\n'],
  ])('throws on schema-violation: %s', (skillName, fm) => {
    const path = setupSkill(vault, skillName, fm);
    expect(() => readSkill(path, 'personal')).toThrow(MalformedSkillError);
  });

  it('throws on malformed YAML', () => {
    const path = setupSkill(vault, 'broken-yaml', '---\nname: [unclosed\n---\nbody');
    expect(() => readSkill(path, 'personal')).toThrow(MalformedSkillError);
  });

  it('readSkillByName resolves the path', () => {
    setupSkill(vault, 'by-name', VALID_FM);
    const skill = readSkillByName(vault, 'personal', 'by-name');
    expect(skill.frontmatter.name).toBe('memory-search');
  });
});

describe('listSkills', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'sk-list-'));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it('returns [] for an empty workspace', () => {
    expect(listSkills(vault, 'personal')).toEqual([]);
  });

  it('returns multiple skills sorted by directory order', () => {
    setupSkill(vault, 'alpha', VALID_FM.replace('memory-search', 'alpha'));
    setupSkill(vault, 'beta', VALID_FM.replace('memory-search', 'beta'));
    const skills = listSkills(vault, 'personal');
    const names = skills.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('reports malformed skills via onSkillError + excludes from results', () => {
    setupSkill(vault, 'good', VALID_FM);
    setupSkill(vault, 'bad', '---\nname: bad\n---\n'); // missing description+version
    const issues: { path: string; message: string }[] = [];
    const skills = listSkills(vault, 'personal', (path, err) =>
      issues.push({ path, message: err.message }),
    );
    expect(skills.map((s) => s.frontmatter.name)).toEqual(['memory-search']);
    expect(issues.length).toBe(1);
    expect(issues[0]?.path).toContain('bad');
  });

  it('keeps going when one skill is unreadable (callback fires)', () => {
    setupSkill(vault, 'good', VALID_FM);
    setupSkill(vault, 'broken', '---\nname: [unclosed\n---\nbody');
    const issues: { path: string; message: string }[] = [];
    const skills = listSkills(vault, 'personal', (path, err) =>
      issues.push({ path, message: err.message }),
    );
    expect(skills.length).toBe(1);
    expect(issues.length).toBe(1);
  });
});
