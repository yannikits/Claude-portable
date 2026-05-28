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
  type NoteDraftOpts,
  noteToDraftSkill,
  redactCustomerIdentifiers,
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
  approveReview,
  buildAndSignApproval,
  computeDiffHash,
  deprecateSkill,
  disableSkill,
  PromoteError,
  type PromoteErrorCode,
  type PromoteOpts,
  type PromoteResult,
  promoteDraftToQuarantined,
  proposeReview,
  type ReviewApprovalPayload,
  type ReviewProposal,
  reactivateSkill,
  runQuarantinedSandbox,
  type SandboxRunSummary,
  setFrontmatterState,
} from './promote.js';
export {
  assertSkillScriptUnderRoot,
  assertValidSandboxRoot,
  assertValidSkillId,
  DEFAULT_TIMEOUT_MS as SANDBOX_DEFAULT_TIMEOUT_MS,
  runSkillInSandbox,
  SandboxError,
  type SandboxIpcRequest,
  type SandboxIpcResponse,
  type SandboxOpts,
  type SandboxRunError,
  type SandboxRunInput,
  type SandboxRunOk,
  type SandboxRunResult,
  type SandboxRunTimeout,
} from './sandbox/index.js';
export {
  canonicalizeJson,
  type Ed25519KeyPair,
  fromBase64Url,
  generateEd25519Keypair,
  importPrivateKey,
  importPublicKey,
  type LoadOrCreateResult,
  loadOrCreateSigningKeypair,
  readPublicKey,
  rotateSigningKeypair,
  SIGNING_KEY_NAMES,
  type SignedEnvelope,
  SigningError,
  signPayload,
  toBase64Url,
  verifyEnvelope,
} from './signing/index.js';
export {
  type DraftSkill,
  type LessonEntry,
  LessonParseError,
  SkillLifecycleError,
  type SkillLifecycleState,
} from './types.js';
