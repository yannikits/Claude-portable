/**
 * MCP-Client-Discovery — `claude-os mcp clients` (v1.5,
 * Cowork-OS-Integrationsplan Feature 1).
 *
 * Liefert pro entdeckten MCP-Server (aus Claude Desktop / Claude Code-
 * User / Claude Code-Project Configs) einen Static-Status-Check.
 * Live-Spawn-Probe ist v1.6-Material.
 *
 * @module @domains/mcp-clients
 */
export { type McpClientPaths, type ResolveOpts, resolveMcpClientPaths } from './config-paths.js';
export { discoverMcpClients } from './discovery.js';
export {
  checkServerStatus,
  type StatusCheckOpts,
  summariseStatuses,
} from './status-check.js';
export {
  type DiscoveryResult,
  McpClientDiscoveryError,
  type McpClientHost,
  type McpServerEntry,
  type McpServerStatus,
  type ServerStatusKind,
} from './types.js';
