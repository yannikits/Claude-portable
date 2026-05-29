/**
 * BridgeRegistry-Tests.
 */
import { describe, expect, it } from 'vitest';
import {
  BridgeRegistry,
  BridgeRegistryError,
  NullBridge,
} from '../../../src/domains/msp-bridges/index.js';

describe('BridgeRegistry', () => {
  it('starts empty', () => {
    const r = new BridgeRegistry();
    expect(r.size()).toBe(0);
    expect(r.kinds()).toEqual([]);
    expect(r.get('tanss')).toBeNull();
  });

  it('register + get round-trip', () => {
    const r = new BridgeRegistry();
    const b = new NullBridge('tanss');
    r.register(b);
    expect(r.size()).toBe(1);
    expect(r.kinds()).toEqual(['tanss']);
    expect(r.get('tanss')).toBe(b);
  });

  it('throws on double-register without explicit unregister', () => {
    const r = new BridgeRegistry();
    r.register(new NullBridge('tanss'));
    expect(() => r.register(new NullBridge('tanss'))).toThrow(BridgeRegistryError);
  });

  it('unregister allows re-registration', () => {
    const r = new BridgeRegistry();
    r.register(new NullBridge('tanss'));
    r.unregister('tanss');
    expect(r.get('tanss')).toBeNull();
    r.register(new NullBridge('tanss'));
    expect(r.get('tanss')).not.toBeNull();
  });

  it('clear() empties everything', () => {
    const r = new BridgeRegistry();
    r.register(new NullBridge('tanss'));
    r.register(new NullBridge('veeam'));
    expect(r.size()).toBe(2);
    r.clear();
    expect(r.size()).toBe(0);
  });
});
