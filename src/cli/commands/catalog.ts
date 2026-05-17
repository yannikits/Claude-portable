/**
 * `claude-os catalog` — plugin/skill catalog CLI (Phase 5h).
 *
 * Replaces the Phase 3a stub. v1 surfaces:
 *   install <source>     resolve + fetch + extract a tarball
 *   resolve <plugin>     dry-run capability resolution against a
 *                        passed-in manifest file (JSON)
 *   list / lock / sync / enable / disable / uninstall / update
 *     not in v1 MVP — emit a hint pointing to Phase 6 sidecar where
 *     the full catalog.json + lock-file lifecycle will land
 *
 * @module @cli/commands/catalog
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { resolveRoot, RootNotFoundError } from '../../core/environment/index.js';
import { resolveMachinePaths } from '../../core/paths/index.js';
import {
  SourceParseError,
  TarballInstallError,
  githubTarballUrl,
  installFromTarball,
  parseSource,
  resolveCapabilities,
  tarballCacheDirFor,
  type Catalog,
  type PluginManifest,
} from '../../domains/catalog/index.js';

interface GlobalOpts {
  readonly root?: string;
  readonly json?: boolean;
}

function printJson(payload: unknown): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(JSON.stringify(payload, null, 2));
}

function printLine(line: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(line);
}

function printErr(line: string): void {
  // biome-ignore lint/suspicious/noConsole: stderr reporter
  console.error(line);
}

async function actInstall(globals: GlobalOpts, raw: string): Promise<void> {
  let parsed;
  try {
    parsed = parseSource(raw);
  } catch (err) {
    if (err instanceof SourceParseError) {
      printErr(`catalog install: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (parsed.kind === 'marketplace') {
    printErr(
      'catalog install: marketplace: sources require a marketplace registry. v1 ships ' +
        'the registry primitives (Phase 5f) but no curated registry yet. Use a ' +
        'github: source for now.',
    );
    process.exit(2);
  }

  if (parsed.kind === 'local') {
    printErr(
      'catalog install: local: sources are recognised by the parser but the install path ' +
        'is staged for a later iteration. Copy the directory manually for now.',
    );
    process.exit(2);
  }

  let machinePaths: ReturnType<typeof resolveMachinePaths>;
  let destination: string;
  try {
    const root = resolveRoot(globals.root === undefined ? {} : { explicit: globals.root });
    machinePaths = resolveMachinePaths();
    destination = join(root.path, 'config', 'skills', parsed.repo);
  } catch (err) {
    if (err instanceof RootNotFoundError) {
      printErr(`catalog install: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const cacheDir = tarballCacheDirFor(machinePaths.dataRoot);
  const url = githubTarballUrl(parsed);

  try {
    const result = await installFromTarball({
      url,
      cacheDir,
      destination,
      stripComponents: 1,
    });
    if (globals.json === true) {
      printJson({ ok: true, source: parsed, install: result });
    } else {
      printLine(`[OK] installed ${parsed.owner}/${parsed.repo} -> ${destination}`);
      printLine(
        `     sha256=${result.sha256.slice(0, 12)}... cached=${result.alreadyCached} bytes=${result.bytesDownloaded}`,
      );
    }
  } catch (err) {
    if (err instanceof TarballInstallError) {
      printErr(`catalog install: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

function actResolve(globals: GlobalOpts, manifestPath: string): void {
  if (!existsSync(manifestPath)) {
    printErr(`catalog resolve: manifest file does not exist: ${manifestPath}`);
    process.exit(1);
  }
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    printErr(
      `catalog resolve: cannot read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(raw) as PluginManifest;
  } catch {
    printErr(`catalog resolve: ${manifestPath} is not valid JSON`);
    process.exit(1);
  }
  const catalog: Catalog = { plugins: [] };
  const result = resolveCapabilities(manifest, catalog);
  if (globals.json === true) {
    printJson(result);
    return;
  }
  if (result.ok) {
    printLine(`[OK] resolved ${manifest.id}@${manifest.version}`);
    if (result.result.installOrder.length === 1) {
      printLine('     no dependencies to install.');
    } else {
      printLine(`     install order: ${result.result.installOrder.map((m) => m.id).join(' -> ')}`);
    }
    return;
  }
  printErr(`[FAIL] catalog resolve ${manifest.id}: ${result.error.name}: ${result.error.message}`);
  process.exit(1);
}

function notInMvp(globals: GlobalOpts, action: string): void {
  const hint =
    `catalog ${action}: not in v1 MVP. The catalog.json + catalog.lock.json ` +
    'lifecycle is staged for Phase 6 sidecar integration. The Phase 5 domain ' +
    'primitives (BackupManager, MarketplaceRegistry, ScopeMerger, ' +
    'CapabilityResolver) are shipped and unit-tested.';
  if (globals.json === true) {
    printJson({ ok: false, action, hint });
  } else {
    printErr(hint);
  }
  process.exit(2);
}

export function registerCatalogCommand(program: Command): void {
  const catalog = program.command('catalog').description('Plugin/skill catalog (ADR-0009 + 0010)');

  catalog
    .command('install <source>')
    .description('Install a plugin from github:owner/repo source (marketplace + local staged)')
    .action(async (source: string, _opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOpts>();
      await actInstall(globals, source);
    });

  catalog
    .command('resolve <manifestFile>')
    .description('Dry-run capability resolution against a passed-in plugin.json file')
    .action((manifestPath: string, _opts: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOpts>();
      actResolve(globals, manifestPath);
    });

  for (const sub of ['list', 'uninstall', 'enable', 'disable', 'update', 'lock', 'sync']) {
    catalog
      .command(sub)
      .description(`${sub} — staged for catalog.json lifecycle (Phase 6 sidecar)`)
      .action((_opts: unknown, command: Command) => {
        notInMvp(command.optsWithGlobals<GlobalOpts>(), sub);
      });
  }
}
