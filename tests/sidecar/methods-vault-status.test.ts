/**
 * M33 (2026-05-21 code-review): RPC-Tests fuer `vault.status` —
 * verifiziert dass vaultPath, busy + config korrekt aus dem
 * cloud-mount-root + machineDataDir gelesen werden.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerMethods } from '../../src/sidecar/methods.js';
import { RpcDispatcher } from '../../src/sidecar/rpc.js';

describe('vault.status RPC', () => {
  let tmpRoot: string;
  let tmpData: string;
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'claude-os-vstatus-root-'));
    tmpData = mkdtempSync(join(tmpdir(), 'claude-os-vstatus-data-'));
    mkdirSync(join(tmpData, 'data'), { recursive: true });
    writeFileSync(join(tmpRoot, '.claude-os-root'), '');
    envBackup = { ...process.env };
    process.env.CLAUDE_OS_ROOT = tmpRoot;
    process.env.CLAUDE_OS_DATA_DIR = tmpData;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(tmpData, { recursive: true, force: true });
    process.env = envBackup;
  });

  it('returns vaultPath + busy=null + default config when no state files exist', async () => {
    const d = new RpcDispatcher();
    registerMethods(d);
    const result = (await d.invoke('vault.status', {})) as {
      vaultPath: string;
      busy: unknown;
      config: { conflictMode: string };
    };
    expect(result.vaultPath).toBe(join(tmpRoot, 'vault'));
    expect(result.busy).toBeNull();
    // Default config
    expect(result.config.conflictMode).toBe('abort');
  });

  it('returns busy state when vault-sync-state.json exists', async () => {
    writeFileSync(
      join(tmpData, 'data', 'vault-sync-state.json'),
      JSON.stringify({
        busy: true,
        reason: 'snapshot',
        pid: 12345,
        hostname: 'test-host',
        acquiredAt: '2026-05-21T08:00:00.000Z',
      }),
    );
    const d = new RpcDispatcher();
    registerMethods(d);
    const result = (await d.invoke('vault.status', {})) as {
      busy: { busy: boolean; reason: string; pid: number; hostname: string } | null;
    };
    expect(result.busy).not.toBeNull();
    expect(result.busy?.busy).toBe(true);
    expect(result.busy?.reason).toBe('snapshot');
    expect(result.busy?.pid).toBe(12345);
  });

  it('returns custom config when vault-config.json exists', async () => {
    writeFileSync(
      join(tmpData, 'data', 'vault-config.json'),
      JSON.stringify({
        conflictMode: 'prefer-local',
        idleSeconds: 120,
        scheduleEnabled: true,
      }),
    );
    const d = new RpcDispatcher();
    registerMethods(d);
    const result = (await d.invoke('vault.status', {})) as {
      config: { conflictMode: string; idleSeconds: number; scheduleEnabled: boolean };
    };
    expect(result.config.conflictMode).toBe('prefer-local');
    expect(result.config.idleSeconds).toBe(120);
    expect(result.config.scheduleEnabled).toBe(true);
  });
});
