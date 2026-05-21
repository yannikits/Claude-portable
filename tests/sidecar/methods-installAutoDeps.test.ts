/**
 * M33 (2026-05-21 code-review): RPC-Tests fuer `catalog.installAutoDeps` —
 * verifiziert Parameter-Validierung + error-shape mapping. Happy-path
 * (echter Marketplace + Tarball-Install) ist in den domain-Tests
 * abgedeckt; hier nur RPC-Layer.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerMethods } from '../../src/sidecar/methods.js';
import { RpcDispatcher } from '../../src/sidecar/rpc.js';

describe('catalog.installAutoDeps RPC', () => {
  let tmpRoot: string;
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'claude-os-ial-'));
    writeFileSync(join(tmpRoot, '.claude-os-root'), '');
    mkdirSync(join(tmpRoot, 'config'), { recursive: true });
    envBackup = { ...process.env };
    process.env.CLAUDE_OS_ROOT = tmpRoot;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    process.env = envBackup;
  });

  it('wirft bei fehlendem oder leerem source', async () => {
    const d = new RpcDispatcher();
    registerMethods(d);
    await expect(d.invoke('catalog.installAutoDeps', {})).rejects.toThrow(
      /params.source muss ein non-empty string sein/,
    );
    await expect(d.invoke('catalog.installAutoDeps', { source: '' })).rejects.toThrow(
      /params.source muss ein non-empty string sein/,
    );
    await expect(d.invoke('catalog.installAutoDeps', { source: 123 })).rejects.toThrow(
      /params.source muss ein non-empty string sein/,
    );
  });

  it('wirft bei fehlendem oder leerem registryPath', async () => {
    const d = new RpcDispatcher();
    registerMethods(d);
    await expect(
      d.invoke('catalog.installAutoDeps', { source: 'github:owner/repo' }),
    ).rejects.toThrow(/params.registryPath muss ein non-empty string sein/);
    await expect(
      d.invoke('catalog.installAutoDeps', { source: 'github:owner/repo', registryPath: '' }),
    ).rejects.toThrow(/params.registryPath muss ein non-empty string sein/);
  });

  it('returns ok:false-shape bei AutoDepsInstallError (nicht-throwing)', async () => {
    // Wenn der registryPath auf ein nicht-existierendes File zeigt,
    // gibt installFromGithubWithAutoDeps `AutoDepsInstallError` zurueck.
    // RPC-Dispatcher mapped das zu {ok:false, code, message}.
    const d = new RpcDispatcher();
    registerMethods(d);
    const result = (await d.invoke('catalog.installAutoDeps', {
      source: 'github:owner/nonexistent-repo',
      registryPath: join(tmpRoot, 'missing-registry.json'),
    })) as { ok?: boolean; code?: string; message?: string };

    expect(result.ok).toBe(false);
    expect(typeof result.code).toBe('string');
    expect(result.message).toBeTruthy();
  });
});
