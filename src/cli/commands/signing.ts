/**
 * `claude-os signing` — Yannik's Ed25519 signing-keypair lifecycle.
 *
 * Subcommands:
 *   init    — generate-or-load the keypair, print public-key
 *   status  — show whether keypair exists + which backend stores it
 *   rotate  — destroy + regenerate keypair (requires --confirm)
 *
 * Per ADR-0035 — used by skill-promote and MSP-write approval-tokens.
 * Private key NEVER prints (per ADR-0004 §51). Public key is the
 * trust-anchor identity and IS safe to display.
 *
 * @module @cli/commands/signing
 */
import type { Command } from 'commander';
import { createSecretStore } from '../../domains/secrets/index.js';
import {
  loadOrCreateSigningKeypair,
  readPublicKey,
  rotateSigningKeypair,
  SIGNING_KEY_NAMES,
} from '../../domains/skill-lifecycle/index.js';
import { type GlobalOpts, printErr, printJson, printLine } from '../output.js';

export function registerSigningCommand(program: Command): void {
  const signing = program
    .command('signing')
    .description("Yannik's Ed25519 signing-keypair (ADR-0035)");

  signing
    .command('init')
    .description('Generate or load the signing keypair; print the public key')
    .action(async (_opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOpts>();
      try {
        const store = createSecretStore();
        const { keypair, created } = await loadOrCreateSigningKeypair(store);
        if (globals.json === true) {
          printJson({
            ok: true,
            action: 'init',
            created,
            backend: store.backend,
            publicKey: keypair.publicKeyB64,
            secretNames: {
              private: SIGNING_KEY_NAMES.PRIVATE,
              public: SIGNING_KEY_NAMES.PUBLIC,
            },
          });
        } else {
          printLine(
            `[OK] signing keypair ${created ? 'created' : 'already-present'} (backend=${store.backend})`,
          );
          printLine(`     public-key: ${keypair.publicKeyB64}`);
          printLine('     private-key NEVER printed (per ADR-0004 §51)');
        }
      } catch (err) {
        printErr(`signing init: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  signing
    .command('status')
    .description('Show whether the signing keypair is initialized')
    .action(async (_opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOpts>();
      try {
        const store = createSecretStore();
        const publicKey = await readPublicKey(store);
        const initialized = publicKey !== null;
        if (globals.json === true) {
          printJson({
            ok: true,
            action: 'status',
            initialized,
            backend: store.backend,
            ...(publicKey === null ? {} : { publicKey }),
          });
          return;
        }
        if (!initialized) {
          printLine('[WARN] signing keypair not initialized');
          printLine('       run: claude-os signing init');
          process.exit(2);
        }
        printLine(`[OK] signing keypair present (backend=${store.backend})`);
        printLine(`     public-key: ${publicKey}`);
      } catch (err) {
        printErr(`signing status: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  signing
    .command('rotate')
    .description('Destroy + regenerate the signing keypair (requires --confirm)')
    .option('--confirm', 'Confirm the destructive rotation', false)
    .action(async (opts: { confirm?: boolean }, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOpts>();
      if (opts.confirm !== true) {
        printErr(
          'signing rotate: refusing without --confirm. Rotation invalidates every previously-signed envelope.',
        );
        process.exit(2);
      }
      try {
        const store = createSecretStore();
        const fresh = await rotateSigningKeypair(store);
        if (globals.json === true) {
          printJson({
            ok: true,
            action: 'rotate',
            backend: store.backend,
            publicKey: fresh.publicKeyB64,
          });
        } else {
          printLine(`[OK] signing keypair rotated (backend=${store.backend})`);
          printLine(`     new public-key: ${fresh.publicKeyB64}`);
          printLine(
            '     ALL previously-signed envelopes (approval-tokens, skill-promote signatures) are now untrusted.',
          );
        }
      } catch (err) {
        printErr(`signing rotate: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
