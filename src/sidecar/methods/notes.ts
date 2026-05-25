/**
 * Notes-Namespace RPCs (Phase 2f): save, list.
 *
 * `notes.save` writes a frontmatter-validated markdown note via the
 * Phase-2b writer. `notes.list` returns the (parsed) notes in a
 * workspace for GUI listings.
 *
 * @module @sidecar/methods/notes
 */
import {
  listNotes as listNotesDomain,
  type NoteFrontmatter,
  NotesError,
  writeNote,
} from '../../domains/notes/index.js';
import {
  readActiveWorkspace,
  resolveVaultRoot,
  WorkspaceError,
} from '../../domains/workspace/index.js';
import type { RpcDispatcher } from '../rpc.js';
import { requireString } from './_shared.js';

interface SaveParams {
  readonly filename: string;
  readonly body: string;
  readonly frontmatter: Record<string, unknown>;
  readonly workspace?: string;
  readonly overwrite?: boolean;
}

interface SaveResponse {
  readonly path: string;
  readonly created: boolean;
  readonly workspace: string;
}

interface ListParams {
  readonly workspace?: string;
  readonly recursive?: boolean;
  readonly limit?: number;
}

interface ListItem {
  readonly path: string;
  readonly workspace: string;
  readonly frontmatter: NoteFrontmatter;
  /** First ~400 chars of body for preview. */
  readonly preview: string;
}

const DEFAULT_LIST_LIMIT = 200;
const PREVIEW_CHARS = 400;

function resolveVaultOrThrow(): string {
  try {
    return resolveVaultRoot();
  } catch (err) {
    if (err instanceof WorkspaceError) throw err;
    throw new WorkspaceError(`vault resolution failed: ${(err as Error).message}`);
  }
}

export function registerNotesMethods(dispatcher: RpcDispatcher): void {
  dispatcher.register('notes.save', (raw): SaveResponse => {
    const p = (raw ?? {}) as Partial<SaveParams>;
    const filename = requireString(p.filename, 'filename', 'notes.save');
    if (typeof p.body !== 'string') {
      throw new Error('notes.save: params.body muss ein string sein');
    }
    if (p.frontmatter === undefined || typeof p.frontmatter !== 'object') {
      throw new Error('notes.save: params.frontmatter muss ein Objekt sein');
    }
    const vault = resolveVaultOrThrow();
    const workspaceId = p.workspace ?? readActiveWorkspace().active;
    const fm = { ...p.frontmatter, workspace: workspaceId } as NoteFrontmatter;
    const res = writeNote(vault, workspaceId, filename, fm, p.body, {
      overwrite: p.overwrite === true,
    });
    return {
      path: res.path,
      created: res.created,
      workspace: workspaceId,
    };
  });

  dispatcher.register('notes.list', (raw): readonly ListItem[] => {
    const p = (raw ?? {}) as Partial<ListParams>;
    const vault = resolveVaultOrThrow();
    const workspaceId = p.workspace ?? readActiveWorkspace().active;
    const limit =
      typeof p.limit === 'number' && Number.isInteger(p.limit) && p.limit > 0
        ? p.limit
        : DEFAULT_LIST_LIMIT;
    const notes = listNotesDomain(vault, workspaceId, {
      recursive: p.recursive === true,
    });
    return notes.slice(0, limit).map((n) => ({
      path: n.path,
      workspace: n.workspace,
      frontmatter: n.frontmatter,
      preview: n.body.slice(0, PREVIEW_CHARS),
    }));
  });
}

// Re-export so the orchestrator can import NotesError consistently.
export { NotesError };
