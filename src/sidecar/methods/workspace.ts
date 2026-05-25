/**
 * Workspace-Namespace RPCs (Phase 2f): current, list, use.
 *
 * Mirrors the CLI `claude-os workspace` command surface (Phase 2a) over
 * stdio-NDJSON for the Tauri GUI. Notification: emits
 * `workspace://switched` after a successful `workspace.use`.
 *
 * @module @sidecar/methods/workspace
 */
import {
  classifyWorkspace,
  listWorkspaces,
  logWorkspaceSwitch,
  readActiveWorkspace,
  resolveVaultRoot,
  resolveWorkspacePath,
  type Workspace,
  WorkspaceError,
  workspaceExists,
  writeActiveWorkspace,
} from '../../domains/workspace/index.js';
import type { RpcDispatcher } from '../rpc.js';
import { requireString } from './_shared.js';

interface CurrentResponse {
  readonly active: string;
  readonly kind: ReturnType<typeof classifyWorkspace>;
  readonly switchedAt: string;
  readonly path: string | null;
  readonly vaultPath: string;
}

interface ListResponse {
  readonly active: string;
  readonly vaultPath: string;
  readonly workspaces: readonly Workspace[];
}

interface UseResponse {
  readonly from: string;
  readonly to: string;
  readonly switchedAt: string;
}

function resolveVaultOrThrow(): string {
  try {
    return resolveVaultRoot();
  } catch (err) {
    if (err instanceof WorkspaceError) throw err;
    throw new WorkspaceError(`vault resolution failed: ${(err as Error).message}`);
  }
}

export function registerWorkspaceMethods(
  dispatcher: RpcDispatcher,
  emit: (method: string, params: unknown) => void,
): void {
  dispatcher.register('workspace.current', (): CurrentResponse => {
    const vault = resolveVaultOrThrow();
    const state = readActiveWorkspace();
    const path = workspaceExists(vault, state.active)
      ? resolveWorkspacePath(vault, state.active)
      : null;
    return {
      active: state.active,
      kind: classifyWorkspace(state.active),
      switchedAt: state.switchedAt,
      path,
      vaultPath: vault,
    };
  });

  dispatcher.register('workspace.list', (): ListResponse => {
    const vault = resolveVaultOrThrow();
    const state = readActiveWorkspace();
    return {
      active: state.active,
      vaultPath: vault,
      workspaces: listWorkspaces(vault),
    };
  });

  dispatcher.register('workspace.use', (params): UseResponse => {
    const id = requireString((params as { id?: unknown } | undefined)?.id, 'id', 'workspace.use');
    // Validate vault is configured before persisting — fail-fast for
    // misconfigured installs (the GUI would otherwise persist an
    // active-workspace pointer that can't be resolved later).
    resolveVaultOrThrow();
    const prev = readActiveWorkspace();
    const next = writeActiveWorkspace(id);
    logWorkspaceSwitch({
      from: prev.active === next.active ? null : prev.active,
      to: next.active,
      source: 'gui',
    });
    // Frontend subscribers can refresh widgets on this notification.
    emit('workspace://switched', { from: prev.active, to: next.active });
    return {
      from: prev.active,
      to: next.active,
      switchedAt: next.switchedAt,
    };
  });
}
