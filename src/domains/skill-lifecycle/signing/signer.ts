/**
 * Sign + verify helpers — Ed25519 over SHA-256(canonical-JSON).
 *
 * Sign:
 *   1. canonicalizeJson(payload) → deterministic string
 *   2. SHA-256(string) → 32-byte hash  (Node's Ed25519 sign() can take
 *                                       the message directly; we use
 *                                       hash-of-canonical-json to keep
 *                                       large payloads small + uniform)
 *   3. Ed25519-sign(hash) → 64-byte signature
 *   4. base64-url-encode the signature
 *
 * Verify is the inverse with a constant-time crypto.verify().
 *
 * @module @domains/skill-lifecycle/signing/signer
 */
import type { Buffer } from 'node:buffer';
import { createHash, sign, verify } from 'node:crypto';
import { canonicalizeJson } from './canonical.js';
import { fromBase64Url, importPrivateKey, importPublicKey, toBase64Url } from './keypair.js';
import { type SignedEnvelope, SigningError } from './types.js';

const ALGORITHM = 'ed25519-sha256-canonjson';

function payloadDigest(payload: unknown): Buffer {
  const canonical = canonicalizeJson(payload);
  return createHash('sha256').update(canonical, 'utf8').digest();
}

/**
 * Sign `payload` with the given private-key. Returns a self-contained
 * `SignedEnvelope` carrying payload + signature + public-key + timestamp.
 */
export function signPayload<P>(
  payload: P,
  privateKeyB64: string,
  publicKeyB64: string,
  opts: { now?: () => Date } = {},
): SignedEnvelope<P> {
  const now = opts.now ?? (() => new Date());
  const digest = payloadDigest(payload);
  const privateKey = importPrivateKey(privateKeyB64);
  let sigBuf: Buffer;
  try {
    sigBuf = sign(null, digest, privateKey);
  } catch (err) {
    throw new SigningError(`sign failed: ${(err as Error).message}`, 'invalid-private-key');
  }
  return {
    payload,
    signatureB64: toBase64Url(sigBuf as Buffer),
    publicKeyB64,
    signedAt: now().toISOString(),
    algorithm: ALGORITHM,
  };
}

/**
 * Verify the signature on a SignedEnvelope. Returns true on match,
 * false on signature-mismatch or tamper.
 *
 * Throws SigningError only for STRUCTURAL failures (wrong algorithm,
 * malformed key) — signature-mismatch is a normal boolean false, not
 * an exception (callers branch on the result).
 *
 * Optional `expectedPublicKeyB64`: if given, the envelope's
 * `publicKeyB64` MUST match — defends against an attacker who swapped
 * in their own keypair and re-signed. Set this when you have a trust-
 * anchored pubkey (e.g. from the Keyring).
 */
export function verifyEnvelope<P>(
  envelope: SignedEnvelope<P>,
  opts: { expectedPublicKeyB64?: string } = {},
): boolean {
  if (envelope.algorithm !== ALGORITHM) {
    throw new SigningError(
      `unsupported algorithm "${envelope.algorithm}" — expected "${ALGORITHM}"`,
      'invalid-signature',
    );
  }
  if (
    opts.expectedPublicKeyB64 !== undefined &&
    opts.expectedPublicKeyB64 !== envelope.publicKeyB64
  ) {
    // Don't even try to verify with a non-trust-anchored key — just
    // return false. Verifier explicitly said: only trust this pubkey.
    return false;
  }
  const digest = payloadDigest(envelope.payload);
  const publicKey = importPublicKey(envelope.publicKeyB64);
  let sigBuf: Buffer;
  try {
    sigBuf = fromBase64Url(envelope.signatureB64);
  } catch {
    return false;
  }
  if (sigBuf.length !== 64) return false;
  try {
    return verify(null, digest, publicKey, sigBuf);
  } catch {
    return false;
  }
}
