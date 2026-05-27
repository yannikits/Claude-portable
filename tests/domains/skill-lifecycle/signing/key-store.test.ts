import { describe, expect, it } from 'vitest';
import type { SecretMetadata, SecretStore } from '../../../../src/domains/secrets/index.js';
import {
  loadOrCreateSigningKeypair,
  readPublicKey,
  rotateSigningKeypair,
  SIGNING_KEY_NAMES,
} from '../../../../src/domains/skill-lifecycle/signing/index.js';

class FakeSecretStore implements SecretStore {
  readonly backend = 'encrypted-file' as const;
  private readonly bag = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.bag.has(key) ? (this.bag.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.bag.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.bag.delete(key);
  }
  async list(): Promise<readonly SecretMetadata[]> {
    return [...this.bag.keys()].map((k) => ({ key: k, backend: this.backend }));
  }
}

describe('loadOrCreateSigningKeypair', () => {
  it('generates + persists a fresh keypair on first call', async () => {
    const store = new FakeSecretStore();
    const { keypair, created } = await loadOrCreateSigningKeypair(store);
    expect(created).toBe(true);
    expect(keypair.privateKeyB64.length).toBeGreaterThanOrEqual(42);
    expect(keypair.publicKeyB64.length).toBeGreaterThanOrEqual(42);
    expect(await store.get(SIGNING_KEY_NAMES.PRIVATE)).toBe(keypair.privateKeyB64);
    expect(await store.get(SIGNING_KEY_NAMES.PUBLIC)).toBe(keypair.publicKeyB64);
  });

  it('returns the same keypair on subsequent calls (no regen)', async () => {
    const store = new FakeSecretStore();
    const first = await loadOrCreateSigningKeypair(store);
    const second = await loadOrCreateSigningKeypair(store);
    expect(second.created).toBe(false);
    expect(second.keypair.privateKeyB64).toBe(first.keypair.privateKeyB64);
    expect(second.keypair.publicKeyB64).toBe(first.keypair.publicKeyB64);
  });

  it('overwrites half-state (only private exists) with fresh keypair', async () => {
    const store = new FakeSecretStore();
    await store.set(SIGNING_KEY_NAMES.PRIVATE, 'orphan-private');
    const result = await loadOrCreateSigningKeypair(store);
    expect(result.created).toBe(true);
    expect(result.keypair.privateKeyB64).not.toBe('orphan-private');
    expect(await store.get(SIGNING_KEY_NAMES.PUBLIC)).toBe(result.keypair.publicKeyB64);
  });
});

describe('readPublicKey', () => {
  it('returns null when not initialized', async () => {
    const store = new FakeSecretStore();
    expect(await readPublicKey(store)).toBeNull();
  });

  it('returns the public key after init', async () => {
    const store = new FakeSecretStore();
    const { keypair } = await loadOrCreateSigningKeypair(store);
    expect(await readPublicKey(store)).toBe(keypair.publicKeyB64);
  });
});

describe('rotateSigningKeypair', () => {
  it('replaces existing keypair with a fresh one', async () => {
    const store = new FakeSecretStore();
    const first = await loadOrCreateSigningKeypair(store);
    const rotated = await rotateSigningKeypair(store);
    expect(rotated.privateKeyB64).not.toBe(first.keypair.privateKeyB64);
    expect(rotated.publicKeyB64).not.toBe(first.keypair.publicKeyB64);
    expect(await store.get(SIGNING_KEY_NAMES.PRIVATE)).toBe(rotated.privateKeyB64);
    expect(await store.get(SIGNING_KEY_NAMES.PUBLIC)).toBe(rotated.publicKeyB64);
  });
});
