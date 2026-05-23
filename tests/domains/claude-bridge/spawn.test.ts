import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnClaudeBridge } from '../../../src/domains/claude-bridge/index.js';

/**
 * Integration tests for the streaming spawn wrapper. `binaryPath` is
 * overridden with `process.execPath` (the running Node binary) so the
 * tests don't depend on a real Anthropic claude install. Argument
 * scripts use `-e` so behavior is fully controlled.
 */
describe('spawnClaudeBridge', () => {
  it('resolves with exitCode 0 for a clean child exit', async () => {
    const result = await spawnClaudeBridge({
      binaryPath: process.execPath,
      args: ['-e', 'process.exit(0)'],
      heartbeatIntervalMs: 0,
    });
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.binary.source).toBe('override');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates non-zero exit codes', async () => {
    const result = await spawnClaudeBridge({
      binaryPath: process.execPath,
      args: ['-e', 'process.exit(42)'],
      heartbeatIntervalMs: 0,
    });
    expect(result.exitCode).toBe(42);
  });

  it('rejects with BinaryNotFoundError when binaryPath does not exist', async () => {
    await expect(
      spawnClaudeBridge({
        binaryPath: '/definitely/not/a/real/path/claude',
        args: [],
        heartbeatIntervalMs: 0,
      }),
    ).rejects.toThrow(/Explicit binary path/);
  });

  it('survives running with a non-zero heartbeat interval', async () => {
    const result = await spawnClaudeBridge({
      binaryPath: process.execPath,
      // Sleep ~200 ms so several 50 ms heartbeats land.
      args: ['-e', 'setTimeout(() => process.exit(0), 200)'],
      heartbeatIntervalMs: 50,
    });
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });

  describe('m13_spawn — CLAUDE_OS_SECRETS_KEY stripping', () => {
    let oldSecretsKey: string | undefined;

    beforeEach(() => {
      oldSecretsKey = process.env.CLAUDE_OS_SECRETS_KEY;
      process.env.CLAUDE_OS_SECRETS_KEY = 'super-secret-master-key';
    });

    afterEach(() => {
      if (oldSecretsKey === undefined) delete process.env.CLAUDE_OS_SECRETS_KEY;
      else process.env.CLAUDE_OS_SECRETS_KEY = oldSecretsKey;
    });

    function makeSpawnFnSpy(): {
      spawnFn: NonNullable<Parameters<typeof spawnClaudeBridge>[0]['spawnFn']>;
      capturedEnv: () => NodeJS.ProcessEnv | undefined;
    } {
      let captured: NodeJS.ProcessEnv | undefined;
      const spawnFn = ((_path: string, _args: readonly string[], spawnOpts?: unknown) => {
        captured = (spawnOpts as { env?: NodeJS.ProcessEnv } | undefined)?.env;
        const child = new EventEmitter() as EventEmitter & {
          kill: (signal?: NodeJS.Signals | number) => boolean;
          killed: boolean;
          pid: number;
        };
        child.killed = false;
        child.pid = 99999;
        child.kill = () => true;
        setImmediate(() => child.emit('exit', 0, null));
        return child as unknown as ReturnType<
          NonNullable<Parameters<typeof spawnClaudeBridge>[0]['spawnFn']>
        >;
      }) as NonNullable<Parameters<typeof spawnClaudeBridge>[0]['spawnFn']>;
      return { spawnFn, capturedEnv: () => captured };
    }

    it('strippt CLAUDE_OS_SECRETS_KEY aus dem inherited process.env', async () => {
      const { spawnFn, capturedEnv } = makeSpawnFnSpy();
      await spawnClaudeBridge({
        binaryPath: process.execPath,
        args: ['-e', 'process.exit(0)'],
        heartbeatIntervalMs: 0,
        spawnFn,
      });
      const env = capturedEnv();
      expect(env).toBeDefined();
      expect(env?.CLAUDE_OS_SECRETS_KEY).toBeUndefined();
      // andere Env-Vars muessen bleiben (smoke-check: PATH ist ueberall gesetzt)
      expect(env?.PATH ?? env?.Path).toBeDefined();
    });

    it('strippt CLAUDE_OS_SECRETS_KEY auch wenn explicit opts.env gesetzt ist', async () => {
      const { spawnFn, capturedEnv } = makeSpawnFnSpy();
      await spawnClaudeBridge({
        binaryPath: process.execPath,
        args: ['-e', 'process.exit(0)'],
        heartbeatIntervalMs: 0,
        env: { CUSTOM_VAR: 'value', CLAUDE_OS_SECRETS_KEY: 'leaked' },
        spawnFn,
      });
      const env = capturedEnv();
      expect(env).toBeDefined();
      expect(env?.CLAUDE_OS_SECRETS_KEY).toBeUndefined();
      expect(env?.CUSTOM_VAR).toBe('value');
    });
  });
});
