import { describe, expect, it } from 'vitest';
import { matchSkills, type Skill } from '../../../src/domains/skills/index.js';

function makeSkill(name: string, description: string): Skill {
  return {
    path: `/tmp/skills/${name}/SKILL.md`,
    dir: `/tmp/skills/${name}`,
    workspace: 'personal',
    frontmatter: { name, description, version: '0.1.0' },
    body: '',
    rawFrontmatter: '',
  };
}

describe('matchSkills', () => {
  it('returns [] for empty query', () => {
    expect(matchSkills([makeSkill('foo', 'bar')], '')).toEqual([]);
  });

  it('returns [] for empty skill list', () => {
    expect(matchSkills([], 'kubernetes')).toEqual([]);
  });

  it('returns [] when query tokenises to nothing', () => {
    expect(matchSkills([makeSkill('foo', 'bar')], '?!')).toEqual([]);
  });

  it('matches the most relevant skill by description', () => {
    const skills = [
      makeSkill('kube-deploy', 'Deploy applications to a Kubernetes cluster.'),
      makeSkill('git-flow', 'Manage git branches with the gitflow model.'),
      makeSkill('coffee-time', 'Tells you to take a coffee break.'),
    ];
    const matches = matchSkills(skills, 'kubernetes');
    expect(matches.length).toBe(1);
    expect(matches[0]?.skill.frontmatter.name).toBe('kube-deploy');
    expect(matches[0]?.score).toBeGreaterThan(0);
  });

  it('matches via skill name (not only description)', () => {
    const skills = [
      makeSkill('memory-search', 'Looks things up.'),
      makeSkill('unrelated', 'Does something else.'),
    ];
    const matches = matchSkills(skills, 'memory');
    expect(matches.length).toBe(1);
    expect(matches[0]?.skill.frontmatter.name).toBe('memory-search');
  });

  it('respects topK', () => {
    const skills = [
      makeSkill('a', 'authentication patterns one'),
      makeSkill('b', 'authentication patterns two'),
      makeSkill('c', 'authentication patterns three'),
    ];
    const matches = matchSkills(skills, 'authentication', { topK: 2 });
    expect(matches.length).toBe(2);
  });

  it('returns matches in descending score order', () => {
    const skills = [
      makeSkill('super-match', 'authentication authentication authentication patterns library'),
      makeSkill('weak-match', 'a lone mention of authentication in passing'),
    ];
    const matches = matchSkills(skills, 'authentication');
    expect(matches.length).toBe(2);
    if (matches.length === 2 && matches[0] !== undefined && matches[1] !== undefined) {
      expect(matches[0].score).toBeGreaterThan(matches[1].score);
    }
  });

  it('matchedTerms reflects what hit', () => {
    const skills = [makeSkill('foo', 'Discussion about authentication patterns.')];
    const matches = matchSkills(skills, 'authentication runbook patterns');
    expect(matches.length).toBe(1);
    expect(matches[0]?.matchedTerms.sort()).toEqual(['authentication', 'patterns']);
  });
});
