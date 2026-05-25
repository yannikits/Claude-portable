/**
 * Workspace-Indicator — Dashboard-Header-Widget.
 *
 * Shows the active workspace + a dropdown to switch. Subscribes to
 * the `workspace://switched` notification so any other surface that
 * switches keeps this widget in sync.
 *
 * Phase 2f (Memory MVP GUI), wires to sidecar RPCs from Phase 2a/2f.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getWorkspaceCurrent,
  getWorkspaceList,
  onWorkspaceSwitched,
  switchWorkspace,
  type WorkspaceCurrent,
  type WorkspaceEntry,
} from '../lib/rpc';

interface State {
  current: WorkspaceCurrent | null;
  workspaces: WorkspaceEntry[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: State = {
  current: null,
  workspaces: [],
  loading: true,
  error: null,
};

export function WorkspaceIndicator() {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([getWorkspaceCurrent(), getWorkspaceList()]);
      setState({ current, workspaces: list.workspaces, loading: false, error: null });
    } catch (err) {
      setState({
        current: null,
        workspaces: [],
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    void onWorkspaceSwitched(() => {
      void refresh();
    }).then((u) => {
      unsub = u;
    });
    return () => {
      unsub?.();
    };
  }, [refresh]);

  const handleSwitch = useCallback(
    async (id: string) => {
      if (state.current?.active === id) return;
      setSwitching(true);
      try {
        await switchWorkspace(id);
        // refresh() is also triggered by the workspace://switched event,
        // but call it explicitly so the UI updates without waiting for
        // the round-trip notification.
        await refresh();
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setSwitching(false);
      }
    },
    [state.current?.active, refresh],
  );

  if (state.loading) {
    return <div className="workspace-indicator">Workspace: …</div>;
  }
  if (state.error !== null) {
    return (
      <div className="workspace-indicator workspace-indicator--error" title={state.error}>
        Workspace: <strong>nicht konfiguriert</strong> (CLAUDE_OS_VAULT_PATH fehlt)
      </div>
    );
  }
  if (state.current === null) {
    return <div className="workspace-indicator">Workspace: —</div>;
  }
  return (
    <div className="workspace-indicator">
      <label htmlFor="workspace-select">Workspace:</label>{' '}
      <select
        id="workspace-select"
        value={state.current.active}
        disabled={switching}
        onChange={(e) => {
          void handleSwitch(e.target.value);
        }}
      >
        {state.workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.id}
            {w.path === null ? ' (not yet created)' : ''}
          </option>
        ))}
        {state.workspaces.some((w) => w.id === state.current?.active) ? null : (
          <option value={state.current.active}>{state.current.active} (orphan)</option>
        )}
      </select>{' '}
      <span className="workspace-indicator__kind">[{state.current.kind}]</span>
    </div>
  );
}
