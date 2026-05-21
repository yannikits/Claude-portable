/**
 * PTY-Namespace RPCs: spawn / write / resize / kill.
 *
 * Ablöser fuer `chat.*` aus `methods/chat.ts` (v1.2 MVP). Nur registriert
 * wenn eine `PtyChatSessions`-Instanz injected ist.
 *
 * @module @sidecar/methods/pty
 */
import type { PtyChatSessions } from '../pty-chat-sessions.js';
import type { RpcDispatcher } from '../rpc.js';
import { requireString } from './_shared.js';

function requirePositiveInt(value: unknown, paramName: string, methodName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${methodName}: params.${paramName} muss ein positive integer sein`);
  }
  return value;
}

export function registerPtyMethods(dispatcher: RpcDispatcher, pty: PtyChatSessions): void {
  dispatcher.register('pty.spawn', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as {
      args?: readonly string[];
      cols?: number;
      rows?: number;
    };
    const args = Array.isArray(params.args) ? params.args : [];
    const opts: { cols?: number; rows?: number } = {};
    if (params.cols !== undefined) {
      opts.cols = requirePositiveInt(params.cols, 'cols', 'pty.spawn');
    }
    if (params.rows !== undefined) {
      opts.rows = requirePositiveInt(params.rows, 'rows', 'pty.spawn');
    }
    return pty.spawn(args, opts);
  });

  dispatcher.register('pty.write', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as { sessionId?: string; input?: string };
    const sessionId = requireString(params.sessionId, 'sessionId', 'pty.write');
    if (typeof params.input !== 'string') {
      throw new Error('pty.write: params.input must be a string');
    }
    pty.write(sessionId, params.input);
    return { ok: true as const };
  });

  dispatcher.register('pty.resize', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as { sessionId?: string; cols?: number; rows?: number };
    const sessionId = requireString(params.sessionId, 'sessionId', 'pty.resize');
    const cols = requirePositiveInt(params.cols, 'cols', 'pty.resize');
    const rows = requirePositiveInt(params.rows, 'rows', 'pty.resize');
    pty.resize(sessionId, cols, rows);
    return { ok: true as const };
  });

  dispatcher.register('pty.kill', (rawParams: unknown) => {
    const params = (rawParams ?? {}) as { sessionId?: string };
    const sessionId = requireString(params.sessionId, 'sessionId', 'pty.kill');
    pty.kill(sessionId);
    return { ok: true as const };
  });
}
