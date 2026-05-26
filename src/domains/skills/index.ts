/**
 * Skills domain — workspace-scoped SKILL.md loader + matcher
 * (Phase 4 — read-only).
 *
 * @module @domains/skills
 */

export {
  SkillFrontmatterSchema,
  type SkillFrontmatterStatic,
  validateSkillFrontmatter,
} from './frontmatter-schema.js';
export { type MatchOpts, matchSkills, type SkillMatch } from './matcher.js';
export {
  assertValidSkillName,
  listSkillDirs,
  skillDir,
  skillFilePath,
  skillsDir,
} from './paths.js';
export { listSkills, readSkill, readSkillByName } from './reader.js';
export {
  InvalidSkillNameError,
  MalformedSkillError,
  type Skill,
  type SkillFrontmatter,
  SkillsError,
} from './types.js';
