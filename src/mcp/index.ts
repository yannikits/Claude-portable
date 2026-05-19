/**
 * MCP integration — public exports.
 *
 * @module mcp
 */

export { type CreateMcpServerOpts, createMcpServer, runMcpServer } from './server.js';
export { findToolByName, MCP_TOOLS, type McpToolDescriptor } from './tools.js';
