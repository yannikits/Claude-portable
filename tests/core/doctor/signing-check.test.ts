import { describe, expect, it } from 'vitest';
import { checkSigningKeypair } from '../../../src/core/doctor/index.js';

describe('checkSigningKeypair', () => {
  it('skips with ok when CLAUDE_OS_AUTH_TOKEN is unset (Tauri-mode)', async () => {
    const result = await checkSigningKeypair({});
    expect(result.severity).toBe('ok');
    expect(result.message).toContain('not in server mode');
  });

  it('returns ok when both keys present', async () => {
    const result = await checkSigningKeypair({ CLAUDE_OS_AUTH_TOKEN: 'token' }, async () => ({
      hasPublic: true,
      hasPrivate: true,
      backend: 'keyring',
    }));
    expect(result.severity).toBe('ok');
    expect(result.message).toContain('keyring');
  });

  it('returns warn when no keys at all (lazy init expected)', async () => {
    const result = await checkSigningKeypair({ CLAUDE_OS_AUTH_TOKEN: 'token' }, async () => ({
      hasPublic: false,
      hasPrivate: false,
      backend: 'encrypted-file',
    }));
    expect(result.severity).toBe('warn');
    expect(result.message).toContain('not initialized');
    expect(result.hint).toContain('claude-os signing init');
  });

  it('returns fail on half-state (only-public)', async () => {
    const result = await checkSigningKeypair({ CLAUDE_OS_AUTH_TOKEN: 'token' }, async () => ({
      hasPublic: true,
      hasPrivate: false,
      backend: 'encrypted-file',
    }));
    expect(result.severity).toBe('fail');
    expect(result.message).toContain('half-state');
    expect(result.hint).toContain('claude-os signing rotate');
  });

  it('returns fail on half-state (only-private)', async () => {
    const result = await checkSigningKeypair({ CLAUDE_OS_AUTH_TOKEN: 'token' }, async () => ({
      hasPublic: false,
      hasPrivate: true,
      backend: 'encrypted-file',
    }));
    expect(result.severity).toBe('fail');
    expect(result.message).toContain('half-state');
  });
});
