/**
 * CustomerRepository-Tests — list, get, findByBridgeId, mtime-cache.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CustomerNotFoundError,
  CustomerRepository,
  customerYamlPath,
} from '../../../src/domains/msp-customers/index.js';

let vault: string;

function mkCustomer(slug: string, body: string): void {
  const dir = join(vault, 'workspaces/msp-customers', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'customer.yaml'), body);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'customer-repo-'));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe('CustomerRepository.list', () => {
  it('returns [] when msp-customers dir is empty', () => {
    const repo = new CustomerRepository({ vaultRoot: vault });
    expect(repo.list()).toEqual([]);
  });

  it('lists customers sorted by slug', () => {
    mkCustomer('mueller-gmbh', 'slug: mueller-gmbh\ndisplayName: M\n');
    mkCustomer('alpha-stb', 'slug: alpha-stb\ndisplayName: A\n');
    const repo = new CustomerRepository({ vaultRoot: vault });
    const slugs = repo.list().map((c) => c.slug);
    expect(slugs).toEqual(['alpha-stb', 'mueller-gmbh']);
  });

  it('auto-creates yaml for directories that lack one', () => {
    mkdirSync(join(vault, 'workspaces/msp-customers/no-yaml-yet'), { recursive: true });
    const repo = new CustomerRepository({ vaultRoot: vault });
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('no-yaml-yet');
    expect(list[0]?.displayName).toBe('no-yaml-yet');
  });
});

describe('CustomerRepository.get', () => {
  it('returns the record for a known slug', () => {
    mkCustomer('mueller-gmbh', 'slug: mueller-gmbh\ndisplayName: M\n');
    const repo = new CustomerRepository({ vaultRoot: vault });
    expect(repo.get('mueller-gmbh').displayName).toBe('M');
  });

  it('throws CustomerNotFoundError for missing slug', () => {
    const repo = new CustomerRepository({ vaultRoot: vault });
    expect(() => repo.get('nope')).toThrow(CustomerNotFoundError);
  });
});

describe('CustomerRepository.findByBridgeId', () => {
  it('finds customer by TANSS customerId', () => {
    mkCustomer(
      'mueller-gmbh',
      'slug: mueller-gmbh\ndisplayName: M\nbridges:\n  tanss:\n    customerId: 12345\n',
    );
    const repo = new CustomerRepository({ vaultRoot: vault });
    expect(repo.findByBridgeId('tanss', 12345)?.slug).toBe('mueller-gmbh');
    expect(repo.findByBridgeId('tanss', 99999)).toBeNull();
  });

  it('finds customer by M365 tenantId', () => {
    mkCustomer(
      'mueller-gmbh',
      'slug: mueller-gmbh\ndisplayName: M\nbridges:\n  m365:\n    tenantId: aaa-111\n',
    );
    const repo = new CustomerRepository({ vaultRoot: vault });
    expect(repo.findByBridgeId('m365', 'aaa-111')?.slug).toBe('mueller-gmbh');
  });
});

describe('CustomerRepository — mtime cache', () => {
  it('returns same record from cache when mtime unchanged', () => {
    mkCustomer('m', 'slug: m\ndisplayName: M\n');
    const repo = new CustomerRepository({ vaultRoot: vault });
    const a = repo.get('m');
    const b = repo.get('m');
    expect(a).toBe(b); // same reference -> cache hit
  });

  it('invalidates cache after file mtime changes', () => {
    mkCustomer('m', 'slug: m\ndisplayName: M-old\n');
    const repo = new CustomerRepository({ vaultRoot: vault });
    const old = repo.get('m');
    expect(old.displayName).toBe('M-old');

    // Rewrite + bump mtime explicitly (some filesystems have coarse granularity).
    writeFileSync(customerYamlPath(vault, 'm'), 'slug: m\ndisplayName: M-new\n');
    const future = new Date(Date.now() + 10_000);
    utimesSync(customerYamlPath(vault, 'm'), future, future);

    const fresh = repo.get('m');
    expect(fresh.displayName).toBe('M-new');
  });

  it('invalidate() forces a re-read', () => {
    mkCustomer('m', 'slug: m\ndisplayName: A\n');
    const repo = new CustomerRepository({ vaultRoot: vault });
    repo.get('m');
    writeFileSync(customerYamlPath(vault, 'm'), 'slug: m\ndisplayName: B\n');
    repo.invalidate();
    expect(repo.get('m').displayName).toBe('B');
  });
});
