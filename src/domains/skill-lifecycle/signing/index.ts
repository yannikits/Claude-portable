/**
 * Skill-Signing — Phase 5 Gate 2 (ADR-0026 §"Review-Gate" + ADR-0035).
 *
 * Public-core primitive für signed skill-promotion (Phase 5) und
 * approval-tokens (Phase 7 via ADR-0027). Beide Konsumenten nutzen
 * dieselbe Sign/Verify-API + denselben Yannik-Keypair aus dem
 * SecretStore.
 *
 * @module @domains/skill-lifecycle/signing
 */

export { canonicalizeJson } from './canonical.js';
export {
  type LoadOrCreateResult,
  loadOrCreateSigningKeypair,
  readPublicKey,
  rotateSigningKeypair,
  SIGNING_KEY_NAMES,
} from './key-store.js';
export {
  fromBase64Url,
  generateEd25519Keypair,
  importPrivateKey,
  importPublicKey,
  toBase64Url,
} from './keypair.js';
export { signPayload, verifyEnvelope } from './signer.js';
export { type Ed25519KeyPair, type SignedEnvelope, SigningError } from './types.js';
