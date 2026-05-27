/**
 * Canonical JSON serialization — deterministic stringification with
 * sorted object-keys for cross-system signature stability.
 *
 * Strategy:
 *   - `JSON.stringify` with a custom replacer that sorts object keys
 *     alphabetically (recursively)
 *   - Arrays preserve insertion order (order is semantically meaningful)
 *   - `null`, `boolean`, `number`, `string` serialize as standard JSON
 *   - `undefined` is dropped (matches JSON.stringify default)
 *   - BigInt / Symbol / Function are rejected (non-JSON, would surprise
 *     a Verifier on the other side of the wire)
 *
 * Same payload → same string, every time, on every platform. That's
 * the property a deterministic-signing protocol needs.
 *
 * @module @domains/skill-lifecycle/signing/canonical
 */
import { SigningError } from './types.js';

function sortObjectKeys(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((v) => sortObjectKeys(v));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = obj[k];
      if (v !== undefined) {
        out[k] = sortObjectKeys(v);
      }
    }
    return out;
  }
  return value;
}

function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertJsonSafe(value[i], `${path}[${i}]`);
    }
    return;
  }
  const t = typeof value;
  if (t === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(v, `${path}.${k}`);
    }
    return;
  }
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'undefined') {
    return;
  }
  throw new SigningError(
    `canonicalize: unsupported type "${t}" at ${path} — signing payload must be JSON-only`,
    'canonicalization-failed',
  );
}

/**
 * Returns the canonical JSON string of `payload`. Throws SigningError
 * on non-JSON-safe values (BigInt, Symbol, Function).
 */
export function canonicalizeJson(payload: unknown): string {
  assertJsonSafe(payload);
  const sorted = sortObjectKeys(payload);
  return JSON.stringify(sorted);
}
