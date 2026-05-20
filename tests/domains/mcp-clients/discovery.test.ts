import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverMcpClients } from '../../../src/domains/mcp-clients/index.js';

let fakeHome: string;
let fakeProject: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'claude-os-mcp-disco-home-'));
  fakeProject = mkdtempSync(join(tmpdir(), 'claude-os-mcp-disco-proj-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(fakeProject, { recursive: true, force: true });
});

function writeJsonAt(path: string, content: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(content), 'utf8');
}

function discoveryOpts() {
  return {
    env: {},
    platformOverride: 'linux' as const,
    homeOverride: fakeHome,
    projectCwd: fakeProject,
  };
}

describe('discoverMcpClients — Discovery', () => {
  it('liefert empty wenn keine Config-Dateien existieren', () => {
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers).toEqual([]);
    expect(result.missingConfigPaths.length).toBeGreaterThan(0);
    expect(result.malformedConfigs).toEqual([]);
  });

  it('liest Claude Desktop config (~/.config/Claude/...)', () => {
    const path = join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json');
    writeJsonAt(path, {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('filesystem');
    expect(result.servers[0]?.host).toBe('claude-desktop');
    expect(result.servers[0]?.command).toBe('npx');
    expect(result.servers[0]?.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ]);
    expect(result.servers[0]?.enabled).toBe(true);
  });

  it('respektiert disabled: true', () => {
    const path = join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json');
    writeJsonAt(path, {
      mcpServers: {
        broken: { command: 'node', args: ['x.js'], disabled: true },
      },
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers[0]?.enabled).toBe(false);
  });

  it('liest env-Vars korrekt mit ein', () => {
    const path = join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json');
    writeJsonAt(path, {
      mcpServers: {
        s1: { command: 'node', args: ['s.js'], env: { API_KEY: 'x', LOG_LEVEL: 'info' } },
      },
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers[0]?.env).toEqual({ API_KEY: 'x', LOG_LEVEL: 'info' });
  });

  it('mergt Server aus Claude Desktop + Claude Code user + project', () => {
    writeJsonAt(join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json'), {
      mcpServers: { desktop: { command: 'node', args: ['d.js'] } },
    });
    writeJsonAt(join(fakeHome, '.claude', 'mcp.json'), {
      mcpServers: { user: { command: 'node', args: ['u.js'] } },
    });
    writeJsonAt(join(fakeProject, '.claude', 'mcp.json'), {
      mcpServers: { project: { command: 'node', args: ['p.js'] } },
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers.map((s) => s.name).sort()).toEqual(['desktop', 'project', 'user']);
    expect(result.servers.find((s) => s.name === 'desktop')?.host).toBe('claude-desktop');
    expect(result.servers.find((s) => s.name === 'user')?.host).toBe('claude-code-user');
    expect(result.servers.find((s) => s.name === 'project')?.host).toBe('claude-code-project');
  });

  it('toleriert fehlendes mcpServers-Key (config existiert, ist aber leer)', () => {
    writeJsonAt(join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json'), {
      foo: 'bar',
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers).toEqual([]);
    expect(result.missingConfigPaths).not.toContain(
      join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('protokolliert malformed JSON statt zu crashen', () => {
    const path = join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{ not real json', 'utf8');
    const result = discoverMcpClients(discoveryOpts());
    expect(result.malformedConfigs).toHaveLength(1);
    expect(result.malformedConfigs[0]?.reason).toMatch(/JSON-Parse/);
  });

  it('überspringt Server-Entries mit ungültigem command-Typ', () => {
    writeJsonAt(join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json'), {
      mcpServers: {
        valid: { command: 'node', args: [] },
        invalid: { args: ['no-command'] },
      },
    });
    const result = discoverMcpClients(discoveryOpts());
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('valid');
  });
});
