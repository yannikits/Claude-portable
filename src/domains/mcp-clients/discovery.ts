/**
 * Discovery für MCP-Server die in den verschiedenen MCP-Clients
 * (Claude Desktop, Claude Code user/project) konfiguriert sind.
 *
 * Liest die JSON-Configs, normalisiert sie ins gemeinsame
 * `McpServerEntry`-Format und sammelt Parse-/Missing-Probleme im
 * `DiscoveryResult.malformedConfigs` / `.missingConfigPaths`.
 *
 * Schema-Erwartung (Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "<name>": {
 *         "command": "node",
 *         "args": ["path/to/server.js"],
 *         "env": { "KEY": "value" },
 *         "disabled": false
 *       }
 *     }
 *   }
 *
 * Claude Code hat das gleiche Schema unter `mcpServers`.
 *
 * Unbekannte Top-Level-Properties werden ignoriert (forward-compat).
 *
 * @module @domains/mcp-clients/discovery
 */

import { existsSync, readFileSync } from 'node:fs';
import { type ResolveOpts, resolveMcpClientPaths } from './config-paths.js';
import type { DiscoveryResult, McpClientHost, McpServerEntry } from './types.js';

interface RawServer {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  disabled?: unknown;
}

function parseServer(
  name: string,
  raw: unknown,
  host: McpClientHost,
  sourcePath: string,
): McpServerEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as RawServer;
  if (typeof r.command !== 'string') return null;
  const args = Array.isArray(r.args)
    ? r.args.filter((a): a is string => typeof a === 'string')
    : [];
  let env: Record<string, string> | undefined;
  if (typeof r.env === 'object' && r.env !== null && !Array.isArray(r.env)) {
    env = {};
    for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
    }
  }
  const enabled = r.disabled !== true;
  return {
    name,
    host,
    sourcePath,
    command: r.command,
    args,
    ...(env === undefined ? {} : { env }),
    enabled,
  };
}

function readMcpConfig(
  path: string,
  host: McpClientHost,
  out: McpServerEntry[],
  malformed: { path: string; reason: string }[],
): boolean {
  if (!existsSync(path)) return false;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (err) {
    malformed.push({
      path,
      reason: `lese-Fehler: ${err instanceof Error ? err.message : String(err)}`,
    });
    return true; // existiert, aber fehlerhaft
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    malformed.push({
      path,
      reason: `JSON-Parse: ${err instanceof Error ? err.message : String(err)}`,
    });
    return true;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    malformed.push({ path, reason: 'Top-Level ist kein Object' });
    return true;
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (typeof servers !== 'object' || servers === null) {
    // Config exists but no mcpServers key — kein Fehler, just empty.
    return true;
  }
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    const entry = parseServer(name, value, host, path);
    if (entry !== null) out.push(entry);
  }
  return true;
}

export function discoverMcpClients(opts: ResolveOpts = {}): DiscoveryResult {
  const paths = resolveMcpClientPaths(opts);
  const servers: McpServerEntry[] = [];
  const malformed: { path: string; reason: string }[] = [];
  const missing: string[] = [];

  const desktopFound = readMcpConfig(paths.claudeDesktop, 'claude-desktop', servers, malformed);
  if (!desktopFound) missing.push(paths.claudeDesktop);

  const userFound = readMcpConfig(paths.claudeCodeUser, 'claude-code-user', servers, malformed);
  if (!userFound) missing.push(paths.claudeCodeUser);

  const userAltFound = readMcpConfig(
    paths.claudeCodeUserAlt,
    'claude-code-user',
    servers,
    malformed,
  );
  if (!userAltFound) missing.push(paths.claudeCodeUserAlt);

  if (paths.claudeCodeProject !== undefined) {
    const projectFound = readMcpConfig(
      paths.claudeCodeProject,
      'claude-code-project',
      servers,
      malformed,
    );
    if (!projectFound) missing.push(paths.claudeCodeProject);
  }
  if (paths.claudeCodeProjectAlt !== undefined) {
    const projectAltFound = readMcpConfig(
      paths.claudeCodeProjectAlt,
      'claude-code-project',
      servers,
      malformed,
    );
    if (!projectAltFound) missing.push(paths.claudeCodeProjectAlt);
  }

  return {
    servers,
    missingConfigPaths: missing,
    malformedConfigs: malformed,
  };
}
