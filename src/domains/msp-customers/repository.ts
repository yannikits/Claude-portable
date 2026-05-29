/**
 * CustomerRepository — list + get + find-by-bridge-id with mtime caching.
 *
 * Reads all `customer.yaml` files under `<vaultRoot>/workspaces/msp-customers/`.
 * Cache invalidates per-file via `mtimeMs` so concurrent edits propagate
 * on the next read. The cache is keyed by the absolute file-path so it
 * survives vault-root changes (although in practice the root is fixed
 * per process via `resolveVaultRoot`).
 *
 * @module @domains/msp-customers/repository
 */
import { statSync } from 'node:fs';
import { customerWorkspaceDir, customerYamlPath, listCustomerSlugs } from './paths.js';
import { readCustomerYaml } from './reader.js';
import { CustomerNotFoundError, type CustomerRecord } from './types.js';

interface CacheEntry {
  readonly mtimeMs: number;
  readonly record: CustomerRecord;
}

export interface RepoOpts {
  readonly vaultRoot: string;
  /** Override autoCreate on first-touch. Default: true. */
  readonly autoCreate?: boolean;
}

export class CustomerRepository {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly opts: RepoOpts) {}

  /**
   * List ALL customers under the vault (auto-creates yaml-files for
   * workspaces that don't have one yet, per Yannik's UX-decision).
   */
  list(): CustomerRecord[] {
    const slugs = listCustomerSlugs(this.opts.vaultRoot);
    return slugs.map((s) => this.getOrCreate(s));
  }

  /**
   * Get one customer by slug. Throws `CustomerNotFoundError` when the
   * workspace-directory itself doesn't exist (no auto-create-of-folder).
   */
  get(slug: string): CustomerRecord {
    return this.getOrCreate(slug);
  }

  /**
   * Find the customer that claims a given bridge-id. Returns null when
   * no match (or multiple — caller should treat that as configuration
   * error). O(n) scan; acceptable for typical MSP-size (<200 customers).
   */
  findByBridgeId(kind: 'tanss', id: number): CustomerRecord | null;
  findByBridgeId(kind: 'm365' | 'securepoint', id: string): CustomerRecord | null;
  findByBridgeId(kind: string, id: string | number): CustomerRecord | null {
    for (const c of this.list()) {
      const b = c.bridges;
      if (b === undefined) continue;
      if (kind === 'tanss' && b.tanss?.customerId === id) return c;
      if (kind === 'm365' && b.m365?.tenantId === id) return c;
      if (kind === 'securepoint' && b.securepoint?.deviceId === id) return c;
    }
    return null;
  }

  /** Force-invalidate the in-memory cache. Use after external file edits. */
  invalidate(): void {
    this.cache.clear();
  }

  private getOrCreate(slug: string): CustomerRecord {
    const dir = customerWorkspaceDir(this.opts.vaultRoot, slug);
    // Workspace-directory must exist — we don't auto-create folders, only files.
    try {
      const st = statSync(dir);
      if (!st.isDirectory()) {
        throw new CustomerNotFoundError(slug);
      }
    } catch (err) {
      if (err instanceof CustomerNotFoundError) throw err;
      throw new CustomerNotFoundError(slug);
    }

    const path = customerYamlPath(this.opts.vaultRoot, slug);
    let currentMtime = 0;
    try {
      currentMtime = statSync(path).mtimeMs;
    } catch {
      // file missing — will be auto-created below
    }

    const cached = this.cache.get(path);
    if (cached !== undefined && cached.mtimeMs === currentMtime && currentMtime > 0) {
      return cached.record;
    }

    const { record } = readCustomerYaml(this.opts.vaultRoot, slug, {
      ...(this.opts.autoCreate !== undefined ? { autoCreate: this.opts.autoCreate } : {}),
    });
    // Re-stat after potential auto-create so the cache key reflects the
    // freshly-written mtime.
    const mtimeMs = statSync(path).mtimeMs;
    this.cache.set(path, { mtimeMs, record });
    return record;
  }
}
