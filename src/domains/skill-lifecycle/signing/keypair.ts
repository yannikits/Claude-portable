/**
 * Ed25519 keypair generation + base64-url encoding helpers.
 *
 * Uses Node's built-in `crypto.generateKeyPairSync('ed25519')` — no
 * external dependency. Returns raw 32-byte seed + 32-byte public-key,
 * base64-url-encoded (no padding) — fits in env-vars + URL-safe.
 *
 * @module @domains/skill-lifecycle/signing/keypair
 */

import { Buffer } from 'node:buffer';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { type Ed25519KeyPair, SigningError } from './types.js';

const ED25519_PRIVATE_DER_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_PUBLIC_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with `=` to next multiple of 4
  const pad = padded.length % 4;
  const fullyPadded = pad === 0 ? padded : padded + '='.repeat(4 - pad);
  return Buffer.from(fullyPadded, 'base64');
}

/**
 * Generates a new Ed25519 keypair. Returns base64-url-encoded raw
 * bytes (32 bytes seed + 32 bytes public-key).
 */
export function generateEd25519Keypair(): Ed25519KeyPair {
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
    // Strip the DER prefix to get the raw 32-byte seed/public-key.
    const pubRaw = pubDer.subarray(pubDer.length - 32);
    const privRaw = privDer.subarray(privDer.length - 32);
    return {
      publicKeyB64: toBase64Url(pubRaw as Buffer),
      privateKeyB64: toBase64Url(privRaw as Buffer),
    };
  } catch (err) {
    throw new SigningError(
      `keypair generation failed: ${(err as Error).message}`,
      'keypair-generation-failed',
    );
  }
}

/**
 * Re-hydrates a raw 32-byte private-key seed into a Node KeyObject —
 * needed because Node's `sign`/`verify` APIs only accept KeyObjects,
 * not raw bytes.
 */
export function importPrivateKey(privateKeyB64: string): KeyObject {
  const raw = fromBase64Url(privateKeyB64);
  if (raw.length !== 32) {
    throw new SigningError(
      `invalid private-key: expected 32 bytes, got ${raw.length}`,
      'invalid-private-key',
    );
  }
  const der = Buffer.concat([ED25519_PRIVATE_DER_PREFIX, raw]);
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch (err) {
    throw new SigningError(
      `private-key import failed: ${(err as Error).message}`,
      'invalid-private-key',
    );
  }
}

/**
 * Re-hydrates a raw 32-byte public-key into a Node KeyObject.
 */
export function importPublicKey(publicKeyB64: string): KeyObject {
  const raw = fromBase64Url(publicKeyB64);
  if (raw.length !== 32) {
    throw new SigningError(
      `invalid public-key: expected 32 bytes, got ${raw.length}`,
      'invalid-public-key',
    );
  }
  const der = Buffer.concat([ED25519_PUBLIC_DER_PREFIX, raw]);
  try {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (err) {
    throw new SigningError(
      `public-key import failed: ${(err as Error).message}`,
      'invalid-public-key',
    );
  }
}

// Re-exports for caller-side base64-url manipulation (test fixtures).
export { fromBase64Url, toBase64Url };
