import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  generateEd25519Keypair,
  SigningError,
  signPayload,
  verifyEnvelope,
} from '../../../../src/domains/skill-lifecycle/signing/index.js';

describe('canonicalizeJson', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalizeJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('recurses into nested objects', () => {
    expect(canonicalizeJson({ b: { d: 2, c: 1 }, a: 0 })).toBe('{"a":0,"b":{"c":1,"d":2}}');
  });

  it('drops undefined values (matches JSON spec)', () => {
    expect(canonicalizeJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('handles null', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson({ a: null })).toBe('{"a":null}');
  });

  it('rejects BigInt', () => {
    expect(() => canonicalizeJson({ a: BigInt(1) })).toThrow(SigningError);
  });

  it('rejects Symbol', () => {
    expect(() => canonicalizeJson({ a: Symbol('x') })).toThrow(SigningError);
  });

  it('rejects Function', () => {
    expect(() => canonicalizeJson({ a: () => 1 })).toThrow(SigningError);
  });

  it('produces same output regardless of key insertion order', () => {
    const a = canonicalizeJson({ x: 1, y: { c: 3, a: 1 }, m: [{ k: 1, j: 2 }] });
    const b = canonicalizeJson({ m: [{ j: 2, k: 1 }], y: { a: 1, c: 3 }, x: 1 });
    expect(a).toBe(b);
  });
});

describe('generateEd25519Keypair', () => {
  it('produces a 32-byte (base64url) public + private key', () => {
    const kp = generateEd25519Keypair();
    // 32 bytes → 43 base64url chars (no padding)
    expect(kp.publicKeyB64.length).toBeGreaterThanOrEqual(42);
    expect(kp.privateKeyB64.length).toBeGreaterThanOrEqual(42);
    expect(kp.publicKeyB64).not.toContain('=');
    expect(kp.publicKeyB64).not.toContain('+');
    expect(kp.publicKeyB64).not.toContain('/');
  });

  it('produces a fresh keypair each call', () => {
    const a = generateEd25519Keypair();
    const b = generateEd25519Keypair();
    expect(a.privateKeyB64).not.toBe(b.privateKeyB64);
    expect(a.publicKeyB64).not.toBe(b.publicKeyB64);
  });
});

describe('signPayload + verifyEnvelope roundtrip', () => {
  it('signs and verifies a simple payload', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload(
      { skill: 'vpn-fix', diff: 'add 3 lines' },
      kp.privateKeyB64,
      kp.publicKeyB64,
    );
    expect(env.algorithm).toBe('ed25519-sha256-canonjson');
    expect(env.publicKeyB64).toBe(kp.publicKeyB64);
    expect(verifyEnvelope(env)).toBe(true);
  });

  it('verifies independently of object-key insertion order in payload', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ b: 2, a: 1 }, kp.privateKeyB64, kp.publicKeyB64);
    // Verify uses canonicalize → key-order doesn't matter
    expect(verifyEnvelope(env)).toBe(true);
  });

  it('rejects tampered payload', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ skill: 'vpn-fix' }, kp.privateKeyB64, kp.publicKeyB64);
    const tampered = { ...env, payload: { skill: 'evil-substitute' } };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  it('rejects tampered signature', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ skill: 'vpn-fix' }, kp.privateKeyB64, kp.publicKeyB64);
    // Flip a character in the signature
    const sigChars = env.signatureB64.split('');
    sigChars[0] = sigChars[0] === 'A' ? 'B' : 'A';
    const broken = { ...env, signatureB64: sigChars.join('') };
    expect(verifyEnvelope(broken)).toBe(false);
  });

  it('rejects swap to attacker keypair when expectedPublicKeyB64 is set', () => {
    const yannik = generateEd25519Keypair();
    const attacker = generateEd25519Keypair();
    // Attacker creates their own envelope claiming to be yannik
    const envFromAttacker = signPayload(
      { skill: 'malicious' },
      attacker.privateKeyB64,
      attacker.publicKeyB64,
    );
    // Verifier ONLY trusts yannik's pubkey
    expect(verifyEnvelope(envFromAttacker, { expectedPublicKeyB64: yannik.publicKeyB64 })).toBe(
      false,
    );
  });

  it('throws SigningError on unknown algorithm', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ a: 1 }, kp.privateKeyB64, kp.publicKeyB64);
    const broken = { ...env, algorithm: 'ed25519-sha512-canonjson' as never };
    expect(() => verifyEnvelope(broken)).toThrow(SigningError);
  });

  it('signs deterministically across runs (Ed25519 is deterministic)', () => {
    const kp = generateEd25519Keypair();
    const env1 = signPayload({ a: 1 }, kp.privateKeyB64, kp.publicKeyB64, {
      now: () => new Date('2026-05-27T10:00:00Z'),
    });
    const env2 = signPayload({ a: 1 }, kp.privateKeyB64, kp.publicKeyB64, {
      now: () => new Date('2026-05-27T10:00:00Z'),
    });
    expect(env1.signatureB64).toBe(env2.signatureB64);
  });

  it('respects injected `now` factory for signedAt', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ a: 1 }, kp.privateKeyB64, kp.publicKeyB64, {
      now: () => new Date('2099-12-31T23:59:59Z'),
    });
    expect(env.signedAt).toBe('2099-12-31T23:59:59.000Z');
  });

  it('rejects malformed private key (wrong length)', () => {
    expect(() => signPayload({ a: 1 }, 'too-short', 'AAAA')).toThrow(SigningError);
  });

  it('rejects signature of wrong byte length', () => {
    const kp = generateEd25519Keypair();
    const env = signPayload({ a: 1 }, kp.privateKeyB64, kp.publicKeyB64);
    const short = { ...env, signatureB64: 'short' };
    expect(verifyEnvelope(short)).toBe(false);
  });
});
