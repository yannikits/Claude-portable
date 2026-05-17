import { join } from 'node:path';
import { resolveRoot } from '../core/environment/index.js';
import { resolveMachinePaths } from '../core/paths/index.js';
import { AgentRunsRepository, agentRunsIndexPathFor } from '../domains/agent-runs/index.js';
import { catalogPathsFor, readCatalog, readCatalogLock } from '../domains/catalog/index.js';
import { BusyFlag, loadVaultConfig } from '../domains/vault-sync/index.js';
import type { RpcDispatcher } from './rpc.js';

function rootPath(): string {
  return resolveRoot({}).path;
}

export function registerMethods(dispatcher: RpcDispatcher): void {
  dispatcher.register('catalog.list', () => {
    const paths = catalogPathsFor(rootPath());
    const catalog = readCatalog(paths.catalogPath);
    const lock = readCatalogLock(paths.lockPath);
    return {
      catalogPath: paths.catalogPath,
      lockPath: paths.lockPath,
      lockResolvedAt: lock?.resolvedAt ?? null,
      entries: catalog.entries,
    };
  });

  dispatcher.register('vault.status', () => {
    const root = rootPath();
    const machine = resolveMachinePaths();
    const vaultPath = join(root, 'vault');
    const busyFlagPath = join(machine.dataDir, 'vault-sync-state.json');
    const configPath = join(machine.dataDir, 'vault-config.json');
    const busy = new BusyFlag({ filePath: busyFlagPath }).read();
    const config = loadVaultConfig(configPath);
    return { vaultPath, busy, config };
  });

  dispatcher.register('agent.list', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as { project?: string; limit?: number };
    const root = rootPath();
    const machine = resolveMachinePaths();
    const repo = new AgentRunsRepository({
      agentRunsRoot: join(root, 'vault', 'agent-runs'),
      indexPath: agentRunsIndexPathFor(machine.dataDir),
      vaultRoot: join(root, 'vault'),
    });
    const items = repo.list({
      ...(params.project === undefined ? {} : { project: params.project }),
      ...(params.limit === undefined ? {} : { limit: params.limit }),
    });
    return { count: items.length, items };
  });
}
