/**
 * MCP tool registry — wraps claude-os domain RPCs as MCP tools.
 *
 * Each entry maps an MCP tool name (visible to Claude Desktop /
 * Claude Code / any MCP client) to:
 *  - the underlying RpcDispatcher method name (registered by
 *    `registerMethods()` in `src/sidecar/methods.ts`)
 *  - a JSON-Schema describing accepted arguments
 *  - a one-line description shown to the user during tool discovery
 *
 * Per ADR-0007 the domain code is transport-agnostic — the same handler
 * runs whether the caller is the Tauri sidecar (NDJSON) or an MCP
 * client (this layer). No domain-side branching on transport.
 *
 * @module mcp/tools
 */

export interface McpToolDescriptor {
  /** Tool name exposed to MCP clients (kebab-case, dot-namespaced). */
  readonly name: string;
  /** One-line description shown to the user during tool discovery. */
  readonly description: string;
  /** Underlying RpcDispatcher method name (e.g. `catalog.list`). */
  readonly methodName: string;
  /** JSON-Schema for the tool's `inputSchema` per MCP spec. */
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
  };
}

export const MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'claude-os.catalog.list',
    description:
      'List installed claude-os catalog entries (skills, plugins, MCP servers) with id, kind, scope, enabled state, and source.',
    methodName: 'catalog.list',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'claude-os.vault.status',
    description:
      'Report the vault-sync subsystem state: vault path, busy-flag, conflict-mode, idle-seconds, schedule-enabled.',
    methodName: 'vault.status',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'claude-os.agent.list',
    description:
      'List recorded agent runs from the per-machine JSONL store. Optional project filter and limit.',
    methodName: 'agent.list',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter by project name.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Max records (default: all).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'claude-os.settings.read',
    description:
      'Read-only view of Anthropic config dir, active profile, secrets backend, and Claude-Code settings.json existence/mtime.',
    methodName: 'settings.read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'claude-os.secrets.list',
    description:
      'List secret KEYS only (never values). Reports backend (keyring or encrypted-file) and locked-state.',
    methodName: 'secrets.list',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'claude-os.inbox.import',
    description:
      'Copy files into the claude-os inbox/ folder under the active cloud-mount root. Mutating.',
    methodName: 'inbox.import',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Absolute file paths to import.',
        },
      },
      required: ['paths'],
      additionalProperties: false,
    },
  },
] as const;

export function findToolByName(name: string): McpToolDescriptor | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
