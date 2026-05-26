/**
 * TypeBox schema for SKILL.md frontmatter.
 *
 * Required fields: `name`, `description`, `version`.
 * `additionalProperties: true` — user-defined keys allowed (tags, etc.).
 *
 * @module @domains/skills/frontmatter-schema
 */
import { type Static, Type } from '@sinclair/typebox';
import { formatErrors } from '../../core/validation/format.js';
import { MalformedSkillError, type SkillFrontmatter } from './types.js';

export const SkillFrontmatterSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

export type SkillFrontmatterStatic = Static<typeof SkillFrontmatterSchema>;

/**
 * Validates parsed SKILL.md-frontmatter. Throws `MalformedSkillError`
 * on failure with all messages joined.
 */
export function validateSkillFrontmatter(
  path: string,
  fm: unknown,
): asserts fm is SkillFrontmatter {
  const errors = formatErrors(SkillFrontmatterSchema, fm);
  if (errors.length > 0) {
    throw new MalformedSkillError(path, `frontmatter invalid: ${errors.join('; ')}`);
  }
}
