/**
 * Skill-Signing types — Phase 5 Gate 2 per ADR-0026 §"Review-Gate" +
 * ADR-0035.
 *
 * Ed25519 signing for skill-promotion approval (ADR-0026) and
 * MSP-Write approval-tokens (ADR-0027 Phase 7 — future). Public-core
 * primitive — claude-os-msp konsumiert dieselbe API.
 *
 * @module @domains/skill-lifecycle/signing/types
 */

/**
 * Ed25519 keypair. Keys are stored as base64-url-encoded raw bytes
 * (32 bytes each — Ed25519 key-size).
 */
export interface Ed25519KeyPair {
  /** Raw 32-byte public-key, base64-url-encoded (no padding). */
  readonly publicKeyB64: string;
  /** Raw 32-byte private-key SEED, base64-url-encoded (no padding).
   *  Never log, never leak to non-keyring storage. */
  readonly privateKeyB64: string;
}

/**
 * A payload + its detached Ed25519 signature + the public-key used to
 * sign it (so verifiers can pick up the key without external context).
 *
 * The signed-bytes are `SHA-256(canonicalize(payload))` — canonical
 * JSON stringification with sorted object-keys for deterministic
 * signing across systems.
 */
export interface SignedEnvelope<P = unknown> {
  /** Original payload — JSON-serializable. Caller defines the shape. */
  readonly payload: P;
  /** Base64-url ed25519 signature (64 bytes). */
  readonly signatureB64: string;
  /** Base64-url ed25519 public-key (32 bytes). Lets verifiers self-resolve. */
  readonly publicKeyB64: string;
  /** ISO-8601 timestamp the signature was produced (informational). */
  readonly signedAt: string;
  /** Algorithm name — frozen to `ed25519-sha256-canonjson` for v1. */
  readonly algorithm: 'ed25519-sha256-canonjson';
}

export class SigningError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'keypair-generation-failed'
      | 'invalid-private-key'
      | 'invalid-public-key'
      | 'invalid-signature'
      | 'canonicalization-failed'
      | 'verify-failed',
  ) {
    super(message);
    this.name = 'SigningError';
  }
}
