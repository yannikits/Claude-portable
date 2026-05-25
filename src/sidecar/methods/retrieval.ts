/**
 * Retrieval-Namespace RPCs (Phase 2f): search.
 *
 * Linear-scan BM25 retrieval (Phase 2c) exposed to the GUI. Workspace-
 * scoped by default (active workspace or `--workspace`); cross-workspace
 * search remains an explicit caller-iteration (ADR-0031).
 *
 * @module @sidecar/methods/retrieval
 */
import type { Note } from '../../domains/notes/index.js';
import { searchWorkspace } from '../../domains/retrieval/index.js';
import {
  readActiveWorkspace,
  resolveVaultRoot,
  WorkspaceError,
} from '../../domains/workspace/index.js';
import type { RpcDispatcher } from '../rpc.js';
import { requireString } from './_shared.js';

interface SearchParams {
  readonly text: string;
  readonly workspace?: string;
  readonly topK?: number;
  readonly includeEphemeral?: boolean;
  readonly recursive?: boolean;
}

interface SearchHitDto {
  readonly path: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly preview: string;
  readonly frontmatter: Note['frontmatter'];
}

interface SearchResponse {
  readonly query: string;
  readonly tokens: readonly string[];
  readonly hits: readonly SearchHitDto[];
  readonly totalScanned: number;
  readonly durationMs: number;
  readonly workspace: string;
}

const HIT_PREVIEW_CHARS = 320;

function resolveVaultOrThrow(): string {
  try {
    return resolveVaultRoot();
  } catch (err) {
    if (err instanceof WorkspaceError) throw err;
    throw new WorkspaceError(`vault resolution failed: ${(err as Error).message}`);
  }
}

export function registerRetrievalMethods(dispatcher: RpcDispatcher): void {
  dispatcher.register('retrieval.search', (raw): SearchResponse => {
    const p = (raw ?? {}) as Partial<SearchParams>;
    const text = requireString(p.text, 'text', 'retrieval.search');
    const vault = resolveVaultOrThrow();
    const workspaceId = p.workspace ?? readActiveWorkspace().active;
    const result = searchWorkspace(vault, workspaceId, {
      text,
      topK: typeof p.topK === 'number' && p.topK > 0 ? p.topK : 10,
      excludeClassifications: p.includeEphemeral === true ? [] : undefined,
      recursive: p.recursive === true,
    });
    return {
      query: result.query,
      tokens: result.tokens,
      hits: result.hits.map((h) => ({
        path: h.note.path,
        score: h.score,
        matchedTerms: h.matchedTerms,
        preview: h.note.body.slice(0, HIT_PREVIEW_CHARS),
        frontmatter: h.note.frontmatter,
      })),
      totalScanned: result.totalScanned,
      durationMs: result.durationMs,
      workspace: workspaceId,
    };
  });
}
