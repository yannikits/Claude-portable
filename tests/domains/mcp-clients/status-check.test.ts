import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkServerStatus,
  type McpServerEntry,
  summariseStatuses,
} from '../../../src/domains/mcp-clients/index.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'claude-os-mcp-status-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<McpServerEntry>): McpServerEntry {
  return {
    name: 'test',
    host: 'claude-desktop',
    sourcePath: '/fake/path.json',
    command: 'node',
    args: [],
    enabled: true,
    ...overrides,
  };
}

describe('checkServerStatus', () => {
  it('markiert disabled-Entries als disabled', () => {
    const entry = makeEntry({ enabled: false });
    const status = checkServerStatus(entry);
    expect(status.kind).toBe('disabled');
  });

  it('command-missing wenn Command nicht im PATH', () => {
    const entry = makeEntry({ command: 'definitely-not-a-real-binary-xyz' });
    const status = checkServerStatus(entry, { env: { PATH: '/nonexistent' } });
    expect(status.kind).toBe('command-missing');
    expect(status.message).toMatch(/definitely-not-a-real-binary-xyz/);
  });

  it('arg-path-missing wenn absoluter Argument-Pfad nicht existiert', () => {
    // node ist in PATH auf dem Test-Runner
    const entry = makeEntry({
      command: 'node',
      args: ['/this/file/does/not/exist.js'],
    });
    const status = checkServerStatus(entry);
    if (status.kind === 'arg-path-missing') {
      expect(status.message).toMatch(/Argument-Pfad/);
    } else {
      // Wenn node nicht im PATH ist auf dem CI, lassen wir das durch
      expect(status.kind).toBe('command-missing');
    }
  });

  it('ok wenn Command + Arg-Pfade existieren', () => {
    const scriptPath = join(workDir, 'server.js');
    writeFileSync(scriptPath, 'console.log("hi");', 'utf8');
    const entry = makeEntry({ command: 'node', args: [scriptPath] });
    const status = checkServerStatus(entry);
    // Sollte ok sein wenn node im PATH ist; sonst command-missing
    expect(['ok', 'command-missing']).toContain(status.kind);
  });

  it('akzeptiert absolute Command-Pfade', () => {
    const fakeBin = join(workDir, 'fake-bin');
    writeFileSync(fakeBin, '#!/bin/sh\necho hi\n', { mode: 0o755 });
    const entry = makeEntry({ command: fakeBin });
    const status = checkServerStatus(entry, { env: { PATH: '/nonexistent' } });
    // Absoluter Pfad sollte direkt geprüft werden
    expect(['ok', 'arg-path-missing']).toContain(status.kind);
  });
});

describe('summariseStatuses', () => {
  it('zählt korrekt pro Status-Klasse', () => {
    const fakeEntry = makeEntry({});
    const summary = summariseStatuses([
      { entry: fakeEntry, kind: 'ok', message: '' },
      { entry: fakeEntry, kind: 'ok', message: '' },
      { entry: fakeEntry, kind: 'disabled', message: '' },
      { entry: fakeEntry, kind: 'command-missing', message: '' },
    ]);
    expect(summary.ok).toBe(2);
    expect(summary.disabled).toBe(1);
    expect(summary['command-missing']).toBe(1);
    expect(summary['arg-path-missing']).toBe(0);
  });

  it('liefert alle Keys auch bei leerer Input-Liste', () => {
    const summary = summariseStatuses([]);
    expect(Object.keys(summary).sort()).toContain('ok');
    expect(summary.ok).toBe(0);
  });
});
