import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyTree } from '../../../src/domains/migration/index.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'claude-os-migrate-copy-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('copyTree — happy path', () => {
  it('kopiert ein einfaches Verzeichnis rekursiv', async () => {
    const src = join(workDir, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.txt'), 'Hallo', 'utf8');
    mkdirSync(join(src, 'sub'), { recursive: true });
    writeFileSync(join(src, 'sub', 'b.txt'), 'Welt', 'utf8');

    const dst = join(workDir, 'dst');
    const stats = await copyTree({ source: src, destination: dst, exclude: [] });

    expect(stats.filesCopied).toBe(2);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('Hallo');
    expect(readFileSync(join(dst, 'sub', 'b.txt'), 'utf8')).toBe('Welt');
    expect(stats.bytesCopied).toBeGreaterThan(0);
  });

  it('schließt einzelne Sub-Trees per exclude-Pattern aus', async () => {
    const src = join(workDir, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'keep.txt'), 'k', 'utf8');
    mkdirSync(join(src, 'cache'), { recursive: true });
    writeFileSync(join(src, 'cache', 'noisy.log'), 'big', 'utf8');

    const dst = join(workDir, 'dst');
    const stats = await copyTree({
      source: src,
      destination: dst,
      exclude: ['cache', 'cache/**'],
    });

    expect(existsSync(join(dst, 'keep.txt'))).toBe(true);
    expect(existsSync(join(dst, 'cache'))).toBe(false);
    expect(stats.excludedPaths.some((p) => p.startsWith('cache'))).toBe(true);
  });

  it('respektiert Glob-Patterns mit *', async () => {
    const src = join(workDir, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.json'), '{}', 'utf8');
    writeFileSync(join(src, 'a.log'), 'log', 'utf8');
    writeFileSync(join(src, 'a.txt'), 'txt', 'utf8');

    const dst = join(workDir, 'dst');
    await copyTree({ source: src, destination: dst, exclude: ['*.log'] });

    expect(existsSync(join(dst, 'a.json'))).toBe(true);
    expect(existsSync(join(dst, 'a.txt'))).toBe(true);
    expect(existsSync(join(dst, 'a.log'))).toBe(false);
  });

  it('ist idempotent — zweimaliger Lauf produziert identisches Ziel', async () => {
    const src = join(workDir, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.txt'), 'V1', 'utf8');

    const dst = join(workDir, 'dst');
    await copyTree({ source: src, destination: dst, exclude: [] });
    const stats2 = await copyTree({ source: src, destination: dst, exclude: [] });

    expect(stats2.filesCopied).toBe(1);
    expect(readFileSync(join(dst, 'a.txt'), 'utf8')).toBe('V1');
  });
});
