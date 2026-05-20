/**
 * Plattform-spezifische Pfade zu Claude-Desktop und Claude-Code
 * MCP-Configs.
 *
 * Claude Desktop nutzt:
 *  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
 *  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
 *  - Linux: `~/.config/Claude/claude_desktop_config.json`
 *
 * Claude Code nutzt:
 *  - User-scope: `~/.claude/mcp.json`
 *  - Project-scope: `<cwd>/.claude/mcp.json`
 *
 * Tests injecten ihr eigenes `paths`-Objekt; die Production-Resolver
 * verwenden `process.env` und `process.platform`.
 *
 * @module @domains/mcp-clients/config-paths
 */

import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface McpClientPaths {
  readonly claudeDesktop: string;
  /** Primärer User-scope Pfad für Claude Code: `~/.claude/mcp.json`. */
  readonly claudeCodeUser: string;
  /**
   * Alternativer User-scope Pfad — `~/.mcp.json`. Wird von neueren
   * Claude-Code-Versionen alternativ akzeptiert; wir prüfen beide.
   */
  readonly claudeCodeUserAlt: string;
  /** Project-scope kann fehlen falls kein cwd hier zum Suchen ist. */
  readonly claudeCodeProject?: string;
  /** Alternative Project-Location: `<cwd>/.mcp.json`. */
  readonly claudeCodeProjectAlt?: string;
}

export interface ResolveOpts {
  readonly env?: NodeJS.ProcessEnv;
  readonly platformOverride?: NodeJS.Platform;
  readonly homeOverride?: string;
  readonly projectCwd?: string;
}

export function resolveMcpClientPaths(opts: ResolveOpts = {}): McpClientPaths {
  const env = opts.env ?? process.env;
  const plat = opts.platformOverride ?? platform();
  const home = opts.homeOverride ?? homedir();

  const claudeDesktop = (() => {
    if (plat === 'win32') {
      const appdata = env.APPDATA ?? join(home, 'AppData', 'Roaming');
      return join(appdata, 'Claude', 'claude_desktop_config.json');
    }
    if (plat === 'darwin') {
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    return join(home, '.config', 'Claude', 'claude_desktop_config.json');
  })();

  const claudeCodeUser = join(home, '.claude', 'mcp.json');
  const claudeCodeUserAlt = join(home, '.mcp.json');

  const result: McpClientPaths = {
    claudeDesktop,
    claudeCodeUser,
    claudeCodeUserAlt,
    ...(opts.projectCwd === undefined
      ? {}
      : {
          claudeCodeProject: join(opts.projectCwd, '.claude', 'mcp.json'),
          claudeCodeProjectAlt: join(opts.projectCwd, '.mcp.json'),
        }),
  };
  return result;
}
