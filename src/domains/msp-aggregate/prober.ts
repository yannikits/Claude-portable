/**
 * runProbes — orchestrate N customer-probes per bridge.
 *
 * Topology:
 *   - per-bridge: probes run SERIALLY (one customer at a time). That lets
 *     the bridge's per-host token cache amortise OAuth-logins.
 *   - across bridges: probes run in PARALLEL (Promise.all on the per-bridge
 *     loops). For 2-3 bridges this saturates the network without flooding
 *     any one MSP-system.
 *
 * Wall-clock guard:
 *   - per-probe: caller's `probeTimeoutMs` (default 10_000) bounds one cell
 *   - whole aggregate: `hardTimeoutMs` (default 30_000) bounds the whole pass;
 *     any in-flight or pending cells become `{ kind: 'timeout' }`.
 *
 * @module @domains/msp-aggregate/prober
 */
import type { BridgeRegistry } from '../msp-bridges/registry.js';
import type { BridgeKind, BridgeProbe, ReadBridge } from '../msp-bridges/types.js';
import type { CustomerRecord } from '../msp-customers/index.js';
import type {
  AggregateProberOpts,
  AggregateSnapshot,
  BridgeCellResult,
  CustomerHealthCells,
  CustomerHealthRow,
} from './types.js';

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_HARD_TIMEOUT_MS = 30_000;

export async function runProbes(
  registry: BridgeRegistry,
  customers: readonly CustomerRecord[],
  opts: AggregateProberOpts = {},
): Promise<AggregateSnapshot> {
  const probeTimeoutMs = Math.min(
    opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    DEFAULT_PROBE_TIMEOUT_MS,
  );
  const hardTimeoutMs = opts.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const start = Date.now();
  const snapshotAt = new Date(start).toISOString();
  const registeredBridges = registry.kinds();

  // Hard-cap: any unfinished cell when the deadline hits becomes timeout.
  const deadline = start + hardTimeoutMs;
  const cellsByCustomer = new Map<string, Partial<CustomerHealthCells>>();
  for (const c of customers) cellsByCustomer.set(c.slug, {});

  await Promise.all(
    registeredBridges.map((kind) =>
      runForBridge(registry.get(kind), kind, customers, cellsByCustomer, probeTimeoutMs, deadline),
    ),
  );

  const rows: CustomerHealthRow[] = customers.map((c) => ({
    slug: c.slug,
    displayName: c.displayName,
    cells: (cellsByCustomer.get(c.slug) ?? {}) as CustomerHealthCells,
  }));

  return {
    snapshotAt,
    durationMs: Date.now() - start,
    registeredBridges,
    rows,
  };
}

async function runForBridge(
  bridge: ReadBridge<unknown> | null,
  kind: BridgeKind,
  customers: readonly CustomerRecord[],
  cellsByCustomer: Map<string, Partial<CustomerHealthCells>>,
  probeTimeoutMs: number,
  deadline: number,
): Promise<void> {
  if (bridge === null) return;
  for (const customer of customers) {
    // Customer has no bridges.<kind>? Skip — no cell emitted.
    if (customer.bridges?.[kind] === undefined) continue;
    if (Date.now() >= deadline) {
      writeCell(cellsByCustomer, customer.slug, kind, {
        kind: 'timeout',
        message: 'aggregate hard-cap reached before probe started',
      });
      continue;
    }
    const cell = await probeWithTimeout(bridge, customer, probeTimeoutMs, deadline);
    writeCell(cellsByCustomer, customer.slug, kind, cell);
  }
}

function writeCell(
  cellsByCustomer: Map<string, Partial<CustomerHealthCells>>,
  slug: string,
  kind: BridgeKind,
  cell: BridgeCellResult<unknown>,
): void {
  const c = cellsByCustomer.get(slug);
  if (c === undefined) return;
  (c as Record<BridgeKind, BridgeCellResult<unknown>>)[kind] = cell;
}

async function probeWithTimeout(
  bridge: ReadBridge<unknown>,
  customer: CustomerRecord,
  probeTimeoutMs: number,
  deadline: number,
): Promise<BridgeCellResult<unknown>> {
  const effective = Math.min(probeTimeoutMs, deadline - Date.now());
  if (effective <= 0) {
    return { kind: 'timeout', message: 'aggregate hard-cap reached' };
  }
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<BridgeCellResult<unknown>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout', message: `probe timed out after ${effective}ms` });
    }, effective);
  });
  try {
    const probe = await Promise.race([bridge.probe(customer), timeoutPromise]);
    return toCell(probe);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Convert a `BridgeProbe` OR our timeout-shape into a `BridgeCellResult`. */
function toCell(
  input: BridgeProbe<unknown> | BridgeCellResult<unknown>,
): BridgeCellResult<unknown> {
  // If it's already a cell-result (the timeout race winner), pass through.
  if ('result' in input === false) {
    return input as BridgeCellResult<unknown>;
  }
  const probe = input as BridgeProbe<unknown>;
  const r = probe.result;
  switch (r.kind) {
    case 'ok':
      return {
        kind: 'ok',
        data: r.data,
        durationMs: probe.durationMs,
        probedAt: probe.probedAt,
      };
    case 'rate-limited':
      return {
        kind: 'rate-limited',
        retryAfterSec: r.retryAfterSec,
        ...(r.message !== undefined ? { message: r.message } : {}),
      };
    case 'misconfigured':
    case 'auth-failed':
    case 'unreachable':
    case 'error':
      return { kind: r.kind, message: r.message };
  }
}
