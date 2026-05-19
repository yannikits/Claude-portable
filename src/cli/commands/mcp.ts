/**
 * `claude-os mcp` — Model Context Protocol server subcommand (v1.4 spike).
 *
 * Wires the existing `RpcDispatcher`-based domain code (Phase 5+6)
 * into the MCP SDK's stdio transport so Claude Desktop / Claude Code
 * can call claude-os tools as part of their tool-use flow. Per ADR-0007.
 *
 * Subcommands:
 *   serve   start an MCP server on stdio (default — meant to be spawned
 *           by an MCP client; users don't typically invoke this directly)
 *
 * @module @cli/commands/mcp
 */

import type { Command } from 'commander';
import { runMcpServer } from '../../mcp/index.js';

export function registerMcpCommand(program: Command): void {
  const mcp = program.command('mcp').description('Model Context Protocol server (v1.4)');

  mcp
    .command('serve')
    .description('Start the MCP server on stdio (spawned by MCP clients)')
    .action(async () => {
      try {
        await runMcpServer();
      } catch (err) {
        console.error(`claude-os mcp serve failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
