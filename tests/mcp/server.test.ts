import { describe, expect, it } from 'vitest';
import { findToolByName, MCP_TOOLS } from '../../src/mcp/index.js';
import { RpcDispatcher } from '../../src/sidecar/rpc.js';

describe('MCP_TOOLS registry', () => {
  it('exposes 6 tools with unique names + valid JSON-Schema shapes', () => {
    expect(MCP_TOOLS).toHaveLength(6);
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    expect(names.size).toBe(MCP_TOOLS.length);
    for (const t of MCP_TOOLS) {
      expect(t.name).toMatch(/^claude-os\./);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.inputSchema.properties).toBe('object');
    }
  });

  it('every tool methodName matches the sidecar registry', async () => {
    const dispatcher = new RpcDispatcher();
    const { registerMethods } = await import('../../src/sidecar/methods.js');
    registerMethods(dispatcher);
    const sidecarMethods = new Set(dispatcher.list());
    for (const t of MCP_TOOLS) {
      expect(sidecarMethods.has(t.methodName), `methodName ${t.methodName} not registered`).toBe(
        true,
      );
    }
  });

  it('findToolByName returns the descriptor or undefined', () => {
    expect(findToolByName('claude-os.vault.status')?.methodName).toBe('vault.status');
    expect(findToolByName('claude-os.does-not-exist')).toBeUndefined();
  });
});

describe('RpcDispatcher.invoke', () => {
  it('calls the registered handler with params', async () => {
    const dispatcher = new RpcDispatcher();
    dispatcher.register('echo', (p) => ({ echoed: p }));
    const result = (await dispatcher.invoke('echo', { hello: 'world' })) as {
      echoed: { hello: string };
    };
    expect(result.echoed.hello).toBe('world');
  });

  it('throws MethodNotFound for unknown methods', async () => {
    const dispatcher = new RpcDispatcher();
    await expect(dispatcher.invoke('nope')).rejects.toThrow(/MethodNotFound/);
  });

  it('propagates handler errors without wrapping in JSON-RPC envelope', async () => {
    const dispatcher = new RpcDispatcher();
    dispatcher.register('boom', () => {
      throw new Error('handler failure');
    });
    await expect(dispatcher.invoke('boom')).rejects.toThrow('handler failure');
  });
});
