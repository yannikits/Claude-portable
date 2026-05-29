/**
 * `claude-os msp` — operational CLI for the MSP-Health-Bridges.
 *
 * Phase 7-B ships `msp probe tanss <slug>` as the user-facing smoke
 * test. It does the full Production wiring (env-var server-URL,
 * secrets-backend apiToken, vault customer-repo) so a green probe here
 * proves the bridge is ready for the Phase-7-E aggregator.
 *
 * Output is intentionally compact — `--json` mirrors the BridgeProbe
 * shape 1:1 for machine consumers.
 *
 * @module @cli/commands/msp
 */
import { join } from 'node:path';
import type { Command } from 'commander';
import { resolveRoot } from '../../core/environment/index.js';
import { TanssBridge } from '../../domains/msp-bridges/tanss/index.js';
import { CustomerRepository } from '../../domains/msp-customers/index.js';
import { createSecretStore } from '../../domains/secrets/index.js';
import { type GlobalOpts, printErr, printJson, printLine } from '../output.js';

const TANSS_API_TOKEN_KEY = 'tanss/apiToken';

interface ProbeOpts {
  readonly serverUrl?: string;
  readonly timeoutMs?: string;
}

function resolveVaultRoot(globals: GlobalOpts): string {
  const root = resolveRoot(globals.root === undefined ? {} : { explicit: globals.root });
  return join(root.path, 'vault');
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--timeout-ms must be a positive integer, got "${raw}"`);
  }
  return n;
}

async function actProbeTanss(slug: string, opts: ProbeOpts, command: Command): Promise<void> {
  const globals = command.optsWithGlobals<GlobalOpts>();
  const json = globals.json === true;

  const serverUrl = opts.serverUrl ?? process.env.CLAUDE_OS_TANSS_SERVER_URL;
  if (serverUrl === undefined || serverUrl.length === 0) {
    printErr(
      'msp probe tanss: server-URL missing. Set $CLAUDE_OS_TANSS_SERVER_URL or pass --server-url <https://...>',
    );
    process.exit(2);
  }

  let timeoutMs: number | undefined;
  try {
    timeoutMs = parseTimeout(opts.timeoutMs);
  } catch (err) {
    printErr(`msp probe tanss: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const vaultRoot = resolveVaultRoot(globals);
  const repo = new CustomerRepository({ vaultRoot, autoCreate: false });
  const customer = await repo.get(slug);
  if (customer === null) {
    printErr(
      `msp probe tanss: customer "${slug}" not found at vault/workspaces/msp-customers/${slug}/`,
    );
    process.exit(1);
  }

  const store = createSecretStore();
  const bridge = new TanssBridge({
    serverUrl,
    getApiToken: () => store.get(TANSS_API_TOKEN_KEY),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

  const probe = await bridge.probe(customer);

  if (json) {
    printJson(probe);
    process.exit(probe.result.kind === 'ok' ? 0 : 1);
  }

  printLine(`[${probe.result.kind === 'ok' ? 'OK' : 'FAIL'}] tanss.probe ${slug}`);
  printLine(`  bridgeKind=${probe.bridgeKind}  durationMs=${probe.durationMs}`);
  printLine(`  result.kind=${probe.result.kind}`);
  if (probe.result.kind === 'ok') {
    const { openCount, totalCount, newestUpdateAt, sample } = probe.result.data;
    printLine(`  openCount=${openCount}  totalCount=${totalCount}`);
    printLine(`  newestUpdateAt=${newestUpdateAt ?? '(none)'}`);
    if (sample !== null) {
      printLine(`  sample.id=${sample.id}  sample.status=${sample.status}`);
      printLine(`  sample.subject="${sample.subject}"`);
    }
  } else if ('message' in probe.result && probe.result.message !== undefined) {
    printLine(`  message=${probe.result.message}`);
  }

  process.exit(probe.result.kind === 'ok' ? 0 : 1);
}

export function registerMspCommand(program: Command): void {
  const msp = program
    .command('msp')
    .description('MSP-Health Read-Bridges (TANSS, Veeam, Sophos, Securepoint, M365)');

  const probe = msp.command('probe').description('Probe a bridge for one customer (read-only)');

  probe
    .command('tanss <slug>')
    .description('Probe the TANSS Read-Bridge for the customer with given slug')
    .option('--server-url <url>', 'Override $CLAUDE_OS_TANSS_SERVER_URL for this invocation')
    .option('--timeout-ms <ms>', 'Override request timeout (default 10000)')
    .action(async (slug: string, opts: ProbeOpts, command: Command) => {
      try {
        await actProbeTanss(slug, opts, command);
      } catch (err) {
        printErr(`msp probe tanss: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
