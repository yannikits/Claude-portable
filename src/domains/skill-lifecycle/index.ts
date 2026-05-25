/**
 * Skill-lifecycle domain — Phase 5 foundation (read + draft-generation
 * only). Sandbox-isolation + Yannik-signature + review-UI gated to
 * later phases per ADR-0026.
 *
 * @module @domains/skill-lifecycle
 */

export {
  type DraftGeneratorOpts,
  lessonToDraftSkill,
} from './draft-generator.js';
export {
  parseLessonsContent,
  readLessonsFile,
} from './lessons-reader.js';
export {
  assertValidDraftName,
  draftSkillFilePath,
  draftsDir,
  quarantinedDir,
} from './paths.js';
export {
  type DraftSkill,
  type LessonEntry,
  LessonParseError,
  SkillLifecycleError,
  type SkillLifecycleState,
} from './types.js';
