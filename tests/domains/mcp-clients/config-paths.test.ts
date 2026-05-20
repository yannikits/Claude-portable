import { describe, expect, it } from 'vitest';
import { resolveMcpClientPaths } from '../../../src/domains/mcp-clients/index.js';

// path.join verwendet den runtime-platform-Separator. Tests die mit
// Posix-Style-Inputs arbeiten müssen den tatsächlichen Output
// normalisieren bevor sie vergleichen — wir prüfen die Segment-Kette,
// nicht den exakten Separator.
function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('resolveMcpClientPaths', () => {
  it('liefert Windows-spezifische Pfade unter %APPDATA%', () => {
    const paths = resolveMcpClientPaths({
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      platformOverride: 'win32',
      homeOverride: 'C:\\Users\\test',
    });
    expect(paths.claudeDesktop).toContain('AppData');
    expect(paths.claudeDesktop).toContain('Claude');
    expect(paths.claudeDesktop.endsWith('claude_desktop_config.json')).toBe(true);
    expect(paths.claudeCodeUser).toContain('.claude');
  });

  it('liefert macOS-Pfad unter ~/Library/Application Support', () => {
    const paths = resolveMcpClientPaths({
      env: {},
      platformOverride: 'darwin',
      homeOverride: '/Users/test',
    });
    expect(normalisePath(paths.claudeDesktop)).toBe(
      '/Users/test/Library/Application Support/Claude/claude_desktop_config.json',
    );
  });

  it('liefert Linux-Pfad unter ~/.config/Claude', () => {
    const paths = resolveMcpClientPaths({
      env: {},
      platformOverride: 'linux',
      homeOverride: '/home/test',
    });
    expect(normalisePath(paths.claudeDesktop)).toBe(
      '/home/test/.config/Claude/claude_desktop_config.json',
    );
  });

  it('verlinkt project-scope nur wenn projectCwd übergeben wird', () => {
    const withProject = resolveMcpClientPaths({
      env: {},
      platformOverride: 'linux',
      homeOverride: '/home/test',
      projectCwd: '/some/project',
    });
    expect(normalisePath(withProject.claudeCodeProject ?? '')).toBe(
      '/some/project/.claude/mcp.json',
    );
    const withoutProject = resolveMcpClientPaths({
      env: {},
      platformOverride: 'linux',
      homeOverride: '/home/test',
    });
    expect(withoutProject.claudeCodeProject).toBeUndefined();
  });

  it('Windows-Fallback wenn APPDATA nicht im env ist', () => {
    const paths = resolveMcpClientPaths({
      env: {}, // KEINE APPDATA
      platformOverride: 'win32',
      homeOverride: 'C:\\Users\\test',
    });
    expect(paths.claudeDesktop).toContain('AppData\\Roaming');
  });
});
