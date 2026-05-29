/**
 * Path helpers for the MSP-Customers domain.
 *
 * Customer files live under
 *   `<vaultRoot>/workspaces/msp-customers/<slug>/customer.yaml`
 * — i.e. INSIDE the Customer-Workspace they belong to. This keeps the
 * Customer-Stammdaten versioned with the rest of the workspace (notes,
 * skills, bridge-traces) and a single rsync covers them.
 *
 * @module @domains/msp-customers/paths
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MSP_CUSTOMERS_WORKSPACES_SUBDIR = 'workspaces/msp-customers';
export const CUSTOMER_FILE_NAME = 'customer.yaml';

/** `<vaultRoot>/workspaces/msp-customers`. */
export function mspCustomersDir(vaultRoot: string): string {
  return join(vaultRoot, MSP_CUSTOMERS_WORKSPACES_SUBDIR);
}

/** `<vaultRoot>/workspaces/msp-customers/<slug>`. */
export function customerWorkspaceDir(vaultRoot: string, slug: string): string {
  return join(mspCustomersDir(vaultRoot), slug);
}

/** `<vaultRoot>/workspaces/msp-customers/<slug>/customer.yaml`. */
export function customerYamlPath(vaultRoot: string, slug: string): string {
  return join(customerWorkspaceDir(vaultRoot, slug), CUSTOMER_FILE_NAME);
}

/**
 * Enumerate slugs of all customer-workspaces under the vault. A slug
 * counts as "present" when its directory exists — the customer.yaml
 * may be missing and gets auto-created by the reader.
 *
 * Returns lexicographically sorted slugs so list-views are stable.
 */
export function listCustomerSlugs(vaultRoot: string): string[] {
  const dir = mspCustomersDir(vaultRoot);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    try {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(entry);
    } catch {
      // ignore unreadable entries
    }
  }
  out.sort();
  return out;
}
