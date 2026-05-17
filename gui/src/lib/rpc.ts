import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const SIDECAR_FAILED_EVENT = 'sidecar://failed';

export interface SidecarFailedPayload {
  reason: string;
  strikes: number;
}

export async function rpcCall<T = unknown>(method: string, params: unknown = null): Promise<T> {
  return invoke<T>('rpc_call', { method, params });
}

export async function onSidecarFailed(
  handler: (payload: SidecarFailedPayload) => void,
): Promise<UnlistenFn> {
  return listen<SidecarFailedPayload>(SIDECAR_FAILED_EVENT, (e) => handler(e.payload));
}

export async function ping(): Promise<{ pong: boolean; ts: number }> {
  return rpcCall('ping');
}
