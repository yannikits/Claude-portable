/**
 * Key-Store — load or create Yannik's Ed25519 signing keypair via the
 * `@domains/secrets` SecretStore (keyring-primary, encrypted-file-
 * fallback per ADR-0004).
 *
 * Key conventions in the SecretStore:
 *   - `claude-os-signing-private-key` — base64-url private key SEED
 *   - `claude-os-signing-public-key` — base64-url public key
 *
 * Private key NEVER leaks to logs (per ADR-0004 §51). Public key is
 * fine to log + display in the GUI (it's the trust-anchor identity).
 *
 * @module @domains/skill-lifecycle/signing/key-store
 */
import type { SecretStore } from '../../secrets/index.js';
import { generateEd25519Keypair } from './keypair.js';
import { type Ed25519KeyPair, SigningError } from './types.js';

const PRIVATE_KEY_NAME = 'claude-os-signing-private-key';
const PUBLIC_KEY_NAME = 'claude-os-signing-public-key';

export interface LoadOrCreateResult {
  readonly keypair: Ed25519KeyPair;
  readonly created: boolean;
}

/**
 * Returns the existing keypair from the SecretStore, or generates +
 * persists a new one if none exists yet.
 *
 * Atomic: if private exists but public doesn't (or vice-versa), the
 * fragment is overwritten with a fresh keypair — keys must come as a
 * pair, half-state is a corruption signal not a partial-init.
 */
export async function loadOrCreateSigningKeypair(store: SecretStore): Promise<LoadOrCreateResult> {
  const [privateB64, publicB64] = await Promise.all([
    store.get(PRIVATE_KEY_NAME),
    store.get(PUBLIC_KEY_NAME),
  ]);

  if (privateB64 !== null && publicB64 !== null) {
    return {
      keypair: { privateKeyB64: privateB64, publicKeyB64: publicB64 },
      created: false,
    };
  }

  // Half-state (or fresh) → generate new keypair + persist.
  const fresh = generateEd25519Keypair();
  try {
    await store.set(PRIVATE_KEY_NAME, fresh.privateKeyB64);
    await store.set(PUBLIC_KEY_NAME, fresh.publicKeyB64);
  } catch (err) {
    throw new SigningError(
      `failed to persist freshly-generated keypair: ${(err as Error).message}`,
      'keypair-generation-failed',
    );
  }
  return { keypair: fresh, created: true };
}

/**
 * Reads only the public key (cheap, no private-key touch). Returns
 * null if the keypair hasn't been initialized yet.
 *
 * Use this in: GUI display, audit-log header, doctor-check.
 */
export async function readPublicKey(store: SecretStore): Promise<string | null> {
  return store.get(PUBLIC_KEY_NAME);
}

/**
 * Forces a key-rotation: generates a fresh keypair, overwrites the
 * existing one. Returns the NEW keypair. Use this when:
 *   - Compromise-suspected (delete-all-signed-skills-after-rotation
 *     policy is a separate concern)
 *   - Yannik wants a clean signing identity for a new machine
 *
 * The OLD keypair is NOT recoverable — caller's responsibility to
 * verify the rotation-intent (e.g. via UI confirm).
 */
export async function rotateSigningKeypair(store: SecretStore): Promise<Ed25519KeyPair> {
  const fresh = generateEd25519Keypair();
  await store.set(PRIVATE_KEY_NAME, fresh.privateKeyB64);
  await store.set(PUBLIC_KEY_NAME, fresh.publicKeyB64);
  return fresh;
}

// Re-export the key names so the audit-log + secrets-list don't drift.
export const SIGNING_KEY_NAMES = {
  PRIVATE: PRIVATE_KEY_NAME,
  PUBLIC: PUBLIC_KEY_NAME,
} as const;
