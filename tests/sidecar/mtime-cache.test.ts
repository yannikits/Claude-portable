/**
 * M14 (2026-05-21 code-review): mtime-keyed cache fuer sidecar config-
 * file reads. Tests:
 *  - cache-miss → loader fires + value cached
 *  - cache-hit (same mtime+size) → loader NICHT aufgerufen
 *  - mtime-change → loader re-fires
 *  - size-change → loader re-fires (mtime-Sekunden-Granularitaet auf
 *    FAT32 wuerde sonst missen)
 *  - missing-file tombstone → second missing-file call cached
 *  - existing → missing → existing transitions invalidieren korrekt
 */
import { existsSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMtimeCache, mtimeCached } from '../../src/sidecar/mtime-cache.js';

describe('mtime-cache', () => {
  let tmp: string;
  let filePath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'claude-os-mtime-'));
    filePath = join(tmp, 'data.json');
  });

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('cache-miss: loader fires + value cached', () => {
    writeFileSync(filePath, '{"v":1}');
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const value = mtimeCached(
      filePath,
      () => {
        calls++;
        return { v: 1 };
      },
      cache,
    );
    expect(value).toEqual({ v: 1 });
    expect(calls).toBe(1);
  });

  it('cache-hit (same mtime+size): loader NOT re-fired', () => {
    writeFileSync(filePath, '{"v":1}');
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const loader = () => {
      calls++;
      return { v: calls };
    };
    const v1 = mtimeCached(filePath, loader, cache);
    const v2 = mtimeCached(filePath, loader, cache);
    expect(v1).toEqual({ v: 1 });
    expect(v2).toEqual({ v: 1 }); // SAME — loader nicht re-fired
    expect(calls).toBe(1);
  });

  it('mtime-change: loader re-fires', () => {
    writeFileSync(filePath, '{"v":1}');
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const loader = () => {
      calls++;
      return { v: calls };
    };
    mtimeCached(filePath, loader, cache);
    // Manually bump mtime durch utimes — simuliert externe File-Aenderung
    // mit gleichem Content (gleiche size).
    const futureTime = new Date(Date.now() + 60_000);
    utimesSync(filePath, futureTime, futureTime);
    const v2 = mtimeCached(filePath, loader, cache);
    expect(v2).toEqual({ v: 2 });
    expect(calls).toBe(2);
  });

  it('size-change: loader re-fires', () => {
    writeFileSync(filePath, '{"v":1}');
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const loader = () => {
      calls++;
      return { v: calls };
    };
    mtimeCached(filePath, loader, cache);
    // Rewrite mit anderem content (gleiche mtime-Sekunde moeglich auf
    // FAT32 → size-Diff faengt es ab).
    writeFileSync(filePath, '{"v":2,"extra":"longer payload to change size"}');
    const v2 = mtimeCached(filePath, loader, cache);
    expect(v2).toEqual({ v: 2 });
    expect(calls).toBe(2);
  });

  it('missing-file: tombstone cached, second call also cache-hit', () => {
    const cache = createMtimeCache<string>();
    let calls = 0;
    const loader = () => {
      calls++;
      return 'missing-default';
    };
    const v1 = mtimeCached(filePath, loader, cache);
    const v2 = mtimeCached(filePath, loader, cache);
    expect(v1).toBe('missing-default');
    expect(v2).toBe('missing-default');
    expect(calls).toBe(1);
  });

  it('missing → existing transition: loader re-fires + cached', () => {
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const loader = () => {
      calls++;
      return { v: calls };
    };
    // 1. file missing → tombstone
    expect(mtimeCached(filePath, loader, cache)).toEqual({ v: 1 });
    expect(calls).toBe(1);

    // 2. file existiert jetzt → cache invalidated
    writeFileSync(filePath, '{"a":1}');
    expect(mtimeCached(filePath, loader, cache)).toEqual({ v: 2 });
    expect(calls).toBe(2);

    // 3. file unveraendert → cache-hit
    expect(mtimeCached(filePath, loader, cache)).toEqual({ v: 2 });
    expect(calls).toBe(2);
  });

  it('existing → missing transition: loader re-fires + tombstone cached', () => {
    writeFileSync(filePath, '{"a":1}');
    const cache = createMtimeCache<{ v: number }>();
    let calls = 0;
    const loader = () => {
      calls++;
      return { v: calls };
    };
    mtimeCached(filePath, loader, cache);
    expect(calls).toBe(1);

    // file deleted
    unlinkSync(filePath);
    expect(mtimeCached(filePath, loader, cache)).toEqual({ v: 2 });
    expect(calls).toBe(2);

    // still missing → cache-hit (tombstone)
    expect(mtimeCached(filePath, loader, cache)).toEqual({ v: 2 });
    expect(calls).toBe(2);
  });

  it('zwei verschiedene paths share dieselbe cache-Instanz ohne kollidieren', () => {
    const fileA = join(tmp, 'a.json');
    const fileB = join(tmp, 'b.json');
    writeFileSync(fileA, '"A"');
    writeFileSync(fileB, '"B"');
    const cache = createMtimeCache<string>();
    const vA = mtimeCached(fileA, () => 'A-loaded', cache);
    const vB = mtimeCached(fileB, () => 'B-loaded', cache);
    expect(vA).toBe('A-loaded');
    expect(vB).toBe('B-loaded');
    // Read-back from cache: kein loader-call mehr
    let calls = 0;
    expect(
      mtimeCached(
        fileA,
        () => {
          calls++;
          return 'X';
        },
        cache,
      ),
    ).toBe('A-loaded');
    expect(calls).toBe(0);
  });
});
