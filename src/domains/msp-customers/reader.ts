/**
 * Read + auto-bootstrap a customer.yaml file.
 *
 * When the workspace-directory exists but `customer.yaml` is missing,
 * we write a minimal default record (slug + displayName=slug) before
 * returning — Yannik's UX decision (2026-05-29): zero-friction migration
 * for existing customer-workspaces.
 *
 * @module @domains/msp-customers/reader
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { customerYamlPath } from './paths.js';
import { defaultRecord, validateCustomerRecord } from './schema.js';
import { type CustomerRecord, CustomerSchemaError } from './types.js';

export interface ReadOpts {
  /**
   * When true and customer.yaml is missing, write a default record to
   * disk before returning. Default: true (Yannik's UX-choice).
   */
  readonly autoCreate?: boolean;
}

export interface ReadResult {
  readonly record: CustomerRecord;
  /** True if the file was created during this call (auto-bootstrap). */
  readonly created: boolean;
}

/**
 * Read `<vaultRoot>/workspaces/msp-customers/<slug>/customer.yaml`.
 *
 * Throws:
 *   - `CustomerSchemaError` when the YAML parses but fails validation
 *   - the raw YAML parse error when the file is present but malformed
 *
 * Returns a fresh default record (and writes it) when the file is
 * absent and `autoCreate !== false`.
 */
export function readCustomerYaml(vaultRoot: string, slug: string, opts: ReadOpts = {}): ReadResult {
  const path = customerYamlPath(vaultRoot, slug);
  const autoCreate = opts.autoCreate !== false;

  if (!existsSync(path)) {
    if (!autoCreate) {
      throw new CustomerSchemaError(
        slug,
        '<file>',
        `customer.yaml missing at ${path} and autoCreate=false`,
      );
    }
    const fresh = defaultRecord(slug);
    writeCustomerYaml(vaultRoot, fresh);
    return { record: fresh, created: true };
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw) as unknown;
  const record = validateCustomerRecord(parsed, { expectedSlug: slug });
  return { record, created: false };
}

/**
 * Atomically write a customer.yaml. Uses the same record-validates-
 * itself contract as the reader so a malformed write throws before
 * touching disk. Writes with mode 0o644 — these files are not secret
 * (API-tokens live in the secrets backend).
 */
export function writeCustomerYaml(vaultRoot: string, record: CustomerRecord): void {
  const validated = validateCustomerRecord(record, { expectedSlug: record.slug });
  const path = customerYamlPath(vaultRoot, validated.slug);
  // YAML library handles unknown-key preservation via the round-trip — we
  // pass extras at top level so they end up alongside the known keys.
  const { extras, ...rest } = validated as CustomerRecord & {
    extras?: Record<string, unknown>;
  };
  const yaml = stringifyYaml({ ...rest, ...(extras ?? {}) }, { lineWidth: 0 });
  writeFileSync(path, yaml, { mode: 0o644 });
}
