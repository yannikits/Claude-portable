/**
 * Reader-Tests — happy path, auto-create, malformed yaml, expected-slug.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CustomerSchemaError,
  customerYamlPath,
  readCustomerYaml,
  writeCustomerYaml,
} from '../../../src/domains/msp-customers/index.js';

let vault: string;

function mkSlugDir(slug: string): string {
  const dir = join(vault, 'workspaces/msp-customers', slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'customer-reader-'));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe('readCustomerYaml — auto-create on missing file', () => {
  it('writes a default record + returns created=true', () => {
    mkSlugDir('mueller-gmbh');
    const result = readCustomerYaml(vault, 'mueller-gmbh');
    expect(result.created).toBe(true);
    expect(result.record).toEqual({ slug: 'mueller-gmbh', displayName: 'mueller-gmbh' });
    expect(existsSync(customerYamlPath(vault, 'mueller-gmbh'))).toBe(true);
  });

  it('throws when autoCreate=false and file missing', () => {
    mkSlugDir('mueller-gmbh');
    expect(() => readCustomerYaml(vault, 'mueller-gmbh', { autoCreate: false })).toThrow(
      CustomerSchemaError,
    );
  });

  it('does not overwrite an existing file', () => {
    const dir = mkSlugDir('mueller-gmbh');
    writeFileSync(
      join(dir, 'customer.yaml'),
      'slug: mueller-gmbh\ndisplayName: "Custom Display"\n',
    );
    const result = readCustomerYaml(vault, 'mueller-gmbh');
    expect(result.created).toBe(false);
    expect(result.record.displayName).toBe('Custom Display');
  });
});

describe('readCustomerYaml — schema enforcement', () => {
  it('throws when yaml slug does not match folder', () => {
    const dir = mkSlugDir('mueller-gmbh');
    writeFileSync(join(dir, 'customer.yaml'), 'slug: different\ndisplayName: X\n');
    expect(() => readCustomerYaml(vault, 'mueller-gmbh')).toThrow(/does not match folder/);
  });

  it('parses bridges correctly', () => {
    const dir = mkSlugDir('mueller-gmbh');
    writeFileSync(
      join(dir, 'customer.yaml'),
      `slug: mueller-gmbh
displayName: Steuerkanzlei Müller GmbH
bridges:
  tanss:
    customerId: 12345
  veeam:
    serverHostname: backup.iteen.local
    jobNames:
      - mueller-pc-backup
      - mueller-server-backup
`,
    );
    const { record } = readCustomerYaml(vault, 'mueller-gmbh');
    expect(record.bridges?.tanss?.customerId).toBe(12345);
    expect(record.bridges?.veeam?.jobNames).toEqual(['mueller-pc-backup', 'mueller-server-backup']);
  });
});

describe('writeCustomerYaml — round-trip', () => {
  it('writes + reads back equal record', () => {
    mkSlugDir('mueller-gmbh');
    const original = {
      slug: 'mueller-gmbh',
      displayName: 'Müller GmbH',
      bridges: { tanss: { customerId: 99 } },
      tags: ['stb', 'kmu'],
    };
    writeCustomerYaml(vault, original);
    const { record } = readCustomerYaml(vault, 'mueller-gmbh');
    expect(record).toMatchObject(original);
  });

  it('preserves extras keys on round-trip', () => {
    const dir = mkSlugDir('mueller-gmbh');
    writeFileSync(
      join(dir, 'customer.yaml'),
      'slug: mueller-gmbh\ndisplayName: X\nfutureFeature:\n  weight: low\n',
    );
    const { record } = readCustomerYaml(vault, 'mueller-gmbh');
    expect(record.extras).toEqual({ futureFeature: { weight: 'low' } });
    // Round-trip
    writeCustomerYaml(vault, record);
    const written = readFileSync(customerYamlPath(vault, 'mueller-gmbh'), 'utf-8');
    expect(written).toContain('futureFeature:');
    expect(written).toContain('weight: low');
  });
});
